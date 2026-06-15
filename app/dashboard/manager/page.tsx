import { differenceInCalendarDays, format, startOfDay } from "date-fns";
import { notFound } from "next/navigation";
import { Badge } from "@/components/Badge";
import { StatCard } from "@/components/StatCard";
import { requireCurrentUser } from "@/lib/current-user";
import { canViewManagerDashboard } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatCurrency, monthStart, sum } from "@/lib/metrics";
import { SLA_BREACH_LABELS } from "@/lib/sla/compute";
import { shapeLeadUrl } from "@/lib/shape-link";

type LoanRow = {
  id: string;
  shape_record_id: number | null;
  borrower_first_name: string | null;
  borrower_last_name: string | null;
  borrower_phone: string | null;
  source: string | null;
  current_stage: string | null;
  status_raw: string | null;
  closing_date: string | null;
  closed_at: string | null;
  funded_at: string | null;
  loan_amount_cents: number | null;
  lead_created_at: string | null;
  assigned_loan_officer_user_id: string | null;
  assigned_loan_officer_name: string | null;
  lendingpad_loan_uuid: string | null;
  appraisal_payment_collected_at: string | null;
  loan_stage_events: Array<{ entered_at: string }> | null;
  conditions: Array<{ status: "open" | "cleared" }> | null;
};

function daysInStage(events: Array<{ entered_at: string }> | null | undefined): number | null {
  const latest = (events ?? [])
    .map((e) => new Date(e.entered_at))
    .filter((d) => !Number.isNaN(d.getTime()))
    .sort((a, b) => b.getTime() - a.getTime())[0];
  if (!latest) return null;
  return differenceInCalendarDays(new Date(), latest);
}

function borrowerName(l: { borrower_first_name: string | null; borrower_last_name: string | null }) {
  return [l.borrower_first_name, l.borrower_last_name].filter(Boolean).join(" ") || "—";
}

function stageLabel(s: string | null) {
  if (!s) return "—";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatClosingDate(d: string) {
  try {
    return format(new Date(d), "MMM d");
  } catch {
    return d;
  }
}

// ─── Small inline components ────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[13px] font-semibold uppercase tracking-widest text-mutedForeground">
        {children}
      </span>
      <div className="h-px flex-1" style={{ background: "rgba(255,255,255,0.06)" }} />
    </div>
  );
}

function EmptyRow({ cols, message }: { cols: number; message: string }) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-6 text-center text-sm text-mutedForeground">
        {message}
      </td>
    </tr>
  );
}

function ConditionPill({ count }: { count: number }) {
  if (count === 0) return <span className="text-mutedForeground">—</span>;
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ background: "rgba(239,68,68,0.15)", color: "#f87171" }}
    >
      {count} open
    </span>
  );
}

function DaysOverBadge({ days, sla }: { days: number; sla: number }) {
  const over = days - sla;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums"
      style={{ background: "rgba(239,68,68,0.15)", color: "#f87171" }}
    >
      {days}d
      <span style={{ color: "rgba(248,113,113,0.6)" }}>+{over}</span>
    </span>
  );
}

function DaysWarningBadge({ days }: { days: number }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums"
      style={{ background: "rgba(245,158,11,0.15)", color: "#fbbf24" }}
    >
      {days}d left
    </span>
  );
}

function OverdueBadge({ daysLate }: { daysLate: number }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums"
      style={{ background: "rgba(239,68,68,0.18)", color: "#f87171" }}
    >
      {daysLate}d late
    </span>
  );
}

function TableWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{
        border: "1px solid rgba(255,255,255,0.07)",
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-mutedForeground ${right ? "text-right" : "text-left"}`}
      style={{ background: "rgba(255,255,255,0.03)" }}
    >
      {children}
    </th>
  );
}

function Td({ children, right, mono }: { children: React.ReactNode; right?: boolean; mono?: boolean }) {
  return (
    <td
      className={`px-4 py-3 ${right ? "text-right" : ""} ${mono ? "font-mono text-xs" : ""}`}
      style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
    >
      {children}
    </td>
  );
}

// ─── LO card (Who Has What grid) ────────────────────────────────────────────

function LoCard({
  name,
  active,
  stuck,
  closingThisWeek,
  mtdLoans,
  mtdVolumeCents,
}: {
  name: string;
  active: number;
  stuck: number;
  closingThisWeek: number;
  mtdLoans: number;
  mtdVolumeCents: number;
}) {
  const hasIssues = stuck > 0;
  return (
    <div
      className="relative overflow-hidden rounded-xl p-4 transition-all duration-150"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: hasIssues
          ? "1px solid rgba(239,68,68,0.25)"
          : "1px solid rgba(255,255,255,0.07)",
        boxShadow: hasIssues ? "0 0 0 1px rgba(239,68,68,0.10) inset" : undefined,
      }}
    >
      {/* Status dot */}
      <div
        className="absolute right-3 top-3 h-2 w-2 rounded-full"
        style={{ background: hasIssues ? "#ef4444" : "#22c55e" }}
      />

      {/* Name */}
      <div className="mb-3 pr-4 text-sm font-semibold text-foreground">{name}</div>

      {/* Mini stats row */}
      <div className="mb-3 grid grid-cols-3 gap-2">
        <div className="text-center">
          <div className="text-lg font-bold tabular-nums text-foreground">{active}</div>
          <div className="text-[10px] text-mutedForeground">Active</div>
        </div>
        <div className="text-center">
          <div
            className="text-lg font-bold tabular-nums"
            style={{ color: stuck > 0 ? "#f87171" : "var(--foreground)" }}
          >
            {stuck}
          </div>
          <div className="text-[10px] text-mutedForeground">Stuck</div>
        </div>
        <div className="text-center">
          <div
            className="text-lg font-bold tabular-nums"
            style={{ color: closingThisWeek > 0 ? "#E8FF00" : "var(--foreground)" }}
          >
            {closingThisWeek}
          </div>
          <div className="text-[10px] text-mutedForeground">Closing</div>
        </div>
      </div>

      {/* MTD footer */}
      <div
        className="rounded-lg px-2.5 py-1.5 text-xs"
        style={{ background: "rgba(255,255,255,0.04)" }}
      >
        <span className="text-mutedForeground">MTD </span>
        <span className="font-medium text-foreground">{mtdLoans} loans</span>
        <span className="mx-1.5 text-mutedForeground">/</span>
        <span className="font-medium text-foreground">{formatCurrency(mtdVolumeCents)}</span>
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function ManagerDashboardPage() {
  const { appUser } = await requireCurrentUser();
  if (!canViewManagerDashboard(appUser.role)) notFound();

  const supabase = await createSupabaseServerClient();

  const [{ data: slaRows, error: slaError }, { data: teamRows, error: teamErr }, { data: loans, error: loansErr }, { data: activeLoUsers }] =
    await Promise.all([
      supabase.from("sla_thresholds").select("stage,max_days"),
      supabase.from("teams").select("id,name,manager_user_id"),
      supabase
        .from("loans")
        .select(
          "id,shape_record_id,borrower_first_name,borrower_last_name,borrower_phone,source,current_stage,status_raw,closing_date,closed_at,funded_at,loan_amount_cents,lead_created_at,assigned_loan_officer_user_id,assigned_loan_officer_name,lendingpad_loan_uuid,appraisal_payment_collected_at,loan_stage_events(entered_at),conditions(status)"
        )
        .limit(1000),
      // Only LOs and managers who are active — used to filter the "Who Has What" grid.
      // Executives (Bill, Ray, Nikk) are excluded; they don't work the pipeline as LOs.
      supabase
        .from("users")
        .select("id,full_name")
        .in("role", ["loan_officer", "manager"])
        .eq("is_active", true),
    ]);

  if (slaError) throw slaError;
  if (teamErr) throw teamErr;
  if (loansErr) throw loansErr;

  const teams = (teamRows ?? []).filter((t) => t.manager_user_id === appUser.id);
  if (!teams.length && appUser.role === "manager") {
    return (
      <div className="space-y-2 p-6">
        <h1 className="text-xl font-semibold">Manager</h1>
        <p className="text-sm text-mutedForeground">No team has been assigned to you yet.</p>
      </div>
    );
  }

  const slaByStage = new Map<string, number>();
  (slaRows ?? []).forEach((r) => slaByStage.set(r.stage, r.max_days));

  const today = startOfDay(new Date());
  const mStart = monthStart();
  const sevenDaysOut = new Date(today);
  sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);

  const loanRows = (loans ?? []) as unknown as LoanRow[];
  const activeLoans = loanRows.filter(
    (l) => l.current_stage && !["funded", "closed", "withdrawn", "denied"].includes(l.current_stage)
  );

  // Annotate every active loan with SLA info
  type AnnotatedLoan = LoanRow & {
    daysInCurrentStage: number | null;
    slaMax: number | null;
    slaExceeded: boolean;
    daysOverSla: number;
    openConditions: number;
  };

  const annotated: AnnotatedLoan[] = activeLoans.map((l) => {
    const d = daysInStage(l.loan_stage_events);
    const slaMax = l.current_stage ? (slaByStage.get(l.current_stage) ?? null) : null;
    const exceeded = d != null && slaMax != null && d > slaMax;
    const openConditions = (l.conditions ?? []).filter((c) => c.status === "open").length;
    return {
      ...l,
      daysInCurrentStage: d,
      slaMax,
      slaExceeded: exceeded,
      daysOverSla: exceeded && d != null && slaMax != null ? d - slaMax : 0,
      openConditions,
    };
  });

  // ── Section 1: What's Not Moving (SLA exceeded) ──────────────────────────
  const stuckLoans = annotated
    .filter((l) => l.slaExceeded)
    .sort((a, b) => (b.daysOverSla ?? 0) - (a.daysOverSla ?? 0))
    .slice(0, 30);

  // ── 5 specific "Not Moving" sub-lists (Ray's rules) ───────────────────────

  // 1. New leads > 24h untouched (no activity in lead/application stage)
  const untouchedLeads = loanRows
    .filter((l) => {
      if (!l.lead_created_at) return false;
      const hrs = differenceInCalendarDays(today, new Date(l.lead_created_at)) * 24;
      const isNewStage = l.current_stage === "lead" || l.current_stage === "application";
      const isNewStatus = ["New Lead", "Not Contacted", "Attempting Contact"].includes(l.status_raw ?? "");
      return (isNewStage || isNewStatus) && hrs >= 1; // created at least 24h ago
    })
    .sort((a, b) => {
      const da = a.lead_created_at ? new Date(a.lead_created_at).getTime() : 0;
      const db = b.lead_created_at ? new Date(b.lead_created_at).getTime() : 0;
      return da - db; // oldest first
    })
    .slice(0, 20);

  // 2. Not Contacted leads that haven't advanced
  const notContactedStuck = loanRows
    .filter((l) => l.status_raw === "Not Contacted" || l.status_raw === "Attempting Contact")
    .sort((a, b) => {
      const da = a.lead_created_at ? new Date(a.lead_created_at).getTime() : 0;
      const db = b.lead_created_at ? new Date(b.lead_created_at).getTime() : 0;
      return da - db;
    })
    .slice(0, 20);

  // 3. Pitched and Waiting > 24h
  const pitchedWaiting = loanRows
    .filter((l) => l.status_raw === "Pitched and Waiting")
    .sort((a, b) => {
      const da = a.lead_created_at ? new Date(a.lead_created_at).getTime() : 0;
      const db = b.lead_created_at ? new Date(b.lead_created_at).getTime() : 0;
      return da - db;
    })
    .slice(0, 20);

  // 4. Pre-pipe stalled (in Pre-Pipe for > 3 days without moving to Package)
  const prePipeStalled = loanRows
    .filter((l) => l.status_raw === "Pre-Pipe" || l.current_stage === "registered")
    .map((l) => ({
      ...l,
      daysStuck: l.lead_created_at ? differenceInCalendarDays(today, new Date(l.lead_created_at)) : null,
    }))
    .filter((l) => (l.daysStuck ?? 0) > 2)
    .sort((a, b) => (b.daysStuck ?? 0) - (a.daysStuck ?? 0))
    .slice(0, 20);

  // 5. Signed Not Piped without appraisal payment
  const signedNoAppraisal = loanRows
    .filter(
      (l) =>
        (l.status_raw === "Signed Not Piped" || l.status_raw === "Package Out" || l.status_raw === "Signed") &&
        !l.appraisal_payment_collected_at,
    )
    .slice(0, 20);

  // ── Section 2a: What's Late — overdue closings ────────────────────────────
  const overdueClosings = activeLoans
    .filter((l) => l.closing_date && new Date(l.closing_date) < today && !l.closed_at)
    .map((l) => ({
      ...l,
      daysLate: differenceInCalendarDays(today, new Date(l.closing_date!)),
      openConditions: (l.conditions ?? []).filter((c) => c.status === "open").length,
    }))
    .sort((a, b) => b.daysLate - a.daysLate)
    .slice(0, 20);

  // ── Section 2b: What's Late — at-risk (closing within 7 days, open conds) ─
  const atRiskClosings = activeLoans
    .filter((l) => {
      if (!l.closing_date) return false;
      const cd = new Date(l.closing_date);
      return cd >= today && cd <= sevenDaysOut;
    })
    .map((l) => ({
      ...l,
      daysLeft: differenceInCalendarDays(new Date(l.closing_date!), today),
      openConditions: (l.conditions ?? []).filter((c) => c.status === "open").length,
    }))
    .filter((l) => l.openConditions > 0)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 20);

  // ── Section 3: Who Has What — per-LO stats ───────────────────────────────
  // Build an allowlist of active LO/manager user IDs and names.
  // This filters out executives (Bill, Ray, Nikk), deactivated users
  // (Jessica Sherard etc.), and unknown legacy names.
  const allowedUserIds = new Set((activeLoUsers ?? []).map((u) => u.id as string));
  const allowedNamesNorm = new Set(
    (activeLoUsers ?? []).map((u) => (u.full_name as string ?? "").trim().toLowerCase())
  );

  const perLo = new Map<
    string,
    {
      name: string;
      active: number;
      stuck: number;
      closingThisWeek: number;
      mtdLoans: number;
      mtdVolumeCents: number;
    }
  >();

  for (const l of loanRows) {
    // Skip loans not assigned to an active LO/manager
    const loId = l.assigned_loan_officer_user_id;
    const loNameRaw = (l.assigned_loan_officer_name ?? "").trim();
    const loNameNorm = loNameRaw.toLowerCase();

    if (loId && !allowedUserIds.has(loId)) continue;
    if (!loId && (!loNameNorm || !allowedNamesNorm.has(loNameNorm))) continue;

    const key = loId ?? loNameRaw;
    const name = loNameRaw || "Unassigned";
    const row = perLo.get(key) ?? {
      name,
      active: 0,
      stuck: 0,
      closingThisWeek: 0,
      mtdLoans: 0,
      mtdVolumeCents: 0,
    };

    const isActive = l.current_stage && !["funded", "closed", "withdrawn", "denied"].includes(l.current_stage);
    if (isActive) row.active += 1;

    // Count stuck (we'll cross-reference annotated)
    const endAt = l.closed_at ?? l.funded_at;
    if (endAt && new Date(endAt) >= mStart) {
      row.mtdLoans += 1;
      row.mtdVolumeCents += l.loan_amount_cents ?? 0;
    }

    if (l.closing_date) {
      const cd = new Date(l.closing_date);
      if (cd >= today && cd <= sevenDaysOut) row.closingThisWeek += 1;
    }

    perLo.set(key, row);
  }

  // Add stuck count from the annotated list
  for (const l of stuckLoans) {
    const key = l.assigned_loan_officer_user_id ?? (l.assigned_loan_officer_name ?? "").trim();
    const row = perLo.get(key);
    if (row) row.stuck += 1;
  }

  // perLo only contains allowed users (allowlist above already filtered it)
  const loCards = [...perLo.values()]
    .sort((a, b) => b.active - a.active || b.mtdVolumeCents - a.mtdVolumeCents);

  // ── Top-level stats ───────────────────────────────────────────────────────
  const fundedMtd = loanRows.filter((l) => {
    const end = l.closed_at ?? l.funded_at;
    return end && new Date(end) >= mStart;
  });
  const mtdVolumeCents = sum(fundedMtd.map((l) => l.loan_amount_cents ?? null));
  const closingThisWeek = activeLoans.filter((l) => {
    if (!l.closing_date) return false;
    const cd = new Date(l.closing_date);
    return cd >= today && cd <= sevenDaysOut;
  }).length;
  const lpSyncedCount = activeLoans.filter((l) => !!l.lendingpad_loan_uuid).length;

  const teamLabel = teams.map((t) => t.name).join(", ") || "All teams";

  // ── SLA view data (from 15-min sync) ─────────────────────────────────────
  type SlaViewRow = {
    loan_id: string;
    borrower_name: string | null;
    lo_name: string | null;
    status_raw: string | null;
    current_stage: string | null;
    sla_color: "green" | "yellow" | "red";
    sla_breach_type: string | null;
    hours_since_last_activity: number | null;
    lead_created_at: string | null;
    touched_today: boolean;
  };

  type DailyActivityRow = {
    lo_name: string | null;
    loans_touched_today: number;
    status_changes_today: number;
    notes_today: number;
    new_leads_today: number;
    last_activity_at: string | null;
  };

  let slaAlerts: SlaViewRow[] = [];
  let dailyActivity: DailyActivityRow[] = [];
  let unassignedLoans: Array<{ id: string; borrower_first_name: string | null; borrower_last_name: string | null; status_raw: string | null; current_stage: string | null; lead_created_at: string | null }> = [];

  try {
    const [slaRes, activityRes, unassignedRes] = await Promise.all([
      supabase
        .from("v_lead_sla_status")
        .select("loan_id,borrower_name,lo_name,status_raw,current_stage,sla_color,sla_breach_type,hours_since_last_activity,lead_created_at,touched_today")
        .in("sla_color", ["red", "yellow"])
        .order("sla_color", { ascending: true })
        .order("hours_since_last_activity", { ascending: false })
        .limit(60),
      supabase
        .from("v_daily_activity_summary")
        .select("lo_name,loans_touched_today,status_changes_today,notes_today,new_leads_today,last_activity_at")
        .order("loans_touched_today", { ascending: false }),
      supabase
        .from("loans")
        .select("id,borrower_first_name,borrower_last_name,status_raw,current_stage,lead_created_at")
        .is("assigned_loan_officer_user_id", null)
        .not("current_stage", "in", '("funded","closing")')
        .not("status_raw", "in", '("Funded","Duplicate","Bad Lead","Do Not Contact")')
        .order("lead_created_at", { ascending: false })
        .limit(30),
    ]);
    slaAlerts = (slaRes.data ?? []) as SlaViewRow[];
    dailyActivity = (activityRes.data ?? []) as DailyActivityRow[];
    unassignedLoans = (unassignedRes.data ?? []) as typeof unassignedLoans;
  } catch {
    // Gracefully degrade if views not yet deployed
  }

  const slaRedCount = slaAlerts.filter((r) => r.sla_color === "red").length;
  const slaYellowCount = slaAlerts.filter((r) => r.sla_color === "yellow").length;
  // Unique LOs active today
  const losTouchedToday = dailyActivity.filter((r) => r.loans_touched_today > 0).length;
  const totalLoansTouchedToday = dailyActivity.reduce((acc, r) => acc + (r.loans_touched_today ?? 0), 0);

  return (
    <div className="space-y-10 px-1 py-2">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Pipeline</h1>
        <p className="text-sm text-mutedForeground">{teamLabel}</p>
      </div>

      {/* ── Stat cards ────────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <StatCard label="Active Loans" value={activeLoans.length} subtext={`${lpSyncedCount} in LP`} />
        <StatCard label="Untouched >24h" value={untouchedLeads.length} accent={untouchedLeads.length > 0} subtext="new leads" />
        <StatCard label="Not Contacted" value={notContactedStuck.length} accent={notContactedStuck.length > 0} />
        <StatCard label="Pitched Waiting" value={pitchedWaiting.length} subtext="needs follow-up" />
        <StatCard label="No Appraisal" value={signedNoAppraisal.length} accent={signedNoAppraisal.length > 0} subtext="signed/pkg out" />
        <StatCard label="LOs Active Today" value={losTouchedToday} subtext={`${totalLoansTouchedToday} touched`} />
        <StatCard
          label="Closing This Week"
          value={closingThisWeek}
          subtext={atRiskClosings.length > 0 ? `${atRiskClosings.length} at risk` : undefined}
        />
        <StatCard label="MTD Volume" value={formatCurrency(mtdVolumeCents)} subtext={`${fundedMtd.length} loans`} />
      </div>

      {/* ── Section 1: What's Not Moving ──────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeading>What&apos;s Not Moving</SectionHeading>

        {/* 1a — SLA exceeded (turn-time) */}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#f87171" }}>
            Past Turn Time ({stuckLoans.length})
          </p>
          <TableWrapper>
            <thead>
              <tr>
                <Th>Borrower</Th>
                <Th>Stage</Th>
                <Th right>Days in Stage</Th>
                <Th right>Open Cond.</Th>
                <Th>Owner</Th>
                <Th right>Shape #</Th>
              </tr>
            </thead>
            <tbody>
              {stuckLoans.map((l) => (
                <tr key={l.id} className="transition-colors hover:bg-white/[0.02]">
                  <Td><span className="font-medium text-foreground">{borrowerName(l)}</span></Td>
                  <Td><Badge variant="red">{stageLabel(l.current_stage)}</Badge></Td>
                  <Td right><DaysOverBadge days={l.daysInCurrentStage!} sla={l.slaMax!} /></Td>
                  <Td right><ConditionPill count={l.openConditions} /></Td>
                  <Td><span className="text-mutedForeground">{l.assigned_loan_officer_name ?? "—"}</span></Td>
                  <Td right mono>{l.shape_record_id ?? "—"}</Td>
                </tr>
              ))}
              {stuckLoans.length === 0 && <EmptyRow cols={6} message="No loans past their SLA threshold." />}
            </tbody>
          </TableWrapper>
        </div>

        {/* 1b — New leads > 24h untouched */}
        {untouchedLeads.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#f87171" }}>
              New Leads &gt; 24h Untouched ({untouchedLeads.length})
            </p>
            <TableWrapper>
              <thead>
                <tr>
                  <Th>Borrower</Th>
                  <Th>Phone</Th>
                  <Th>Source</Th>
                  <Th>Status</Th>
                  <Th>Lead Created</Th>
                  <Th>Owner</Th>
                  <Th right>Shape</Th>
                </tr>
              </thead>
              <tbody>
                {untouchedLeads.map((l) => {
                  const shapeUrl = shapeLeadUrl(l.shape_record_id);
                  return (
                  <tr key={l.id} className="bg-red-950/15 transition-colors hover:bg-red-950/25">
                    <Td><span className="font-medium">{borrowerName(l)}</span></Td>
                    <Td>
                      {l.borrower_phone ? (
                        <a href={`tel:${l.borrower_phone}`} className="text-xs text-mutedForeground hover:text-foreground">{l.borrower_phone}</a>
                      ) : <span className="text-xs text-mutedForeground">—</span>}
                    </Td>
                    <Td><span className="text-xs text-mutedForeground">{l.source ?? "—"}</span></Td>
                    <Td><Badge variant="red">{l.status_raw ?? "—"}</Badge></Td>
                    <Td>
                      <span className="text-xs text-mutedForeground">
                        {l.lead_created_at ? format(new Date(l.lead_created_at), "MMM d, h:mm a") : "—"}
                      </span>
                    </Td>
                    <Td><span className="text-mutedForeground">{l.assigned_loan_officer_name ?? "Unassigned"}</span></Td>
                    <Td right>
                      {shapeUrl ? (
                        <a href={shapeUrl} target="_blank" rel="noopener noreferrer"
                          className="rounded px-2 py-0.5 text-xs font-medium hover:opacity-80"
                          style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8" }}>
                          Open ↗
                        </a>
                      ) : <span className="font-mono text-xs text-mutedForeground">{l.shape_record_id ?? "—"}</span>}
                    </Td>
                  </tr>
                  );
                })}
              </tbody>
            </TableWrapper>
          </div>
        )}

        {/* 1c — Not Contacted stuck */}
        {notContactedStuck.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#fbbf24" }}>
              Not Contacted / Attempting ({notContactedStuck.length})
            </p>
            <TableWrapper>
              <thead>
                <tr>
                  <Th>Borrower</Th>
                  <Th>Status</Th>
                  <Th>Lead Created</Th>
                  <Th>Owner</Th>
                  <Th right>Shape #</Th>
                </tr>
              </thead>
              <tbody>
                {notContactedStuck.map((l) => {
                  const shapeUrl = shapeLeadUrl(l.shape_record_id);
                  return (
                  <tr key={l.id} className="bg-yellow-950/10 transition-colors hover:bg-yellow-950/20">
                    <Td><span className="font-medium">{borrowerName(l)}</span></Td>
                    <Td><Badge variant="yellow">{l.status_raw ?? "—"}</Badge></Td>
                    <Td>
                      <span className="text-xs text-mutedForeground">
                        {l.lead_created_at ? format(new Date(l.lead_created_at), "MMM d") : "—"}
                      </span>
                    </Td>
                    <Td><span className="text-mutedForeground">{l.assigned_loan_officer_name ?? "Unassigned"}</span></Td>
                    <Td right>
                      {shapeUrl ? (
                        <a href={shapeUrl} target="_blank" rel="noopener noreferrer"
                          className="rounded px-2 py-0.5 text-xs font-medium hover:opacity-80"
                          style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8" }}>
                          Open ↗
                        </a>
                      ) : <span className="font-mono text-xs text-mutedForeground">{l.shape_record_id ?? "—"}</span>}
                    </Td>
                  </tr>
                  );
                })}
              </tbody>
            </TableWrapper>
          </div>
        )}

        {/* 1d — Pitched and Waiting */}
        {pitchedWaiting.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#fbbf24" }}>
              Pitched and Waiting — Needs Follow-Up ({pitchedWaiting.length})
            </p>
            <TableWrapper>
              <thead>
                <tr>
                  <Th>Borrower</Th>
                  <Th>Owner</Th>
                  <Th>Lead Created</Th>
                  <Th right>Shape #</Th>
                </tr>
              </thead>
              <tbody>
                {pitchedWaiting.map((l) => (
                  <tr key={l.id} className="bg-yellow-950/10 transition-colors hover:bg-yellow-950/20">
                    <Td><span className="font-medium">{borrowerName(l)}</span></Td>
                    <Td><span className="text-mutedForeground">{l.assigned_loan_officer_name ?? "—"}</span></Td>
                    <Td>
                      <span className="text-xs text-mutedForeground">
                        {l.lead_created_at ? format(new Date(l.lead_created_at), "MMM d") : "—"}
                      </span>
                    </Td>
                    <Td right mono>{l.shape_record_id ?? "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrapper>
          </div>
        )}

        {/* 1e — Pre-Pipe stalled */}
        {prePipeStalled.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#fbbf24" }}>
              Pre-Pipe Stalled — Not Moving to Package ({prePipeStalled.length})
            </p>
            <TableWrapper>
              <thead>
                <tr>
                  <Th>Borrower</Th>
                  <Th>Status</Th>
                  <Th right>Days</Th>
                  <Th>Owner</Th>
                  <Th right>Shape #</Th>
                </tr>
              </thead>
              <tbody>
                {prePipeStalled.map((l) => (
                  <tr key={l.id} className="bg-yellow-950/10 transition-colors hover:bg-yellow-950/20">
                    <Td><span className="font-medium">{borrowerName(l)}</span></Td>
                    <Td><Badge variant="yellow">{l.status_raw ?? "—"}</Badge></Td>
                    <Td right>
                      <span className="font-mono text-xs">{l.daysStuck ?? "—"}d</span>
                    </Td>
                    <Td><span className="text-mutedForeground">{l.assigned_loan_officer_name ?? "—"}</span></Td>
                    <Td right mono>{l.shape_record_id ?? "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrapper>
          </div>
        )}

        {/* 1f — Signed Not Piped without appraisal */}
        {signedNoAppraisal.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#f87171" }}>
              Signed / Package Out — No Appraisal Payment ({signedNoAppraisal.length})
            </p>
            <TableWrapper>
              <thead>
                <tr>
                  <Th>Borrower</Th>
                  <Th>Status</Th>
                  <Th>Owner</Th>
                  <Th right>Shape #</Th>
                </tr>
              </thead>
              <tbody>
                {signedNoAppraisal.map((l) => {
                  const shapeUrl = shapeLeadUrl(l.shape_record_id);
                  return (
                  <tr key={l.id} className="bg-red-950/20 transition-colors hover:bg-red-950/30">
                    <Td><span className="font-medium">{borrowerName(l)}</span></Td>
                    <Td><Badge variant="red">{l.status_raw ?? "—"}</Badge></Td>
                    <Td><span className="text-mutedForeground">{l.assigned_loan_officer_name ?? "—"}</span></Td>
                    <Td right>
                      {shapeUrl ? (
                        <a href={shapeUrl} target="_blank" rel="noopener noreferrer"
                          className="rounded px-2 py-0.5 text-xs font-medium hover:opacity-80"
                          style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8" }}>
                          Open ↗
                        </a>
                      ) : <span className="font-mono text-xs text-mutedForeground">{l.shape_record_id ?? "—"}</span>}
                    </Td>
                  </tr>
                  );
                })}
              </tbody>
            </TableWrapper>
          </div>
        )}
      </section>

      {/* ── Section 2: What's Late ─────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeading>What&apos;s Late</SectionHeading>

        {/* 2a — Overdue closings */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-mutedForeground">
            Past closing date — not yet closed
          </p>
          <TableWrapper>
            <thead>
              <tr>
                <Th>Borrower</Th>
                <Th>Closing Date</Th>
                <Th right>How Late</Th>
                <Th right>Open Cond.</Th>
                <Th>Stage</Th>
                <Th>Owner</Th>
              </tr>
            </thead>
            <tbody>
              {overdueClosings.map((l) => (
                <tr key={l.id} className="transition-colors hover:bg-white/[0.02]">
                  <Td>
                    <span className="font-medium text-foreground">{borrowerName(l)}</span>
                  </Td>
                  <Td>
                    <span style={{ color: "#f87171" }}>{formatClosingDate(l.closing_date!)}</span>
                  </Td>
                  <Td right>
                    <OverdueBadge daysLate={l.daysLate} />
                  </Td>
                  <Td right>
                    <ConditionPill count={l.openConditions} />
                  </Td>
                  <Td>
                    <span className="text-mutedForeground">{stageLabel(l.current_stage)}</span>
                  </Td>
                  <Td>
                    <span className="text-mutedForeground">{l.assigned_loan_officer_name ?? "—"}</span>
                  </Td>
                </tr>
              ))}
              {overdueClosings.length === 0 && (
                <EmptyRow cols={6} message="No overdue closings." />
              )}
            </tbody>
          </TableWrapper>
        </div>

        {/* 2b — At-risk (closing this week with open conditions) */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-mutedForeground">
            Closing within 7 days — open conditions outstanding
          </p>
          <TableWrapper>
            <thead>
              <tr>
                <Th>Borrower</Th>
                <Th>Closing Date</Th>
                <Th right>Days Left</Th>
                <Th right>Open Cond.</Th>
                <Th>Stage</Th>
                <Th>Owner</Th>
              </tr>
            </thead>
            <tbody>
              {atRiskClosings.map((l) => (
                <tr key={l.id} className="transition-colors hover:bg-white/[0.02]">
                  <Td>
                    <span className="font-medium text-foreground">{borrowerName(l)}</span>
                  </Td>
                  <Td>
                    <span style={{ color: "#fbbf24" }}>{formatClosingDate(l.closing_date!)}</span>
                  </Td>
                  <Td right>
                    <DaysWarningBadge days={l.daysLeft} />
                  </Td>
                  <Td right>
                    <ConditionPill count={l.openConditions} />
                  </Td>
                  <Td>
                    <span className="text-mutedForeground">{stageLabel(l.current_stage)}</span>
                  </Td>
                  <Td>
                    <span className="text-mutedForeground">{l.assigned_loan_officer_name ?? "—"}</span>
                  </Td>
                </tr>
              ))}
              {atRiskClosings.length === 0 && (
                <EmptyRow cols={6} message="No at-risk closings this week." />
              )}
            </tbody>
          </TableWrapper>
        </div>
      </section>

      {/* ── Section 3: Who Has What ────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeading>Who Has What</SectionHeading>
        {loCards.length === 0 ? (
          <p className="text-sm text-mutedForeground">No active loan officers found.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {loCards.map((r) => (
              <LoCard key={r.name} {...r} />
            ))}
          </div>
        )}
      </section>

      {/* ── Section 3b: Contact Rate by LO ───────────────────────────────── */}
      {dailyActivity.length > 0 && (
        <section className="space-y-3">
          <SectionHeading>Contact Rate Today</SectionHeading>
          <p className="text-xs text-mutedForeground">
            Loans touched today vs total active loans per LO. Green = active, Yellow = low, Red = no activity.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {loCards.map((lo) => {
              const activity = dailyActivity.find(
                (a) => (a.lo_name ?? "").toLowerCase() === lo.name.toLowerCase(),
              );
              const touched = activity?.loans_touched_today ?? 0;
              const total = lo.active;
              const pct = total > 0 ? Math.round((touched / total) * 100) : 0;
              const color =
                total === 0
                  ? "hsl(215 14% 42%)"
                  : pct >= 60
                  ? "#4ade80"
                  : pct >= 30
                  ? "#fbbf24"
                  : "#f87171";
              const barColor =
                total === 0 ? "rgba(255,255,255,0.1)" : pct >= 60 ? "#4ade80" : pct >= 30 ? "#fbbf24" : "#f87171";
              return (
                <div
                  key={lo.name}
                  className="rounded-xl p-4 space-y-3"
                  style={{ border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.03)" }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-semibold">{lo.name}</div>
                    <div className="text-right">
                      <div className="text-xl font-bold tabular-nums" style={{ color }}>{pct}%</div>
                      <div className="text-[10px] text-mutedForeground">contact rate</div>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${Math.min(pct, 100)}%`, background: barColor }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-mutedForeground">
                      <span>{touched} touched today</span>
                      <span>{total} active</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-1 text-center text-[10px]">
                    <div>
                      <div className="font-semibold text-xs">{activity?.status_changes_today ?? 0}</div>
                      <div className="text-mutedForeground">Status</div>
                    </div>
                    <div>
                      <div className="font-semibold text-xs">{activity?.notes_today ?? 0}</div>
                      <div className="text-mutedForeground">Notes</div>
                    </div>
                    <div>
                      <div className="font-semibold text-xs" style={{ color: (activity?.new_leads_today ?? 0) > 0 ? "#4ade80" : undefined }}>
                        {activity?.new_leads_today ?? 0}
                      </div>
                      <div className="text-mutedForeground">New</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Section 4: SLA Alerts (from 15-min sync) ──────────────────────── */}
      {slaAlerts.length > 0 && (
        <section className="space-y-3">
          <SectionHeading>SLA Alerts — Needs Attention</SectionHeading>
          <div
            className="overflow-hidden rounded-xl"
            style={{ border: "1px solid rgba(239,68,68,0.2)", background: "rgba(255,255,255,0.02)" }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="text-left text-[11px] uppercase tracking-widest text-mutedForeground"
                  style={{ background: "rgba(255,255,255,0.04)" }}
                >
                  <th className="px-4 py-2.5">Borrower</th>
                  <th className="px-4 py-2.5">Loan Officer</th>
                  <th className="px-4 py-2.5">Stage</th>
                  <th className="px-4 py-2.5 text-right">Hours Idle</th>
                  <th className="px-4 py-2.5">Violation</th>
                  <th className="px-4 py-2.5">Touched Today</th>
                </tr>
              </thead>
              <tbody>
                {slaAlerts.map((row) => (
                  <tr
                    key={row.loan_id}
                    style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
                    className={
                      row.sla_color === "red" ? "bg-red-950/20" : "bg-yellow-950/10"
                    }
                  >
                    <td className="px-4 py-3 font-medium">{row.borrower_name || "—"}</td>
                    <td className="px-4 py-3 text-xs text-mutedForeground">{row.lo_name || "Unassigned"}</td>
                    <td className="px-4 py-3 text-xs text-mutedForeground">
                      {row.current_stage?.replace(/_/g, " ") ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      {row.hours_since_last_activity != null ? `${row.hours_since_last_activity}h` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {row.sla_color === "red" ? (
                        <Badge variant="red">
                          {row.sla_breach_type
                            ? SLA_BREACH_LABELS[row.sla_breach_type as keyof typeof SLA_BREACH_LABELS] ?? row.sla_breach_type
                            : "Critical"}
                        </Badge>
                      ) : (
                        <Badge variant="yellow">
                          {row.sla_breach_type
                            ? SLA_BREACH_LABELS[row.sla_breach_type as keyof typeof SLA_BREACH_LABELS] ?? row.sla_breach_type
                            : "At risk"}
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {row.touched_today ? (
                        <span style={{ color: "#4ade80" }}>Yes</span>
                      ) : (
                        <span style={{ color: "#f87171" }}>No</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Section 5: Daily Activity by LO ───────────────────────────────── */}
      {dailyActivity.length > 0 && (
        <section className="space-y-3">
          <SectionHeading>Today&apos;s Activity by LO</SectionHeading>
          <div
            className="overflow-hidden rounded-xl"
            style={{ border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)" }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="text-left text-[11px] uppercase tracking-widest text-mutedForeground"
                  style={{ background: "rgba(255,255,255,0.04)" }}
                >
                  <th className="px-4 py-2.5">Loan Officer</th>
                  <th className="px-4 py-2.5 text-right">Loans Touched</th>
                  <th className="px-4 py-2.5 text-right">Status Changes</th>
                  <th className="px-4 py-2.5 text-right">Notes Added</th>
                  <th className="px-4 py-2.5 text-right">New Leads</th>
                  <th className="px-4 py-2.5">Last Active</th>
                </tr>
              </thead>
              <tbody>
                {dailyActivity.map((row, i) => (
                  <tr
                    key={i}
                    style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
                    className="transition-colors hover:bg-white/[0.02]"
                  >
                    <td className="px-4 py-3 font-medium">{row.lo_name || "Unknown"}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{row.loans_touched_today}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{row.status_changes_today}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{row.notes_today}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs"
                      style={{ color: row.new_leads_today > 0 ? "#4ade80" : undefined }}>
                      {row.new_leads_today}
                    </td>
                    <td className="px-4 py-3 text-xs text-mutedForeground">
                      {row.last_activity_at
                        ? new Date(row.last_activity_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Section 6: Unassigned Leads ───────────────────────────────────── */}
      {unassignedLoans.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <SectionHeading>Unassigned Leads</SectionHeading>
            <span
              className="rounded-full px-2.5 py-0.5 text-[11px] font-bold"
              style={{ background: "rgba(239,68,68,0.15)", color: "#f87171" }}
            >
              {unassignedLoans.length} unassigned
            </span>
          </div>
          <div
            className="overflow-hidden rounded-xl"
            style={{ border: "1px solid rgba(239,68,68,0.2)", background: "rgba(255,255,255,0.02)" }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="text-left text-[11px] uppercase tracking-widest text-mutedForeground"
                  style={{ background: "rgba(255,255,255,0.04)" }}
                >
                  <th className="px-4 py-2.5">Borrower</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Stage</th>
                  <th className="px-4 py-2.5">Created</th>
                </tr>
              </thead>
              <tbody>
                {unassignedLoans.map((l) => (
                  <tr
                    key={l.id}
                    style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
                    className="bg-red-950/10 transition-colors hover:bg-red-950/20"
                  >
                    <td className="px-4 py-3 font-medium">
                      {[l.borrower_first_name, l.borrower_last_name].filter(Boolean).join(" ") || "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-mutedForeground">{l.status_raw || "—"}</td>
                    <td className="px-4 py-3 text-xs text-mutedForeground">
                      {l.current_stage?.replace(/_/g, " ") ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-mutedForeground">
                      {l.lead_created_at ? format(new Date(l.lead_created_at), "MMM d, h:mm a") : "—"}
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
