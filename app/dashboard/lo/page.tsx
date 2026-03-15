import {
  differenceInCalendarDays,
  isWithinInterval,
  startOfDay,
  differenceInHours,
} from "date-fns";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireCurrentUser } from "@/lib/current-user";
import { StatCard } from "@/components/StatCard";
import { Badge } from "@/components/Badge";
import { avg, formatCurrency, monthStart, sum } from "@/lib/metrics";
import { cn } from "@/lib/cn";

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const QUESTROCK_STAGES = [
  { key: "verification", label: "Verification", turnTime: "Up to 48 hrs" },
  { key: "esign_out", label: "eSign Out", turnTime: "3 hrs / 24 hrs" },
  { key: "processing", label: "Processing", turnTime: "LO: 48 hrs / Proc: 24 hrs" },
  { key: "underwriting", label: "Underwriting", turnTime: "Up to 72 hrs" },
  { key: "approval_conditions", label: "Approval", turnTime: "LO: 48 hrs / Proc: 24 hrs" },
  { key: "clear_to_close", label: "CTC", turnTime: "Pre-CD: 4 hrs / LO: 1 hr" },
  { key: "closing", label: "Closing", turnTime: "24 hrs after date set" },
] as const;

const STAGE_LABELS: Record<string, string> = {
  ...Object.fromEntries(QUESTROCK_STAGES.map((s) => [s.key, s.label])),
  registered: "Registered",
  submission: "Submission",
  conditions: "Conditions",
  funded: "Funded",
  lead: "Lead",
  application: "Application",
};

const SHAPE_LEAD_BASE_URL =
  process.env.NEXT_PUBLIC_SHAPE_LEAD_BASE_URL?.trim() || null;

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type LoanRow = {
  id: string;
  shape_record_id: number | null;
  record_type: string | null;
  borrower_first_name: string | null;
  borrower_last_name: string | null;
  current_stage: string | null;
  closing_date: string | null;
  closed_at: string | null;
  loan_amount_cents: number | null;
  lead_created_at: string | null;
  application_completed_at: string | null;
  loan_type: string | null;
  loan_purpose: string | null;
  track: string | null;
  is_brokered: boolean;
  is_restructure_hold: boolean;
  current_owner_role: string | null;
  esign_returned_at: string | null;
  lock_expiration_date: string | null;
  finance_contingency_date: string | null;
  appraisal_contingency_date: string | null;
  appraisal_ordered_at: string | null;
  loan_stage_events: Array<{ stage: string; entered_at: string }> | null;
  conditions: Array<{ status: "open" | "cleared" }> | null;
};

const PIPED_STAGES: Set<string> = new Set(QUESTROCK_STAGES.map((s) => s.key));

type SlaRow = {
  stage: string;
  max_hours: number | null;
  owner_role: string | null;
  sub_steps: unknown;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function stageLabel(stage: string | null) {
  if (!stage) return "—";
  return STAGE_LABELS[stage] ?? stage;
}

function latestStageEntry(
  events: LoanRow["loan_stage_events"],
  stage: string | null,
) {
  if (!stage) return null;
  const hit = (events ?? [])
    .filter((e) => e.stage === stage)
    .map((e) => new Date(e.entered_at))
    .filter((d) => !Number.isNaN(d.getTime()))
    .sort((a, b) => b.getTime() - a.getTime())[0];
  return hit ?? null;
}

function firstStageEntry(
  events: LoanRow["loan_stage_events"],
  stage: string,
) {
  const hit = (events ?? [])
    .filter((e) => e.stage === stage)
    .map((e) => new Date(e.entered_at))
    .filter((d) => !Number.isNaN(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime())[0];
  return hit ?? null;
}

function fmtHoursLeft(hrs: number): string {
  if (hrs < 0) return `Overdue ${Math.abs(Math.round(hrs))}h`;
  if (hrs < 1) return "< 1 hr";
  if (hrs < 24) return `${Math.round(hrs)}h`;
  const d = Math.floor(hrs / 24);
  const h = Math.round(hrs % 24);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

function fmtDaysLeft(days: number): string {
  if (days < 0) return `Overdue ${Math.abs(days)}d`;
  if (days === 0) return "Today";
  return `${days}d`;
}

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export default async function LoanOfficerDashboardPage() {
  const { appUser } = await requireCurrentUser();
  const supabase = await createSupabaseServerClient();
  const now = new Date();
  const today = startOfDay(now);
  const isPast3PM = now.getHours() >= 15;

  /* ---------- data fetch ---------- */

  const [{ data: slaRows, error: slaError }, { data: loans, error: loansError }] =
    await Promise.all([
      supabase
        .from("sla_thresholds")
        .select("stage,max_hours,owner_role,sub_steps"),
      supabase
        .from("loans")
        .select(
          "id,shape_record_id,record_type,borrower_first_name,borrower_last_name,current_stage,closing_date,closed_at,loan_amount_cents,lead_created_at,application_completed_at,loan_type,loan_purpose,track,is_brokered,is_restructure_hold,current_owner_role,esign_returned_at,lock_expiration_date,finance_contingency_date,appraisal_contingency_date,appraisal_ordered_at,loan_stage_events(stage,entered_at),conditions(status)",
        )
        .order("lead_created_at", { ascending: false, nullsFirst: true })
        .limit(1000),
    ]);

  const dataError = slaError || loansError;
  if (dataError) console.error("Dashboard data error:", dataError.message);

  const slaByStage = new Map<string, number>();
  ((slaRows as SlaRow[] | null) ?? []).forEach((r) => {
    if (r.max_hours != null) slaByStage.set(r.stage, r.max_hours);
  });

  const rows = (loans ?? []) as unknown as LoanRow[];

  /* ---------- computed loan data ---------- */

  const loanWithComputed = rows.map((l) => {
    const openConditions = (l.conditions ?? []).filter(
      (c) => c.status === "open",
    ).length;

    const stageEntered = latestStageEntry(l.loan_stage_events, l.current_stage);
    const hoursInStage = stageEntered
      ? differenceInHours(now, stageEntered)
      : null;
    const daysInStage = stageEntered
      ? differenceInCalendarDays(now, stageEntered)
      : null;

    const slaMaxHours = l.current_stage
      ? (slaByStage.get(l.current_stage) ?? null)
      : null;
    const slaExceeded =
      hoursInStage != null &&
      slaMaxHours != null &&
      slaMaxHours > 0 &&
      hoursInStage > slaMaxHours;

    const closingDate = l.closing_date ? new Date(l.closing_date) : null;
    const daysToClose = closingDate
      ? differenceInCalendarDays(closingDate, today)
      : null;
    const closingSoon =
      daysToClose != null &&
      daysToClose >= 0 &&
      daysToClose <= 5 &&
      l.current_stage !== "funded";

    const daysToLock = l.lock_expiration_date
      ? differenceInCalendarDays(new Date(l.lock_expiration_date), today)
      : null;
    const lockApproaching =
      daysToLock != null && daysToLock >= 0 && daysToLock <= 7;

    const daysToFinCont = l.finance_contingency_date
      ? differenceInCalendarDays(new Date(l.finance_contingency_date), today)
      : null;
    const finContApproaching =
      daysToFinCont != null && daysToFinCont >= 0 && daysToFinCont <= 7;

    const daysToApprCont = l.appraisal_contingency_date
      ? differenceInCalendarDays(new Date(l.appraisal_contingency_date), today)
      : null;
    const apprContApproaching =
      daysToApprCont != null && daysToApprCont >= 0 && daysToApprCont <= 7;

    const esignHrs = l.esign_returned_at
      ? differenceInHours(now, new Date(l.esign_returned_at))
      : null;
    const restructureRisk =
      l.is_restructure_hold || (esignHrs != null && esignHrs >= 40);

    const flag: "red" | "orange" | "yellow" | "green" | "none" = slaExceeded
      ? "red"
      : restructureRisk
        ? "green"
        : closingSoon
          ? "orange"
          : openConditions > 0
            ? "yellow"
            : "none";

    return {
      ...l,
      openConditions,
      hoursInStage,
      daysInStage,
      slaMaxHours,
      slaExceeded,
      closingDate,
      daysToClose,
      closingSoon,
      lockApproaching,
      daysToLock,
      finContApproaching,
      daysToFinCont,
      apprContApproaching,
      daysToApprCont,
      restructureRisk,
      esignHrs,
      flag,
    };
  });

  const commandCenterLoans = loanWithComputed.filter(
    (l) =>
      l.current_stage &&
      PIPED_STAGES.has(l.current_stage) &&
      !!l.appraisal_ordered_at,
  );

  const prePipelineLoans = loanWithComputed.filter(
    (l) =>
      l.current_stage !== "funded" &&
      !(l.current_stage && PIPED_STAGES.has(l.current_stage) && !!l.appraisal_ordered_at),
  );

  const activeLoans = commandCenterLoans;

  /* ---------- Section 1: Goal Banner ---------- */

  const avgDaysToClose = avg(
    loanWithComputed.map((l) => {
      if (!l.lead_created_at || !l.closed_at) return null;
      return differenceInCalendarDays(
        new Date(l.closed_at),
        new Date(l.lead_created_at),
      );
    }),
  );

  /* ---------- Section 2: Action Queue ---------- */

  type UrgencyItem = {
    loan: (typeof loanWithComputed)[number];
    priority: number;
    urgencyLabel: string;
    timeRemaining: string;
    actionNeeded: string;
    rowColor: "red" | "orange" | "yellow" | "none";
  };

  const urgencyItems: UrgencyItem[] = [];

  for (const l of activeLoans) {
    if (l.restructureRisk) {
      const hrsLeft = l.esignHrs != null ? 48 - l.esignHrs : null;
      urgencyItems.push({
        loan: l,
        priority: 1,
        urgencyLabel: "Restructure Risk",
        timeRemaining: hrsLeft != null ? fmtHoursLeft(hrsLeft) : "—",
        actionNeeded: "Submit to processing or restructure",
        rowColor:
          hrsLeft != null && hrsLeft < 0
            ? "red"
            : hrsLeft != null && hrsLeft < 8
              ? "orange"
              : "yellow",
      });
      continue;
    }

    if (l.slaExceeded) {
      const over =
        l.hoursInStage != null && l.slaMaxHours != null
          ? l.hoursInStage - l.slaMaxHours
          : 0;
      urgencyItems.push({
        loan: l,
        priority: 2,
        urgencyLabel: "SLA Exceeded",
        timeRemaining: `Overdue ${Math.round(over)}h`,
        actionNeeded: "Move loan forward",
        rowColor: "red",
      });
      continue;
    }

    if (l.lockApproaching) {
      urgencyItems.push({
        loan: l,
        priority: 3,
        urgencyLabel: "Lock Expiring",
        timeRemaining: fmtDaysLeft(l.daysToLock!),
        actionNeeded: "Verify lock status",
        rowColor:
          l.daysToLock! <= 0 ? "red" : l.daysToLock! <= 2 ? "orange" : "yellow",
      });
      continue;
    }

    if (l.finContApproaching || l.apprContApproaching) {
      const minDays = Math.min(
        l.daysToFinCont ?? 999,
        l.daysToApprCont ?? 999,
      );
      const label =
        l.finContApproaching && l.apprContApproaching
          ? "Dual Contingency"
          : l.finContApproaching
            ? "Finance Contingency"
            : "Appraisal Contingency";
      urgencyItems.push({
        loan: l,
        priority: 4,
        urgencyLabel: label,
        timeRemaining: fmtDaysLeft(minDays),
        actionNeeded: "Clear contingency",
        rowColor: minDays <= 0 ? "red" : minDays <= 2 ? "orange" : "yellow",
      });
      continue;
    }

    if (l.openConditions > 0) {
      urgencyItems.push({
        loan: l,
        priority: 5,
        urgencyLabel: "Open Conditions",
        timeRemaining: `${l.openConditions} open`,
        actionNeeded: "Clear conditions",
        rowColor: "yellow",
      });
      continue;
    }

    if (l.closingSoon) {
      urgencyItems.push({
        loan: l,
        priority: 6,
        urgencyLabel: "Closing Soon",
        timeRemaining: fmtDaysLeft(l.daysToClose!),
        actionNeeded: "Prepare for closing",
        rowColor:
          l.daysToClose! <= 0
            ? "red"
            : l.daysToClose! <= 1
              ? "orange"
              : "yellow",
      });
    }
  }

  urgencyItems.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const colorRank = (c: string) =>
      c === "red" ? 0 : c === "orange" ? 1 : c === "yellow" ? 2 : 3;
    return colorRank(a.rowColor) - colorRank(b.rowColor);
  });
  const actionQueue = urgencyItems.slice(0, 15);

  /* ---------- Section 3: Pipeline ---------- */

  const pipelineData = QUESTROCK_STAGES.map((s) => {
    const stageLoans = activeLoans.filter((l) => l.current_stage === s.key);
    const count = stageLoans.length;
    const anyExceeded = stageLoans.some((l) => l.slaExceeded);
    const anyAtRisk = stageLoans.some((l) => {
      if (l.hoursInStage == null || l.slaMaxHours == null || l.slaMaxHours === 0)
        return false;
      return l.hoursInStage > l.slaMaxHours * 0.75;
    });
    const health: "green" | "yellow" | "red" = anyExceeded
      ? "red"
      : anyAtRisk
        ? "yellow"
        : "green";
    return { ...s, count, health };
  });

  /* ---------- Section 4: Active Loans Table ---------- */

  const FLAG_RANK = { red: 0, green: 1, orange: 2, yellow: 3, none: 4 } as const;

  const activeTable = activeLoans
    .slice()
    .sort((a, b) => {
      const r = FLAG_RANK[a.flag] - FLAG_RANK[b.flag];
      if (r !== 0) return r;
      return (b.daysInStage ?? 0) - (a.daysInStage ?? 0);
    })
    .slice(0, 50);

  /* ---------- Section 5: Production & Speed ---------- */

  const mStart = monthStart();
  const fundedMtd = loanWithComputed.filter((l) => {
    if (!l.closed_at) return false;
    const d = new Date(l.closed_at);
    return d >= mStart && d <= now;
  });

  const mtdVolumeCents = sum(fundedMtd.map((l) => l.loan_amount_cents ?? null));
  const mtdLoansClosed = fundedMtd.length;
  const mtdAvgLoanSize = mtdLoansClosed
    ? Math.round(mtdVolumeCents / mtdLoansClosed)
    : null;
  const revenueBps = 250;
  const revenueCents = Math.round(mtdVolumeCents * (revenueBps / 10_000));

  const upcomingClosingsCount = activeLoans.filter(
    (l) => l.closingDate && l.closingDate >= today,
  ).length;

  const leadToApp = avg(
    loanWithComputed.map((l) => {
      if (!l.lead_created_at || !l.application_completed_at) return null;
      return differenceInCalendarDays(
        new Date(l.application_completed_at),
        new Date(l.lead_created_at),
      );
    }),
  );
  const appToSubmission = avg(
    loanWithComputed.map((l) => {
      if (!l.application_completed_at) return null;
      const sub = firstStageEntry(l.loan_stage_events, "processing");
      if (!sub) return null;
      return differenceInCalendarDays(
        sub,
        new Date(l.application_completed_at),
      );
    }),
  );
  const submissionToCtc = avg(
    loanWithComputed.map((l) => {
      const sub = firstStageEntry(l.loan_stage_events, "processing");
      const ctc = firstStageEntry(l.loan_stage_events, "clear_to_close");
      if (!sub || !ctc) return null;
      return differenceInCalendarDays(ctc, sub);
    }),
  );
  const ctcToClose = avg(
    loanWithComputed.map((l) => {
      const ctc = firstStageEntry(l.loan_stage_events, "clear_to_close");
      if (!ctc || !l.closed_at) return null;
      return differenceInCalendarDays(new Date(l.closed_at), ctc);
    }),
  );
  const totalDaysToClose = avg(
    loanWithComputed.map((l) => {
      if (!l.lead_created_at || !l.closed_at) return null;
      return differenceInCalendarDays(
        new Date(l.closed_at),
        new Date(l.lead_created_at),
      );
    }),
  );

  const colCount = SHAPE_LEAD_BASE_URL ? 11 : 10;

  /* ---------------------------------------------------------------- */
  /*  Render                                                          */
  /* ---------------------------------------------------------------- */

  return (
    <div className="space-y-8">
      {/* ---- error banner ---- */}
      {dataError ? (
        <div className="rounded-lg border border-amber-500/50 bg-amber-50 p-4 text-sm dark:bg-amber-950/30">
          <p className="font-medium">Database setup required</p>
          <p className="mt-1 text-mutedForeground">
            Run the SQL in{" "}
            <code className="rounded bg-muted px-1">supabase/migrations/</code>{" "}
            in your Supabase project. Then refresh.
          </p>
          <p className="mt-2 font-mono text-xs">{dataError.message}</p>
        </div>
      ) : null}

      {/* ---- header ---- */}
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Loan Officer Dashboard</h1>
          <p className="text-sm text-mutedForeground">
            {appUser.full_name} &middot;{" "}
            {appUser.role.replace("_", " ")}
          </p>
        </div>
      </div>

      {/* ================================================================ */}
      {/*  Section 1 — Goal Banner                                        */}
      {/* ================================================================ */}

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold">
              Goal: 14–21 Days to Close
            </span>
            <span
              className={cn(
                "rounded-full px-3 py-1 text-sm font-medium",
                avgDaysToClose != null && avgDaysToClose <= 21
                  ? "bg-green-500/10 text-green-700 dark:text-green-400"
                  : "bg-muted text-mutedForeground",
              )}
            >
              Your avg:{" "}
              {avgDaysToClose != null
                ? `${avgDaysToClose.toFixed(1)} days`
                : "—"}
            </span>
          </div>

          {isPast3PM ? (
            <div className="flex items-center gap-2 rounded-md bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                />
              </svg>
              Submissions after 3 PM will be processed next business day
            </div>
          ) : null}
        </div>
      </section>

      {/* ================================================================ */}
      {/*  Section 2 — Today's Action Queue                               */}
      {/* ================================================================ */}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">
            Today&apos;s Action Queue
          </div>
          <div className="text-xs text-mutedForeground">
            {actionQueue.length} urgent item
            {actionQueue.length !== 1 ? "s" : ""}
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr className="text-left text-xs text-mutedForeground">
                <th className="px-3 py-2">Borrower</th>
                <th className="px-3 py-2">Loan Type</th>
                <th className="px-3 py-2">Stage</th>
                <th className="px-3 py-2">Urgency</th>
                <th className="px-3 py-2">Time Remaining</th>
                <th className="px-3 py-2">Action Needed</th>
              </tr>
            </thead>
            <tbody>
              {actionQueue.map((item) => (
                <tr
                  key={item.loan.id}
                  className={cn(
                    "border-t border-border",
                    item.rowColor === "red" &&
                      "bg-red-50 dark:bg-red-950/20",
                    item.rowColor === "orange" &&
                      "bg-orange-50 dark:bg-orange-950/20",
                    item.rowColor === "yellow" &&
                      "bg-yellow-50 dark:bg-yellow-950/10",
                  )}
                >
                  <td className="px-3 py-2">
                    {item.loan.borrower_first_name ?? ""}{" "}
                    {item.loan.borrower_last_name ?? ""}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {item.loan.loan_type ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    {stageLabel(item.loan.current_stage)}
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      variant={
                        item.rowColor === "red"
                          ? "red"
                          : item.rowColor === "orange"
                            ? "orange"
                            : item.rowColor === "yellow"
                              ? "yellow"
                              : "muted"
                      }
                    >
                      {item.urgencyLabel}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {item.timeRemaining}
                  </td>
                  <td className="px-3 py-2 text-xs text-mutedForeground">
                    {item.actionNeeded}
                  </td>
                </tr>
              ))}
              {actionQueue.length === 0 ? (
                <tr>
                  <td
                    className="px-3 py-6 text-center text-sm text-mutedForeground"
                    colSpan={6}
                  >
                    No urgent items — all loans on track.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {/* ================================================================ */}
      {/*  Pre-Pipeline Summary                                           */}
      {/* ================================================================ */}

      {prePipelineLoans.length > 0 ? (
        <section className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Pre-Pipeline</div>
              <p className="mt-0.5 text-xs text-mutedForeground">
                Files not yet in Command Center &mdash; awaiting appraisal order or pipeline stage assignment
              </p>
            </div>
            <div className="text-2xl font-bold">{prePipelineLoans.length}</div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {(() => {
              const byStage = new Map<string, number>();
              for (const l of prePipelineLoans) {
                const key = l.current_stage ?? "no_stage";
                byStage.set(key, (byStage.get(key) ?? 0) + 1);
              }
              return Array.from(byStage.entries())
                .sort((a, b) => b[1] - a[1])
                .map(([stage, count]) => (
                  <span
                    key={stage}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-xs"
                  >
                    <span className="font-medium">{stageLabel(stage)}</span>
                    <span className="text-mutedForeground">{count}</span>
                  </span>
                ));
            })()}
          </div>
        </section>
      ) : null}

      {/* ================================================================ */}
      {/*  Section 3 — Questrock Pipeline View (Command Center)           */}
      {/* ================================================================ */}

      <section className="space-y-4">
        <div className="text-sm font-semibold">Command Center &mdash; Questrock File Flow</div>

        {/* chevron row */}
        <div className="flex items-center overflow-x-auto pb-2">
          {pipelineData.map((s, i) => (
            <div key={s.key} className="contents">
              <div
                className={cn(
                  "flex min-w-[100px] flex-1 flex-col items-center rounded-lg border-2 px-2 py-3 text-center",
                  s.health === "red"
                    ? "border-red-500 bg-red-500/10"
                    : s.health === "yellow"
                      ? "border-yellow-500 bg-yellow-500/10"
                      : "border-green-500/40 bg-card",
                )}
              >
                <div className="text-[11px] font-semibold">{s.label}</div>
                <div className="mt-1 text-xl font-bold">{s.count}</div>
                <div className="mt-1 text-[10px] leading-tight text-mutedForeground">
                  {s.turnTime}
                </div>
              </div>
              {i < pipelineData.length - 1 ? (
                <svg
                  className="mx-1 h-5 w-5 shrink-0 text-mutedForeground"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="m8.25 4.5 7.5 7.5-7.5 7.5"
                  />
                </svg>
              ) : null}
            </div>
          ))}
        </div>

        {/* compact KPI row */}
        <div className="grid gap-3 md:grid-cols-4">
          <StatCard label="Active Loans" value={activeLoans.length} />
          <StatCard
            label="Conditions Outstanding"
            value={activeLoans.filter((l) => l.openConditions > 0).length}
          />
          <StatCard
            label="Closing Soon"
            value={activeLoans.filter((l) => l.closingSoon).length}
            subtext="Within 5 days"
          />
          <StatCard
            label="Past Turn Time"
            value={activeLoans.filter((l) => l.slaExceeded).length}
            subtext="SLA exceeded"
          />
        </div>
      </section>

      {/* ================================================================ */}
      {/*  Section 4 — Active Loans Table                                 */}
      {/* ================================================================ */}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Active Loans</div>
          <div className="flex items-center gap-2 text-xs text-mutedForeground">
            <Badge variant="red">SLA</Badge>
            <Badge variant="orange">Closing&nbsp;≤5d</Badge>
            <Badge variant="yellow">Conditions</Badge>
            <span className="inline-flex items-center rounded-full border border-transparent bg-green-500 px-2 py-0.5 text-xs font-medium text-white">
              Restructure
            </span>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr className="text-left text-xs text-mutedForeground">
                <th className="px-3 py-2">Loan&nbsp;#</th>
                <th className="px-3 py-2">Borrower</th>
                <th className="px-3 py-2">Loan Type</th>
                <th className="px-3 py-2">Track</th>
                <th className="px-3 py-2">Stage</th>
                <th className="px-3 py-2">Days in Stage</th>
                <th className="px-3 py-2">Owner</th>
                <th className="px-3 py-2">Conditions</th>
                <th className="px-3 py-2">Closing Date</th>
                <th className="px-3 py-2">Flag</th>
                {SHAPE_LEAD_BASE_URL ? (
                  <th className="px-3 py-2">Open</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {activeTable.map((l) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">
                    {l.shape_record_id ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    {l.borrower_first_name ?? ""}{" "}
                    {l.borrower_last_name ?? ""}
                  </td>
                  <td className="px-3 py-2 text-xs">{l.loan_type ?? "—"}</td>
                  <td className="px-3 py-2">
                    {l.track ? (
                      <Badge
                        variant={l.track === "Fast" ? "default" : "muted"}
                      >
                        {l.track}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {stageLabel(l.current_stage)}
                  </td>
                  <td className="px-3 py-2">{l.daysInStage ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    {l.current_owner_role ?? "—"}
                  </td>
                  <td className="px-3 py-2">{l.openConditions}</td>
                  <td className="px-3 py-2">{l.closing_date ?? "—"}</td>
                  <td className="px-3 py-2">
                    {l.flag === "red" ? (
                      <Badge variant="red">SLA</Badge>
                    ) : l.flag === "green" ? (
                      <span className="inline-flex items-center rounded-full border border-transparent bg-green-500 px-2 py-0.5 text-xs font-medium text-white">
                        Restructure
                      </span>
                    ) : l.flag === "orange" ? (
                      <Badge variant="orange">Closing</Badge>
                    ) : l.flag === "yellow" ? (
                      <Badge variant="yellow">Conditions</Badge>
                    ) : (
                      <Badge variant="muted">OK</Badge>
                    )}
                  </td>
                  {SHAPE_LEAD_BASE_URL && l.shape_record_id ? (
                    <td className="px-3 py-2">
                      <a
                        href={`${SHAPE_LEAD_BASE_URL}${l.shape_record_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline"
                      >
                        Shape
                      </a>
                    </td>
                  ) : SHAPE_LEAD_BASE_URL ? (
                    <td className="px-3 py-2">—</td>
                  ) : null}
                </tr>
              ))}
              {activeTable.length === 0 ? (
                <tr>
                  <td
                    className="px-3 py-6 text-center text-sm text-mutedForeground"
                    colSpan={colCount}
                  >
                    No active loans visible yet. Import CSV or generate mock
                    loans in Admin.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {/* ================================================================ */}
      {/*  Section 5 — Production Scoreboard + Speed Metrics              */}
      {/* ================================================================ */}

      <section className="space-y-3">
        <div className="text-sm font-semibold">Production Scoreboard</div>
        <div className="grid gap-3 md:grid-cols-5">
          <StatCard
            label="Month to Date Volume"
            value={formatCurrency(mtdVolumeCents)}
          />
          <StatCard label="Loans Closed" value={mtdLoansClosed} />
          <StatCard
            label="Average Loan Size"
            value={formatCurrency(mtdAvgLoanSize)}
          />
          <StatCard
            label="Revenue Generated"
            value={formatCurrency(revenueCents)}
            subtext={`${revenueBps} bps`}
          />
          <StatCard
            label="Upcoming Closings"
            value={upcomingClosingsCount}
            subtext="Active loans"
          />
        </div>
      </section>

      <section className="space-y-3">
        <div className="text-sm font-semibold">Speed Metrics (avg days)</div>
        <div className="grid gap-3 md:grid-cols-5">
          <StatCard
            label="Lead → Application"
            value={leadToApp?.toFixed(1) ?? "—"}
          />
          <StatCard
            label="Application → Submission"
            value={appToSubmission?.toFixed(1) ?? "—"}
          />
          <StatCard
            label="Submission → CTC"
            value={submissionToCtc?.toFixed(1) ?? "—"}
          />
          <StatCard
            label="CTC → Close"
            value={ctcToClose?.toFixed(1) ?? "—"}
          />
          <StatCard
            label="Total Days to Close"
            value={totalDaysToClose?.toFixed(1) ?? "—"}
          />
        </div>
      </section>
    </div>
  );
}
