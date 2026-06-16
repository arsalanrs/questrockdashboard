import { differenceInCalendarDays, format, startOfDay } from "date-fns";
import { notFound } from "next/navigation";
import { Badge } from "@/components/Badge";
import { KpiCard } from "@/components/KpiCard";
import { SourceBadge } from "@/components/SourceBadge";
import { ExpandableRows } from "@/components/ExpandableRows";
import { NotMovingTabs, type StuckLoan, type BasicLoan } from "@/components/dashboard/NotMovingTabs";
import { requireCurrentUser } from "@/lib/current-user";
import { canViewManagerDashboard } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatCurrency, monthStart, sum } from "@/lib/metrics";
import { SLA_BREACH_LABELS } from "@/lib/sla/compute";
import { shapeLeadUrl } from "@/lib/shape-link";

export const revalidate = 60;

type LoanRow = {
  id: string;
  shape_record_id: number | null;
  borrower_first_name: string | null;
  borrower_last_name: string | null;
  borrower_phone: string | null;
  source: string | null;  // lead source channel (Inbound Zoom, QuestMail, etc.)
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

  // ── Whiteboard: "Who are we calling today?" ──────────────────────────────
  // Priority contact list: new leads, appointments, conditions, CTC
  const callingTodayLoans = loanRows
    .filter((l) => {
      const s = l.status_raw ?? "";
      const stage = l.current_stage ?? "";
      return (
        // New leads needing first contact
        ["New Lead", "Not Contacted", "Attempting Contact", "Contacted"].includes(s) ||
        // Appointment stages
        ["Verification", "App Started", "App Completed", "Pitch Appt"].includes(s) ||
        // Active pipeline needing attention
        ["Conditions Out", "Approval Conditions", "Clear to Close", "Closing"].includes(s) ||
        ["conditions", "approval_conditions", "clear_to_close", "closing"].includes(stage)
      );
    })
    .filter((l) => !["funded", "closed", "withdrawn", "denied"].includes(l.current_stage ?? ""))
    .sort((a, b) => {
      const priority = (s: string | null) => {
        if (["Clear to Close", "Closing"].includes(s ?? "") || ["clear_to_close", "closing"].includes(s ?? "")) return 0;
        if (["Conditions Out", "Approval Conditions"].includes(s ?? "")) return 1;
        if (["New Lead", "Not Contacted", "Attempting Contact"].includes(s ?? "")) return 2;
        if (["Pitch Appt", "Pitched and Waiting"].includes(s ?? "")) return 3;
        return 4;
      };
      return priority(a.status_raw ?? a.current_stage) - priority(b.status_raw ?? b.current_stage);
    });

  // ── Whiteboard: Contact rate scorecard ──────────────────────────────────
  const contactedCount = loanRows.filter((l) =>
    ["Contacted", "Verification", "App Started", "App Completed", "Pitch Appt", "Pitched Advance", "Pitched and Waiting", "Pre-Pipe", "Package Out", "Signed Not Piped", "Piped"].includes(l.status_raw ?? "")
  ).length;
  const notContactedCount = loanRows.filter((l) =>
    ["New Lead", "Not Contacted", "Attempting Contact"].includes(l.status_raw ?? "")
  ).length;
  const totalContactable = contactedCount + notContactedCount;
  const contactRatePct = totalContactable > 0 ? Math.round((contactedCount / totalContactable) * 100) : null;

  // Piped + Pumped (in the active funnel past pitch)
  const pipedCount = loanRows.filter((l) =>
    ["Piped", "Registered", "Processing", "Submitted", "Underwriting", "Conditions Out", "Approval Conditions", "Clear to Close", "Closing"].includes(l.status_raw ?? "")
  ).length;

  // ── Stage SLA health bars ────────────────────────────────────────────────
  const stageHealthMap = new Map<string, { total: number; breach: number }>();
  for (const l of annotated) {
    if (!l.current_stage) continue;
    const s = stageHealthMap.get(l.current_stage) ?? { total: 0, breach: 0 };
    s.total += 1;
    if (l.slaExceeded) s.breach += 1;
    stageHealthMap.set(l.current_stage, s);
  }
  const stageHealthBars = [...stageHealthMap.entries()]
    .filter(([, v]) => v.total >= 2)
    .map(([stage, v]) => ({
      label: stageLabel(stage),
      pct: Math.round(((v.total - v.breach) / v.total) * 100),
      total: v.total,
    }))
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 5);

  // ── Prepare serialisable props for NotMovingTabs ─────────────────────────
  const stuckLoansProps: StuckLoan[] = stuckLoans.map((l) => ({
    id: l.id,
    borrowerName: borrowerName(l),
    stage: l.current_stage,
    stageLabel: stageLabel(l.current_stage),
    loName: l.assigned_loan_officer_name ?? null,
    daysInStage: l.daysInCurrentStage,
    slaMax: l.slaMax,
    daysOver: l.daysOverSla,
    openConditions: l.openConditions,
    shapeUrl: shapeLeadUrl(l.shape_record_id),
  }));

  const toBasic = (list: LoanRow[]): BasicLoan[] =>
    list.map((l) => ({
      id: l.id,
      borrowerName: borrowerName(l),
      phone: l.borrower_phone,
      source: l.source,
      stage: l.current_stage,
      statusRaw: l.status_raw,
      loName: l.assigned_loan_officer_name ?? null,
      createdAt: l.lead_created_at,
      shapeUrl: shapeLeadUrl(l.shape_record_id),
    }));

  // Contact rate color
  const contactRateColor = contactRatePct == null ? "#E8FF00"
    : contactRatePct >= 70 ? "#22C55E"
    : contactRatePct >= 50 ? "#F59E0B"
    : "#FF4B4B";

  const prePipeStalledBasic: BasicLoan[] = prePipeStalled.map((l) => ({
    id: l.id,
    borrowerName: borrowerName(l),
    phone: l.borrower_phone,
    source: l.source,
    stage: l.current_stage,
    statusRaw: l.status_raw,
    loName: l.assigned_loan_officer_name ?? null,
    createdAt: l.lead_created_at,
    shapeUrl: shapeLeadUrl(l.shape_record_id),
    daysStuck: l.daysStuck,
  }));

  // ── Source attribution ────────────────────────────────────────────────────
  type SourceRow = { source: string; total: number; newToday: number; touchedPct: number; slaRed: number };
  const sourceMap = new Map<string, { total: number; newToday: number; touched: number; slaRed: number }>();
  const todayStart = today.toISOString();
  for (const l of loanRows) {
    const key = (l.source?.trim() || "Unattributed").slice(0, 60);
    const row = sourceMap.get(key) ?? { total: 0, newToday: 0, touched: 0, slaRed: 0 };
    row.total += 1;
    if (l.lead_created_at && l.lead_created_at >= todayStart) row.newToday += 1;
    sourceMap.set(key, row);
  }
  // Merge SLA red counts from slaAlerts
  for (const sa of slaAlerts) {
    if (sa.sla_color !== "red") continue;
    const matchLoan = loanRows.find((l) => l.id === sa.loan_id);
    if (!matchLoan) continue;
    const key = (matchLoan.source?.trim() || "Unattributed").slice(0, 60);
    const row = sourceMap.get(key);
    if (row) row.slaRed += 1;
  }
  const sourceRows: SourceRow[] = [...sourceMap.entries()]
    .map(([source, v]) => ({
      source,
      total: v.total,
      newToday: v.newToday,
      touchedPct: v.total > 0 ? Math.round((v.touched / v.total) * 100) : 0,
      slaRed: v.slaRed,
    }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 15);

  // ── LO initials helper ───────────────────────────────────────────────────
  function loInitials(name: string): string {
    return name.split(" ").map((n) => n[0] ?? "").join("").slice(0, 2).toUpperCase();
  }

  const LO_AVATAR_COLORS = [
    { bg: "rgba(96,165,250,0.12)",  text: "#60A5FA" },
    { bg: "rgba(34,197,94,0.12)",   text: "#22C55E" },
    { bg: "rgba(232,255,0,0.10)",   text: "#E8FF00" },
    { bg: "rgba(245,158,11,0.12)",  text: "#F59E0B" },
    { bg: "rgba(167,139,250,0.12)", text: "#a78bfa" },
  ];

  function loHealth(stuck: number, active: number): { label: string; color: "green" | "amber" | "red" } {
    if (active === 0) return { label: "No data", color: "amber" };
    const ratio = stuck / active;
    if (ratio === 0) return { label: "Good", color: "green" };
    if (ratio <= 0.08) return { label: "Fair", color: "amber" };
    return { label: "At Risk", color: "red" };
  }

  const PILL_STYLES = {
    green: { background: "rgba(34,197,94,0.10)",  color: "#22C55E" },
    amber: { background: "rgba(245,158,11,0.10)", color: "#F59E0B" },
    red:   { background: "rgba(255,75,75,0.12)",  color: "#FF4B4B" },
  };

  return (
    <div className="flex flex-col gap-5 py-3 animate-fade-up">

      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight" style={{ letterSpacing: "-0.02em" }}>
            Pipeline
          </h1>
          <p className="mt-0.5 text-[13px] text-mutedForeground">{teamLabel}</p>
        </div>
        <div className="text-[11px] text-mutedForeground shrink-0 pt-0.5">
          {format(new Date(), "EEE MMM d, yyyy")}
        </div>
      </div>

      {/* ── KPI strip ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 anim-d1">
        <KpiCard
          label="Active Pipeline"
          value={activeLoans.length}
          sub={`${lpSyncedCount} in LendingPad`}
          color="yellow"
          subColor="neutral"
        />
        <KpiCard
          label="Stuck (7+ days)"
          value={stuckLoans.length}
          sub={stuckLoans.length > 0 ? "need attention" : "all clear ✓"}
          color={stuckLoans.length > 0 ? "red" : "green"}
          subColor={stuckLoans.length > 0 ? "down" : "up"}
        />
        <KpiCard
          label="Closing This Week"
          value={closingThisWeek}
          sub={atRiskClosings.length > 0 ? `${atRiskClosings.length} at risk` : "none at risk"}
          color="amber"
          subColor={atRiskClosings.length > 0 ? "down" : "neutral"}
        />
        <KpiCard
          label="Funded MTD"
          value={fundedMtd.length}
          sub={formatCurrency(mtdVolumeCents)}
          color="green"
          subColor="up"
        />
        <KpiCard
          label="Unassigned"
          value={unassignedLoans.length}
          sub={unassignedLoans.length > 0 ? "needs assignment" : "all assigned ✓"}
          color={unassignedLoans.length > 0 ? "red" : "green"}
          subColor={unassignedLoans.length > 0 ? "down" : "up"}
        />
      </div>

      {/* ── Main bento grid ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 anim-d2">

        {/* What's Not Moving — 8 cols */}
        <div className="lg:col-span-8 dash-card">
          <div className="dash-card-header">
            <div className="flex items-center gap-2.5">
              <span className="dash-card-title">What&apos;s Not Moving</span>
              {(stuckLoans.length + untouchedLeads.length + signedNoAppraisal.length) > 0 && (
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-bold leading-none"
                  style={{ background: "rgba(255,75,75,0.15)", color: "#FF4B4B" }}
                >
                  {stuckLoans.length + untouchedLeads.length + signedNoAppraisal.length}
                </span>
              )}
            </div>
          </div>
          <NotMovingTabs
            stuckLoans={stuckLoansProps}
            untouchedLeads={toBasic(untouchedLeads)}
            notContactedStuck={toBasic(notContactedStuck)}
            pitchedWaiting={toBasic(pitchedWaiting)}
            prePipeStalled={prePipeStalledBasic}
            signedNoAppraisal={toBasic(signedNoAppraisal)}
          />
        </div>

        {/* Right column — 4 cols */}
        <div className="flex flex-col gap-4 lg:col-span-4">

          {/* What's Late — Overdue closings */}
          <div className="dash-card">
            <div className="dash-card-header">
              <span className="dash-card-title">What&apos;s Late</span>
              {overdueClosings.length > 0 && (
                <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: "rgba(255,75,75,0.15)", color: "#FF4B4B" }}>
                  {overdueClosings.length} overdue
                </span>
              )}
            </div>
            {overdueClosings.length === 0 && atRiskClosings.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-5 text-[12px]" style={{ color: "hsl(215 14% 45%)" }}>
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" opacity={0.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                No overdue or at-risk closings
              </div>
            ) : (
              <div>
                {overdueClosings.slice(0, 4).map((l) => (
                  <div
                    key={l.id}
                    className="flex items-start gap-3 px-4 py-3"
                    style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
                  >
                    <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "#FF4B4B" }} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{borrowerName(l)}</div>
                      <div className="mt-0.5 text-[11px] text-mutedForeground">
                        {l.assigned_loan_officer_name ?? "—"} · {stageLabel(l.current_stage)} · Was {formatClosingDate(l.closing_date!)}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: "rgba(255,75,75,0.12)", color: "#FF4B4B" }}>
                      {l.daysLate}d late
                    </span>
                  </div>
                ))}
                {atRiskClosings.slice(0, 3).map((l) => (
                  <div
                    key={l.id}
                    className="flex items-start gap-3 px-4 py-3"
                    style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
                  >
                    <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "#F59E0B" }} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{borrowerName(l)}</div>
                      <div className="mt-0.5 text-[11px] text-mutedForeground">
                        {l.assigned_loan_officer_name ?? "—"} · {formatClosingDate(l.closing_date!)} · {l.openConditions} open cond.
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: "rgba(245,158,11,0.12)", color: "#F59E0B" }}>
                      {l.daysLeft}d left
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* SLA Health bars */}
          {stageHealthBars.length > 0 && (
            <div className="dash-card">
              <div className="dash-card-header">
                <span className="dash-card-title">Stage SLA Health</span>
                <span className="text-[11px]" style={{ color: "hsl(215 14% 50%)" }}>% on time</span>
              </div>
              <div className="flex flex-col gap-3 px-4 py-4">
                {stageHealthBars.map((s) => (
                  <div key={s.label} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-medium">{s.label}</span>
                      <span
                        className="text-[12px] font-semibold tabular-nums"
                        style={{ color: s.pct >= 80 ? "#22C55E" : s.pct >= 60 ? "#F59E0B" : "#FF4B4B" }}
                      >
                        {s.pct}%
                      </span>
                    </div>
                    <div className="h-[4px] overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.07)" }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${s.pct}%`,
                          background: s.pct >= 80 ? "#22C55E" : s.pct >= 60 ? "#F59E0B" : "#FF4B4B",
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Manager Scorecard strip ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Contact Rate */}
        <div className="dash-card flex flex-col gap-2 p-4">
          <div className="text-[11px] font-medium tracking-wide" style={{ color: "hsl(215 14% 52%)" }}>Contact Rate</div>
          <div className="flex items-end gap-2">
            <span className="text-2xl font-bold tabular-nums" style={{ color: contactRateColor }}>
              {contactRatePct != null ? `${contactRatePct}%` : "—"}
            </span>
            <span className="mb-0.5 text-[11px] text-mutedForeground">
              {contactedCount} contacted · {notContactedCount} not
            </span>
          </div>
          <div className="h-[3px] overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
            <div className="h-full rounded-full" style={{ width: `${contactRatePct ?? 0}%`, background: contactRateColor }} />
          </div>
        </div>
        {/* SLA colors */}
        <div className="dash-card flex flex-col gap-2 p-4">
          <div className="text-[11px] font-medium tracking-wide" style={{ color: "hsl(215 14% 52%)" }}>SLA Status</div>
          <div className="flex items-center gap-3">
            <div className="text-center">
              <div className="text-xl font-bold tabular-nums" style={{ color: "#FF4B4B" }}>{slaRedCount}</div>
              <div className="text-[10px] text-mutedForeground">Red</div>
            </div>
            <div className="h-6 w-px" style={{ background: "rgba(255,255,255,0.06)" }} />
            <div className="text-center">
              <div className="text-xl font-bold tabular-nums" style={{ color: "#F59E0B" }}>{slaYellowCount}</div>
              <div className="text-[10px] text-mutedForeground">Yellow</div>
            </div>
            <div className="h-6 w-px" style={{ background: "rgba(255,255,255,0.06)" }} />
            <div className="text-center">
              <div className="text-xl font-bold tabular-nums" style={{ color: "#22C55E" }}>{Math.max(0, activeLoans.length - slaRedCount - slaYellowCount)}</div>
              <div className="text-[10px] text-mutedForeground">Green</div>
            </div>
          </div>
        </div>
        {/* Piped & Pumped */}
        <div className="dash-card flex flex-col gap-2 p-4">
          <div className="text-[11px] font-medium tracking-wide" style={{ color: "hsl(215 14% 52%)" }}>Piped &amp; Pumped</div>
          <div className="text-2xl font-bold tabular-nums" style={{ color: "#E8FF00" }}>{pipedCount}</div>
          <div className="text-[11px] text-mutedForeground">in pipeline funnel</div>
        </div>
        {/* LOs active today */}
        <div className="dash-card flex flex-col gap-2 p-4">
          <div className="text-[11px] font-medium tracking-wide" style={{ color: "hsl(215 14% 52%)" }}>LOs Active Today</div>
          <div className="text-2xl font-bold tabular-nums" style={{ color: losTouchedToday > 0 ? "#22C55E" : "#FF4B4B" }}>
            {losTouchedToday}
          </div>
          <div className="text-[11px] text-mutedForeground">{totalLoansTouchedToday} loans touched</div>
        </div>
      </div>

      {/* ── Who Are We Calling Today? ─────────────────────────────────────── */}
      {callingTodayLoans.length > 0 && (
        <div className="dash-card">
          <div className="dash-card-header">
            <div className="flex items-center gap-2">
              <span className="dash-card-title">Who Are We Calling Today?</span>
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: "rgba(232,255,0,0.10)", color: "#E8FF00" }}>
                {callingTodayLoans.length}
              </span>
            </div>
            <span className="text-[11px] text-mutedForeground">Priority: CTC → Conditions → New Leads → Appointments</span>
          </div>
          <table className="dt">
            <thead>
              <tr>
                <th>Borrower</th>
                <th>Source</th>
                <th>Status</th>
                <th>Owner</th>
                <th>Phone</th>
                <th className="r">Shape</th>
              </tr>
            </thead>
            <tbody>
              <ExpandableRows max={6} label="leads" colSpan={6}>
                {callingTodayLoans.map((l) => {
                  const url = shapeLeadUrl(l.shape_record_id);
                  const statusColor =
                    ["Clear to Close", "Closing"].includes(l.status_raw ?? "") ? "#22C55E"
                    : ["Conditions Out", "Approval Conditions"].includes(l.status_raw ?? "") ? "#F59E0B"
                    : ["New Lead", "Not Contacted", "Attempting Contact"].includes(l.status_raw ?? "") ? "#FF4B4B"
                    : "hsl(215 14% 60%)";
                  return (
                    <tr key={l.id}>
                      <td className="font-medium">{borrowerName(l)}</td>
                      <td><SourceBadge source={l.source} /></td>
                      <td>
                        <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold"
                          style={{ background: "rgba(255,255,255,0.06)", color: statusColor }}>
                          {l.status_raw ?? stageLabel(l.current_stage)}
                        </span>
                      </td>
                      <td className="text-[12px] text-mutedForeground">{l.assigned_loan_officer_name ?? "—"}</td>
                      <td className="text-[12px] text-mutedForeground">
                        {l.borrower_phone ? (
                          <a href={`tel:${l.borrower_phone}`} className="hover:underline">{l.borrower_phone}</a>
                        ) : "—"}
                      </td>
                      <td className="r">
                        {url ? (
                          <a href={url} target="_blank" rel="noopener noreferrer"
                            className="rounded px-2 py-0.5 text-[11px] font-medium hover:opacity-80"
                            style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8" }}>
                            Open ↗
                          </a>
                        ) : <span className="font-mono text-[11px] text-mutedForeground">{l.shape_record_id ?? "—"}</span>}
                      </td>
                    </tr>
                  );
                })}
              </ExpandableRows>
            </tbody>
          </table>
        </div>
      )}

      {/* ── Who Has What ─────────────────────────────────────────────────── */}
      <div className="dash-card anim-d3">
        <div className="dash-card-header">
          <span className="dash-card-title">Who Has What</span>
          <span className="text-[11px] text-mutedForeground">{loCards.length} active LOs</span>
        </div>
        {loCards.length === 0 ? (
          <div className="px-4 py-8 text-center text-[12px] text-mutedForeground">No active loan officers found.</div>
        ) : (
          <table className="dt">
            <thead>
              <tr>
                <th>Loan Officer</th>
                <th className="r">Active</th>
                <th className="r">Stuck</th>
                <th className="r">Closing</th>
                <th className="r">Funded MTD</th>
                <th className="r">Volume MTD</th>
                <th className="r">Health</th>
              </tr>
            </thead>
            <tbody>
              {loCards.map((r, i) => {
                const av = LO_AVATAR_COLORS[i % LO_AVATAR_COLORS.length];
                const health = loHealth(r.stuck, r.active);
                return (
                  <tr key={r.name}>
                    <td>
                      <div className="flex items-center gap-3">
                        <div
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                          style={{ background: av.bg, color: av.text }}
                        >
                          {loInitials(r.name)}
                        </div>
                        <span className="font-medium">{r.name}</span>
                      </div>
                    </td>
                    <td className="r font-semibold tabular-nums">{r.active}</td>
                    <td className="r tabular-nums">
                      <span style={{ color: r.stuck > 0 ? "#FF4B4B" : "hsl(210 20% 96%)", fontWeight: r.stuck > 0 ? 600 : 400 }}>
                        {r.stuck}
                      </span>
                    </td>
                    <td className="r tabular-nums">
                      <span style={{ color: r.closingThisWeek > 0 ? "#F59E0B" : undefined }}>
                        {r.closingThisWeek}
                      </span>
                    </td>
                    <td className="r tabular-nums">
                      <span style={{ color: r.mtdLoans > 0 ? "#22C55E" : undefined }}>
                        {r.mtdLoans}
                      </span>
                    </td>
                    <td className="r tabular-nums text-[12px]">{formatCurrency(r.mtdVolumeCents)}</td>
                    <td className="r">
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
                        style={PILL_STYLES[health.color]}
                      >
                        {health.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Contact Rate Today ────────────────────────────────────────────── */}
      {dailyActivity.length > 0 && (
        <div className="dash-card anim-d4">
          <div className="dash-card-header">
            <span className="dash-card-title">Contact Rate Today</span>
            <span className="text-[11px] text-mutedForeground">{losTouchedToday} LOs active · {totalLoansTouchedToday} loans touched</span>
          </div>
          <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
            {loCards.map((lo) => {
              const activity = dailyActivity.find(
                (a) => (a.lo_name ?? "").toLowerCase() === lo.name.toLowerCase(),
              );
              const touched = activity?.loans_touched_today ?? 0;
              const total = lo.active;
              const pct = total > 0 ? Math.round((touched / total) * 100) : 0;
              const clr = total === 0 ? "hsl(215 14% 42%)" : pct >= 60 ? "#22C55E" : pct >= 30 ? "#F59E0B" : "#FF4B4B";
              return (
                <div
                  key={lo.name}
                  className="flex flex-col gap-3 rounded-xl p-3.5"
                  style={{ border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[13px] font-semibold leading-tight">{lo.name}</div>
                    <div className="text-right">
                      <div className="text-lg font-bold tabular-nums" style={{ color: clr }}>{pct}%</div>
                      <div className="text-[10px] text-mutedForeground">touch rate</div>
                    </div>
                  </div>
                  <div>
                    <div className="mb-1.5 h-[3px] overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, background: clr }} />
                    </div>
                    <div className="flex justify-between text-[10px] text-mutedForeground">
                      <span>{touched} touched</span>
                      <span>{total} active</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-1 border-t pt-2.5 text-center" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                    <div>
                      <div className="text-[12px] font-semibold">{activity?.status_changes_today ?? 0}</div>
                      <div className="text-[10px] text-mutedForeground">Status</div>
                    </div>
                    <div>
                      <div className="text-[12px] font-semibold">{activity?.notes_today ?? 0}</div>
                      <div className="text-[10px] text-mutedForeground">Notes</div>
                    </div>
                    <div>
                      <div className="text-[12px] font-semibold" style={{ color: (activity?.new_leads_today ?? 0) > 0 ? "#22C55E" : undefined }}>
                        {activity?.new_leads_today ?? 0}
                      </div>
                      <div className="text-[10px] text-mutedForeground">New</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── SLA Alerts ───────────────────────────────────────────────────── */}
      {slaAlerts.length > 0 && (
        <div className="dash-card">
          <div className="dash-card-header">
            <div className="flex items-center gap-2">
              <span className="dash-card-title">SLA Alerts</span>
              {slaRedCount > 0 && (
                <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: "rgba(255,75,75,0.15)", color: "#FF4B4B" }}>
                  {slaRedCount} critical
                </span>
              )}
              {slaYellowCount > 0 && (
                <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: "rgba(245,158,11,0.12)", color: "#F59E0B" }}>
                  {slaYellowCount} at risk
                </span>
              )}
            </div>
          </div>
          <table className="dt">
            <thead>
              <tr>
                <th>Borrower</th>
                <th>Loan Officer</th>
                <th>Stage</th>
                <th className="r">Hours Idle</th>
                <th>Violation</th>
                <th>Touched Today</th>
              </tr>
            </thead>
            <tbody>
              <ExpandableRows max={6} label="alerts" colSpan={6}>
                {slaAlerts.map((row) => (
                  <tr key={row.loan_id} style={{ background: row.sla_color === "red" ? "rgba(255,75,75,0.04)" : "rgba(245,158,11,0.03)" }}>
                    <td className="font-medium">{row.borrower_name || "—"}</td>
                    <td className="text-mutedForeground">{row.lo_name || "Unassigned"}</td>
                    <td className="text-mutedForeground">{row.current_stage?.replace(/_/g, " ") ?? "—"}</td>
                    <td className="r font-mono text-[12px]">{row.hours_since_last_activity != null ? `${row.hours_since_last_activity}h` : "—"}</td>
                    <td>
                      {row.sla_color === "red" ? (
                        <Badge variant="red">{row.sla_breach_type ? SLA_BREACH_LABELS[row.sla_breach_type as keyof typeof SLA_BREACH_LABELS] ?? row.sla_breach_type : "Critical"}</Badge>
                      ) : (
                        <Badge variant="yellow">{row.sla_breach_type ? SLA_BREACH_LABELS[row.sla_breach_type as keyof typeof SLA_BREACH_LABELS] ?? row.sla_breach_type : "At risk"}</Badge>
                      )}
                    </td>
                    <td>
                      {row.touched_today
                        ? <span style={{ color: "#22C55E", fontSize: "12px", fontWeight: 500 }}>Yes</span>
                        : <span style={{ color: "#FF4B4B", fontSize: "12px", fontWeight: 500 }}>No</span>}
                    </td>
                  </tr>
                ))}
              </ExpandableRows>
            </tbody>
          </table>
        </div>
      )}

      {/* ── Daily Activity by LO ──────────────────────────────────────────── */}
      {dailyActivity.length > 0 && (
        <div className="dash-card">
          <div className="dash-card-header">
            <span className="dash-card-title">Today&apos;s Activity by LO</span>
          </div>
          <table className="dt">
            <thead>
              <tr>
                <th>Loan Officer</th>
                <th className="r">Loans Touched</th>
                <th className="r">Status Changes</th>
                <th className="r">Notes Added</th>
                <th className="r">New Leads</th>
                <th>Last Active</th>
              </tr>
            </thead>
            <tbody>
              {dailyActivity.map((row, i) => (
                <tr key={i}>
                  <td className="font-medium">{row.lo_name || "Unknown"}</td>
                  <td className="r font-mono text-[12px]">{row.loans_touched_today}</td>
                  <td className="r font-mono text-[12px]">{row.status_changes_today}</td>
                  <td className="r font-mono text-[12px]">{row.notes_today}</td>
                  <td className="r font-mono text-[12px]" style={{ color: row.new_leads_today > 0 ? "#22C55E" : undefined }}>
                    {row.new_leads_today}
                  </td>
                  <td className="text-[12px] text-mutedForeground">
                    {row.last_activity_at
                      ? new Date(row.last_activity_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Unassigned Leads ─────────────────────────────────────────────── */}
      {unassignedLoans.length > 0 && (
        <div className="dash-card" style={{ borderColor: "rgba(255,75,75,0.2)" }}>
          <div className="dash-card-header">
            <div className="flex items-center gap-2">
              <span className="dash-card-title">Unassigned Leads</span>
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: "rgba(255,75,75,0.15)", color: "#FF4B4B" }}>
                {unassignedLoans.length}
              </span>
            </div>
          </div>
          <table className="dt">
            <thead>
              <tr>
                <th>Borrower</th>
                <th>Source</th>
                <th>Status</th>
                <th>Stage</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              <ExpandableRows max={5} label="leads" colSpan={5}>
                {unassignedLoans.map((l) => (
                  <tr key={l.id} style={{ background: "rgba(255,75,75,0.03)" }}>
                    <td className="font-medium">
                      {[l.borrower_first_name, l.borrower_last_name].filter(Boolean).join(" ") || "—"}
                    </td>
                    <td>
                      {/* source not available in this sub-query; would need join */}
                      <span className="text-[11px] text-mutedForeground">—</span>
                    </td>
                    <td className="text-[12px] text-mutedForeground">{l.status_raw || "—"}</td>
                    <td className="text-[12px] text-mutedForeground">{l.current_stage?.replace(/_/g, " ") ?? "—"}</td>
                    <td className="font-mono text-[11px] text-mutedForeground">
                      {l.lead_created_at ? format(new Date(l.lead_created_at), "MMM d, h:mm a") : "—"}
                    </td>
                  </tr>
                ))}
              </ExpandableRows>
            </tbody>
          </table>
        </div>
      )}

      {/* ── Source Attribution ─────────────────────────────────────────────── */}
      {sourceRows.length > 0 && (
        <div className="dash-card">
          <div className="dash-card-header">
            <span className="dash-card-title">Lead Sources</span>
          </div>
          <table className="dt">
            <thead>
              <tr>
                <th>Source</th>
                <th className="text-right">Total</th>
                <th className="text-right">New Today</th>
                <th className="text-right">SLA Red</th>
              </tr>
            </thead>
            <tbody>
              {sourceRows.map((r) => (
                <tr key={r.source}>
                  <td className="font-medium">{r.source}</td>
                  <td className="text-right font-mono text-[12px]">{r.total}</td>
                  <td className="text-right font-mono text-[12px]" style={{ color: r.newToday > 0 ? "#22C55E" : undefined }}>
                    {r.newToday > 0 ? `+${r.newToday}` : "—"}
                  </td>
                  <td className="text-right font-mono text-[12px]" style={{ color: r.slaRed > 0 ? "#FF4B4B" : undefined }}>
                    {r.slaRed > 0 ? r.slaRed : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
