import {
  differenceInCalendarDays,
  startOfDay,
  differenceInHours,
} from "date-fns";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireCurrentUser } from "@/lib/current-user";
import { canAccessAdmin } from "@/lib/permissions";
import { StatCard } from "@/components/StatCard";
import { Badge } from "@/components/Badge";
import { PrePipelineDashboard } from "@/components/dashboard/PrePipelineDashboard";
import { PitchQueue } from "@/components/dashboard/PitchQueue";
import { MacroTracker } from "@/components/dashboard/MacroTracker";
import { MicroPipeline, type MicroLoan } from "@/components/dashboard/MicroPipeline";
import { AppraisalTracker } from "@/components/dashboard/AppraisalTracker";
import { Leaderboard } from "@/components/dashboard/Leaderboard";
import { ViewAsSelector } from "@/components/dashboard/ViewAsSelector";
import { avg, formatCurrency, monthStart, yearStart, sum } from "@/lib/metrics";
import {
  isCommandCenterPipelineStatus,
  isTerminalRetailStatus,
  PITCH_QUEUE_SET,
  getPipelineMicroStage,
  MICRO_STAGES,
  MACRO_STAGES,
  isExcludedFromLeaderboard,
  type MicroStageKey,
} from "@/lib/loan-status-groups";
import { cn } from "@/lib/cn";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STAGE_LABELS: Record<string, string> = {
  lead: "Lead",
  application: "Application",
  verification: "Verification",
  esign_out: "eSign Out",
  registered: "Registered",
  processing: "Processing",
  submission: "Submission",
  underwriting: "Underwriting",
  conditions: "Conditions",
  approval_conditions: "Approval",
  clear_to_close: "CTC",
  closing: "Closing",
  funded: "Funded",
};

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type LoanRow = {
  id: string;
  shape_record_id: number | null;
  record_type: string | null;
  status_raw: string | null;
  borrower_first_name: string | null;
  borrower_last_name: string | null;
  current_stage: string | null;
  closing_date: string | null;
  closed_at: string | null;
  funded_at: string | null;
  loan_amount_cents: number | null;
  lead_created_at: string | null;
  application_completed_at: string | null;
  credit_report_requested_at: string | null;
  appraisal_ordered_at: string | null;
  appraisal_received_at: string | null;
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
  lendingpad_loan_uuid: string | null;
  lendingpad_status_raw: string | null;
  loan_stage_events: Array<{ stage: string; entered_at: string }> | null;
  conditions: Array<{ status: "open" | "cleared" }> | null;
};

type SlaRow = {
  stage: string;
  max_hours: number | null;
  owner_role: string | null;
  sub_steps: unknown;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function stageLabel(stage: string | null) {
  if (!stage) return "—";
  return STAGE_LABELS[stage] ?? stage;
}

function latestStageEntry(events: LoanRow["loan_stage_events"], stage: string | null) {
  if (!stage) return null;
  const hit = (events ?? [])
    .filter((e) => e.stage === stage)
    .map((e) => new Date(e.entered_at))
    .filter((d) => !Number.isNaN(d.getTime()))
    .sort((a, b) => b.getTime() - a.getTime())[0];
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
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default async function LoanOfficerDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ viewAs?: string }>;
}) {
  const { appUser } = await requireCurrentUser();
  const now = new Date();
  const today = startOfDay(now);
  const isPast3PM = now.getHours() >= 15;

  /* ---------- viewAs (admin/executive only) ---------- */

  const isAdmin = canAccessAdmin(appUser.role);
  const { viewAs: viewAsId } = await searchParams;
  const effectiveViewAsId = isAdmin && viewAsId ? viewAsId : null;

  /* ---------- fetch all LO users for the selector (admin only) ---------- */

  let loUsersForSelector: Array<{ id: string; full_name: string | null; role: string }> = [];
  let viewAsUser: { id: string; full_name: string | null; role: string } | null = null;

  const adminClient = createSupabaseAdminClient();

  if (isAdmin) {
    const { data: users } = await adminClient
      .from("users")
      .select("id,full_name,role")
      .in("role", ["loan_officer", "manager", "executive"])
      .order("full_name");
    loUsersForSelector = users ?? [];
    viewAsUser = loUsersForSelector.find((u) => u.id === effectiveViewAsId) ?? null;
  }

  /* ---------- data fetch ---------- */

  const LOAN_SELECT =
    "id,shape_record_id,record_type,status_raw,borrower_first_name,borrower_last_name,current_stage,closing_date,closed_at,funded_at,loan_amount_cents,lead_created_at,application_completed_at,credit_report_requested_at,appraisal_ordered_at,appraisal_received_at,loan_type,loan_purpose,track,is_brokered,is_restructure_hold,current_owner_role,esign_returned_at,lock_expiration_date,finance_contingency_date,appraisal_contingency_date,lendingpad_loan_uuid,lendingpad_status_raw,loan_stage_events(stage,entered_at),conditions(status)";

  let loans: LoanRow[] | null = null;
  let loansError: { message: string } | null = null;
  let slaRows: SlaRow[] | null = null;
  let slaError: { message: string } | null = null;

  if (effectiveViewAsId) {
    const [slaRes, loansRes] = await Promise.all([
      adminClient.from("sla_thresholds").select("stage,max_hours,owner_role,sub_steps"),
      adminClient
        .from("loans")
        .select(LOAN_SELECT)
        .eq("assigned_loan_officer_user_id", effectiveViewAsId)
        .order("lead_created_at", { ascending: false, nullsFirst: true })
        .limit(2000),
    ]);
    slaRows = slaRes.data as SlaRow[] | null;
    slaError = slaRes.error;
    loans = loansRes.data as LoanRow[] | null;
    loansError = loansRes.error;
  } else {
    const supabase = await createSupabaseServerClient();
    const [slaRes, loansRes] = await Promise.all([
      supabase.from("sla_thresholds").select("stage,max_hours,owner_role,sub_steps"),
      supabase
        .from("loans")
        .select(LOAN_SELECT)
        .order("lead_created_at", { ascending: false, nullsFirst: true })
        .limit(2000),
    ]);
    slaRows = slaRes.data as SlaRow[] | null;
    slaError = slaRes.error;
    loans = loansRes.data as LoanRow[] | null;
    loansError = loansRes.error;
  }

  const dataError = slaError || loansError;
  if (dataError) console.error("Dashboard data error:", dataError.message);

  const slaByStage = new Map<string, number>();
  ((slaRows as SlaRow[] | null) ?? []).forEach((r) => {
    if (r.max_hours != null) slaByStage.set(r.stage, r.max_hours);
  });

  const rows = (loans ?? []) as unknown as LoanRow[];

  // ── LP-synced vs Shape-only split ─────────────────────────────────────────
  // Pipeline sections (Command Center, Action Queue, etc.) only show loans
  // that are confirmed in LendingPad. Shape-only leads appear in their own
  // section so the LO knows what's missing from LP.
  const lpSyncedRows = rows.filter((l) => !!l.lendingpad_loan_uuid);
  const shapeOnlyRows = rows.filter((l) => !l.lendingpad_loan_uuid);

  const fundedOrClosedAt = (l: Pick<LoanRow, "closed_at" | "funded_at">) =>
    l.closed_at ?? l.funded_at ?? null;

  /* ---------- computed loan data (LP-synced only) ---------- */

  const loanWithComputed = lpSyncedRows.map((l) => {
    const openConditions = (l.conditions ?? []).filter((c) => c.status === "open").length;
    const stageEntered = latestStageEntry(l.loan_stage_events, l.current_stage);
    const hoursInStage = stageEntered ? differenceInHours(now, stageEntered) : null;
    const daysInStage = stageEntered ? differenceInCalendarDays(now, stageEntered) : null;
    const slaMaxHours = l.current_stage ? (slaByStage.get(l.current_stage) ?? null) : null;
    const slaExceeded = hoursInStage != null && slaMaxHours != null && slaMaxHours > 0 && hoursInStage > slaMaxHours;
    const closingDate = l.closing_date ? new Date(l.closing_date) : null;
    const daysToClose = closingDate ? differenceInCalendarDays(closingDate, today) : null;
    const closingSoon = daysToClose != null && daysToClose >= 0 && daysToClose <= 5 && l.current_stage !== "funded";
    const daysToLock = l.lock_expiration_date ? differenceInCalendarDays(new Date(l.lock_expiration_date), today) : null;
    const lockApproaching = daysToLock != null && daysToLock >= 0 && daysToLock <= 7;
    const daysToFinCont = l.finance_contingency_date ? differenceInCalendarDays(new Date(l.finance_contingency_date), today) : null;
    const finContApproaching = daysToFinCont != null && daysToFinCont >= 0 && daysToFinCont <= 7;
    const daysToApprCont = l.appraisal_contingency_date ? differenceInCalendarDays(new Date(l.appraisal_contingency_date), today) : null;
    const apprContApproaching = daysToApprCont != null && daysToApprCont >= 0 && daysToApprCont <= 7;
    const esignHrs = l.esign_returned_at ? differenceInHours(now, new Date(l.esign_returned_at)) : null;
    const restructureRisk = l.is_restructure_hold || (esignHrs != null && esignHrs >= 40);
    const flag: "red" | "orange" | "yellow" | "green" | "none" = slaExceeded
      ? "red"
      : restructureRisk ? "green"
      : closingSoon ? "orange"
      : openConditions > 0 ? "yellow"
      : "none";

    return {
      ...l, openConditions, hoursInStage, daysInStage, slaMaxHours, slaExceeded,
      closingDate, daysToClose, closingSoon, lockApproaching, daysToLock,
      finContApproaching, daysToFinCont, apprContApproaching, daysToApprCont,
      restructureRisk, esignHrs, flag,
    };
  });

  /* ---------- categorize loans using status_raw ---------- */

  const commandCenterLoans = loanWithComputed.filter((l) =>
    isCommandCenterPipelineStatus(l.status_raw, l.current_stage),
  );
  const prePipelineLoans = loanWithComputed.filter(
    (l) =>
      !isCommandCenterPipelineStatus(l.status_raw, l.current_stage) &&
      !isTerminalRetailStatus(l.status_raw, l.current_stage),
  );
  const pitchQueueLoans = loanWithComputed.filter((l) => PITCH_QUEUE_SET.has(l.status_raw ?? ""));

  /* ---------- micro stage grouping ---------- */

  const loansByMicro = new Map<MicroStageKey, MicroLoan[]>();
  for (const l of commandCenterLoans) {
    const micro = getPipelineMicroStage(l.status_raw, l.current_stage);
    if (!micro) continue;
    if (!loansByMicro.has(micro)) loansByMicro.set(micro, []);
    loansByMicro.get(micro)!.push({
      id: l.id,
      shape_record_id: l.shape_record_id,
      borrower_first_name: l.borrower_first_name,
      borrower_last_name: l.borrower_last_name,
      status_raw: l.status_raw,
      loan_type: l.loan_type,
      loan_amount_cents: l.loan_amount_cents,
      lead_created_at: l.lead_created_at,
      closing_date: l.closing_date,
    });
  }

  /* ---------- macro stage data ---------- */

  const macroData = MACRO_STAGES.map((m) => {
    let count = 0;
    let volume = 0;
    for (const mk of m.microKeys) {
      const staged = loansByMicro.get(mk) ?? [];
      count += staged.length;
      volume += staged.reduce((acc, l) => acc + (l.loan_amount_cents ?? 0), 0);
    }
    return { label: m.label, count, volume };
  });

  /* ---------- appraisals pending ---------- */

  const appraisalsPending = loanWithComputed.filter(
    (l) => l.appraisal_ordered_at && !l.appraisal_received_at,
  );

  /* ---------- Goal Banner ---------- */

  const avgDaysToClose = avg(
    loanWithComputed.map((l) => {
      const end = fundedOrClosedAt(l);
      if (!l.lead_created_at || !end) return null;
      return differenceInCalendarDays(new Date(end), new Date(l.lead_created_at));
    }),
  );

  /* ---------- Action Queue ---------- */

  type UrgencyItem = {
    loan: (typeof loanWithComputed)[number];
    priority: number;
    urgencyLabel: string;
    timeRemaining: string;
    actionNeeded: string;
    rowColor: "red" | "orange" | "yellow" | "none";
  };

  const urgencyItems: UrgencyItem[] = [];
  for (const l of commandCenterLoans) {
    if (l.restructureRisk) {
      const hrsLeft = l.esignHrs != null ? 48 - l.esignHrs : null;
      urgencyItems.push({
        loan: l, priority: 1, urgencyLabel: "Restructure Risk",
        timeRemaining: hrsLeft != null ? fmtHoursLeft(hrsLeft) : "—",
        actionNeeded: "Submit to processing or restructure",
        rowColor: hrsLeft != null && hrsLeft < 0 ? "red" : hrsLeft != null && hrsLeft < 8 ? "orange" : "yellow",
      });
      continue;
    }
    if (l.slaExceeded) {
      const over = l.hoursInStage != null && l.slaMaxHours != null ? l.hoursInStage - l.slaMaxHours : 0;
      urgencyItems.push({ loan: l, priority: 2, urgencyLabel: "SLA Exceeded", timeRemaining: `Overdue ${Math.round(over)}h`, actionNeeded: "Move loan forward", rowColor: "red" });
      continue;
    }
    if (l.lockApproaching) {
      urgencyItems.push({ loan: l, priority: 3, urgencyLabel: "Lock Expiring", timeRemaining: fmtDaysLeft(l.daysToLock!), actionNeeded: "Verify lock status", rowColor: l.daysToLock! <= 0 ? "red" : l.daysToLock! <= 2 ? "orange" : "yellow" });
      continue;
    }
    if (l.finContApproaching || l.apprContApproaching) {
      const minDays = Math.min(l.daysToFinCont ?? 999, l.daysToApprCont ?? 999);
      const label = l.finContApproaching && l.apprContApproaching ? "Dual Contingency" : l.finContApproaching ? "Finance Contingency" : "Appraisal Contingency";
      urgencyItems.push({ loan: l, priority: 4, urgencyLabel: label, timeRemaining: fmtDaysLeft(minDays), actionNeeded: "Clear contingency", rowColor: minDays <= 0 ? "red" : minDays <= 2 ? "orange" : "yellow" });
      continue;
    }
    if (l.openConditions > 0) {
      urgencyItems.push({ loan: l, priority: 5, urgencyLabel: "Open Conditions", timeRemaining: `${l.openConditions} open`, actionNeeded: "Clear conditions", rowColor: "yellow" });
      continue;
    }
    if (l.closingSoon) {
      urgencyItems.push({ loan: l, priority: 6, urgencyLabel: "Closing Soon", timeRemaining: fmtDaysLeft(l.daysToClose!), actionNeeded: "Prepare for closing", rowColor: l.daysToClose! <= 0 ? "red" : l.daysToClose! <= 1 ? "orange" : "yellow" });
    }
  }
  urgencyItems.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const colorRank = (c: string) => (c === "red" ? 0 : c === "orange" ? 1 : c === "yellow" ? 2 : 3);
    return colorRank(a.rowColor) - colorRank(b.rowColor);
  });
  const actionQueue = urgencyItems.slice(0, 15);

  /* ---------- Production Scoreboard ---------- */

  const mStart = monthStart();
  const yStart = yearStart();

  const fundedMtd = loanWithComputed.filter((l) => {
    const end = fundedOrClosedAt(l);
    return end && new Date(end) >= mStart && new Date(end) <= now;
  });
  const fundedYtd = loanWithComputed.filter((l) => {
    const end = fundedOrClosedAt(l);
    return end && new Date(end) >= yStart && new Date(end) <= now;
  });

  const mtdVolumeCents = sum(fundedMtd.map((l) => l.loan_amount_cents ?? null));
  const ytdVolumeCents = sum(fundedYtd.map((l) => l.loan_amount_cents ?? null));
  const mtdLoansClosed = fundedMtd.length;
  const mtdAvgLoanSize = mtdLoansClosed ? Math.round(mtdVolumeCents / mtdLoansClosed) : null;
  const upcomingClosingsCount = commandCenterLoans.filter((l) => l.closingDate && l.closingDate >= today).length;

  /* ---------- Speed Metrics ---------- */

  const leadToCredit = avg(
    loanWithComputed.map((l) => {
      if (!l.lead_created_at || !l.credit_report_requested_at) return null;
      return differenceInCalendarDays(new Date(l.credit_report_requested_at), new Date(l.lead_created_at));
    }),
  );
  const creditToPiped = avg(
    loanWithComputed.map((l) => {
      if (!l.credit_report_requested_at || !l.appraisal_ordered_at) return null;
      return differenceInCalendarDays(new Date(l.appraisal_ordered_at), new Date(l.credit_report_requested_at));
    }),
  );
  const pipedToClosed = avg(
    loanWithComputed.map((l) => {
      const end = fundedOrClosedAt(l);
      if (!l.appraisal_ordered_at || !end) return null;
      return differenceInCalendarDays(new Date(end), new Date(l.appraisal_ordered_at));
    }),
  );
  const totalDaysToClose = avg(
    loanWithComputed.map((l) => {
      const end = fundedOrClosedAt(l);
      if (!l.lead_created_at || !end) return null;
      return differenceInCalendarDays(new Date(end), new Date(l.lead_created_at));
    }),
  );

  /* ---------- Leaderboard (all LOs via admin client) ---------- */

  type LeaderboardEntry = { name: string; creditPulls: number; appraisalsOrdered: number; closedLoans: number; fundedVolumeCents: number };
  let leaderboardData: LeaderboardEntry[] = [];

  try {
    const { data: allUsers } = await adminClient
      .from("users")
      .select("id,full_name,role")
      .in("role", ["loan_officer"]);

    const eligibleUsers = (allUsers ?? []).filter((u) => !isExcludedFromLeaderboard(u.full_name));

    if (eligibleUsers.length > 0) {
      const { data: allLoans } = await adminClient
        .from("loans")
        .select("assigned_loan_officer_user_id,credit_report_requested_at,appraisal_ordered_at,closed_at,funded_at,loan_amount_cents")
        .in("assigned_loan_officer_user_id", eligibleUsers.map((u) => u.id))
        .limit(5000);

      const userMap = new Map(eligibleUsers.map((u) => [u.id, u.full_name ?? "Unknown"]));
      const stats = new Map<string, LeaderboardEntry>();
      for (const u of eligibleUsers) {
        stats.set(u.id, { name: u.full_name ?? "Unknown", creditPulls: 0, appraisalsOrdered: 0, closedLoans: 0, fundedVolumeCents: 0 });
      }
      for (const loan of allLoans ?? []) {
        const uid = loan.assigned_loan_officer_user_id;
        if (!uid || !stats.has(uid)) continue;
        const s = stats.get(uid)!;
        if (loan.credit_report_requested_at) s.creditPulls++;
        if (loan.appraisal_ordered_at) s.appraisalsOrdered++;
        const endAt = loan.closed_at ?? loan.funded_at;
        if (endAt) {
          s.closedLoans++;
          s.fundedVolumeCents += loan.loan_amount_cents ?? 0;
        }
      }
      leaderboardData = Array.from(stats.values());
    }
  } catch {
    // leaderboard is best-effort
  }

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div className="space-y-8">
      {dataError ? (
        <div className="rounded-lg border border-amber-500/50 bg-amber-50 p-4 text-sm dark:bg-amber-950/30">
          <p className="font-medium">Database setup required</p>
          <p className="mt-1 text-mutedForeground">
            Run the SQL in <code className="rounded bg-muted px-1">supabase/migrations/</code> in your Supabase project. Then refresh.
          </p>
          <p className="mt-2 font-mono text-xs">{dataError.message}</p>
        </div>
      ) : null}

      {isAdmin && <ViewAsSelector users={loUsersForSelector} currentViewAs={effectiveViewAsId} />}

      <div className="flex items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-bold tracking-tight">Loan Officer Dashboard</h1>
          <p className="text-sm text-mutedForeground">
            {viewAsUser ? (
              <>
                <span className="text-xs uppercase tracking-wide text-mutedForeground/60 mr-1">Viewing as</span>
                {viewAsUser.full_name} &middot; {viewAsUser.role.replace("_", " ")}
              </>
            ) : (
              <>{appUser.full_name} &middot; {appUser.role.replace("_", " ")}</>
            )}
          </p>
        </div>
      </div>

      {/* ================================================================ */}
      {/*  Goal Banner                                                     */}
      {/* ================================================================ */}

      <section
        className="rounded-xl p-4"
        style={{
          background: "rgba(255,255,255,0.03)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          border: "1px solid rgba(255,255,255,0.07)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-foreground">Goal: 14–21 Days to Close</span>
            <span
              className="rounded-full px-3 py-1 text-sm font-semibold"
              style={
                avgDaysToClose != null && avgDaysToClose <= 21
                  ? { background: "rgba(232,255,0,0.12)", color: "#E8FF00" }
                  : { background: "hsl(220 10% 18%)", color: "hsl(215 14% 52%)" }
              }
            >
              Your avg: {avgDaysToClose != null ? `${avgDaysToClose.toFixed(1)} days` : "—"}
            </span>
          </div>
          {isPast3PM ? (
            <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-400">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              Submissions after 3 PM will be processed next business day
            </div>
          ) : null}
        </div>
      </section>

      {/* ================================================================ */}
      {/*  Today's Action Queue                                            */}
      {/* ================================================================ */}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold tracking-tight">Today&apos;s Action Queue</div>
          <div className="rounded-full px-2.5 py-0.5 text-[11px] font-medium"
            style={{ background: "rgba(232,255,0,0.1)", color: "#E8FF00" }}>
            {actionQueue.length} urgent item{actionQueue.length !== 1 ? "s" : ""}
          </div>
        </div>
        <div
          className="overflow-hidden rounded-xl"
          style={{
            background: "rgba(255,255,255,0.02)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: "1px solid rgba(255,255,255,0.07)",
          }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest text-mutedForeground"
                style={{ background: "rgba(255,255,255,0.04)" }}>
                <th className="px-3 py-2.5">Borrower</th>
                <th className="px-3 py-2.5">Loan Type</th>
                <th className="px-3 py-2.5">Stage</th>
                <th className="px-3 py-2.5">Urgency</th>
                <th className="px-3 py-2.5">Time Remaining</th>
                <th className="px-3 py-2.5">Action Needed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {actionQueue.map((item) => (
                <tr key={item.loan.id} className={cn(
                  "transition-colors",
                  item.rowColor === "red" && "bg-red-950/20",
                  item.rowColor === "orange" && "bg-orange-950/20",
                  item.rowColor === "yellow" && "bg-yellow-950/10",
                )}>
                  <td className="px-3 py-2.5">{item.loan.borrower_first_name ?? ""} {item.loan.borrower_last_name ?? ""}</td>
                  <td className="px-3 py-2.5 text-xs text-mutedForeground">{item.loan.loan_type ?? "—"}</td>
                  <td className="px-3 py-2.5">{stageLabel(item.loan.current_stage)}</td>
                  <td className="px-3 py-2.5"><Badge variant={item.rowColor === "red" ? "red" : item.rowColor === "orange" ? "orange" : item.rowColor === "yellow" ? "yellow" : "muted"}>{item.urgencyLabel}</Badge></td>
                  <td className="px-3 py-2.5 font-mono text-xs">{item.timeRemaining}</td>
                  <td className="px-3 py-2.5 text-xs text-mutedForeground">{item.actionNeeded}</td>
                </tr>
              ))}
              {actionQueue.length === 0 ? (
                <tr><td className="px-3 py-6 text-center text-sm text-mutedForeground" colSpan={6}>No urgent items — all loans on track.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {/* ================================================================ */}
      {/*  Pre-Pipeline                                                    */}
      {/* ================================================================ */}

      {prePipelineLoans.length > 0 ? (
        <PrePipelineDashboard
          loans={prePipelineLoans.map((l) => ({
            id: l.id, shape_record_id: l.shape_record_id, borrower_first_name: l.borrower_first_name,
            borrower_last_name: l.borrower_last_name, status_raw: l.status_raw, loan_type: l.loan_type,
            record_type: l.record_type, loan_amount_cents: l.loan_amount_cents, lead_created_at: l.lead_created_at,
          }))}
        />
      ) : null}

      {/* ================================================================ */}
      {/*  Pitch Queue                                                     */}
      {/* ================================================================ */}

      <PitchQueue
        loans={pitchQueueLoans.map((l) => ({
          id: l.id, shape_record_id: l.shape_record_id, borrower_first_name: l.borrower_first_name,
          borrower_last_name: l.borrower_last_name, status_raw: l.status_raw, loan_type: l.loan_type,
          loan_amount_cents: l.loan_amount_cents, lead_created_at: l.lead_created_at,
        }))}
      />

      {/* ================================================================ */}
      {/*  Command Center                                                  */}
      {/* ================================================================ */}

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="h-1 w-4 rounded-full" style={{ background: "#E8FF00" }} />
          <div className="text-sm font-semibold tracking-tight">Command Center &mdash; Questrock File Flow</div>
        </div>

        {/* 4-step macro tracker */}
        <MacroTracker steps={macroData} />

        {/* micro pipeline */}
        <MicroPipeline loansByMicro={loansByMicro} />

        {/* compact KPI row */}
        <div className="grid gap-3 md:grid-cols-4">
          <StatCard label="Active Loans" value={commandCenterLoans.length} />
          <StatCard label="Conditions Outstanding" value={commandCenterLoans.filter((l) => l.openConditions > 0).length} />
          <StatCard label="Closing Soon" value={commandCenterLoans.filter((l) => l.closingSoon).length} subtext="Within 5 days" />
          <StatCard label="Past Turn Time" value={commandCenterLoans.filter((l) => l.slaExceeded).length} subtext="SLA exceeded" />
        </div>
      </section>

      {/* ================================================================ */}
      {/*  Appraisal Tracker                                               */}
      {/* ================================================================ */}

      <AppraisalTracker
        loans={appraisalsPending.map((l) => ({
          id: l.id, shape_record_id: l.shape_record_id, borrower_first_name: l.borrower_first_name,
          borrower_last_name: l.borrower_last_name, loan_type: l.loan_type,
          loan_amount_cents: l.loan_amount_cents, appraisal_ordered_at: l.appraisal_ordered_at,
        }))}
      />

      {/* ================================================================ */}
      {/*  Production Scoreboard                                           */}
      {/* ================================================================ */}

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-1 w-4 rounded-full" style={{ background: "#E8FF00" }} />
          <div className="text-sm font-semibold tracking-tight">Production Scoreboard</div>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <StatCard label="Month to Date Volume" value={formatCurrency(mtdVolumeCents)} />
          <StatCard label="Year to Date Volume" value={formatCurrency(ytdVolumeCents)} />
          <StatCard label="Loans Closed (MTD)" value={mtdLoansClosed} />
          <StatCard label="Average Loan Size" value={formatCurrency(mtdAvgLoanSize)} />
        </div>
      </section>

      {/* ================================================================ */}
      {/*  LO Leaderboard                                                  */}
      {/* ================================================================ */}

      {leaderboardData.length > 0 && <Leaderboard data={leaderboardData} />}

      {/* ================================================================ */}
      {/*  Speed Metrics                                                   */}
      {/* ================================================================ */}

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-1 w-4 rounded-full" style={{ background: "#E8FF00" }} />
          <div className="text-sm font-semibold tracking-tight">Speed Metrics (avg days)</div>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <StatCard label="Lead → Credit" value={leadToCredit?.toFixed(1) ?? "—"} />
          <StatCard label="Credit → Piped" value={creditToPiped?.toFixed(1) ?? "—"} />
          <StatCard label="Piped → Closed" value={pipedToClosed?.toFixed(1) ?? "—"} />
          <StatCard label="Total Days to Close" value={totalDaysToClose?.toFixed(1) ?? "—"} />
        </div>
      </section>

      {/* ================================================================ */}
      {/*  In Shape, Not in LendingPad                                     */}
      {/* ================================================================ */}

      {shapeOnlyRows.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="h-1 w-4 rounded-full" style={{ background: "rgba(245,158,11,0.8)" }} />
            <div className="text-sm font-semibold tracking-tight">
              In Shape, Not in LendingPad
            </div>
            <span
              className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
              style={{ background: "rgba(245,158,11,0.12)", color: "#fbbf24" }}
            >
              {shapeOnlyRows.length}
            </span>
          </div>
          <p className="text-xs text-mutedForeground">
            These leads exist in Shape but have no linked LendingPad loan. They do not appear in the pipeline above.
          </p>
          <div
            className="overflow-hidden rounded-xl"
            style={{
              border: "1px solid rgba(245,158,11,0.18)",
              background: "rgba(245,158,11,0.03)",
            }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="text-left text-[11px] uppercase tracking-widest text-mutedForeground"
                  style={{ background: "rgba(255,255,255,0.03)" }}
                >
                  <th className="px-4 py-2.5">Borrower</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Loan Type</th>
                  <th className="px-4 py-2.5 text-right">Amount</th>
                  <th className="px-4 py-2.5">Lead Created</th>
                  <th className="px-4 py-2.5 text-right">Shape #</th>
                </tr>
              </thead>
              <tbody>
                {shapeOnlyRows
                  .filter(
                    (l) =>
                      !isTerminalRetailStatus(l.status_raw, l.current_stage)
                  )
                  .sort((a, b) => {
                    const da = a.lead_created_at ? new Date(a.lead_created_at).getTime() : 0;
                    const db = b.lead_created_at ? new Date(b.lead_created_at).getTime() : 0;
                    return db - da;
                  })
                  .slice(0, 50)
                  .map((l) => (
                    <tr
                      key={l.id}
                      className="transition-colors hover:bg-white/[0.02]"
                      style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
                    >
                      <td className="px-4 py-3 font-medium text-foreground">
                        {[l.borrower_first_name, l.borrower_last_name].filter(Boolean).join(" ") || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
                          style={{ background: "rgba(245,158,11,0.12)", color: "#fbbf24" }}
                        >
                          {l.status_raw ?? l.current_stage ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-mutedForeground">
                        {l.loan_type ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-mutedForeground">
                        {l.loan_amount_cents
                          ? formatCurrency(l.loan_amount_cents)
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-mutedForeground">
                        {l.lead_created_at
                          ? new Date(l.lead_created_at).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-mutedForeground">
                        {l.shape_record_id ?? "—"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
