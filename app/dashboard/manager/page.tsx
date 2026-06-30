import { differenceInCalendarDays, format, startOfDay } from "date-fns";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Badge } from "@/components/Badge";
import { KpiCard } from "@/components/KpiCard";
import { SourceBadge } from "@/components/SourceBadge";
import { ExpandableRows } from "@/components/ExpandableRows";
import { NotMovingTabs, type StuckLoan, type BasicLoan } from "@/components/dashboard/NotMovingTabs";
import { ManagerChartsPanel } from "@/components/dashboard/manager/ManagerChartsPanel";
import { WhoHasWhatTable, type LoCardRow } from "@/components/dashboard/manager/WhoHasWhatTable";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { ShapePipelineNav } from "@/components/dashboard/ShapePipelineNav";
import { ShapeViewTable } from "@/components/dashboard/ShapeViewTable";
import { LoFilterSelector } from "@/components/dashboard/LoFilterSelector";
import { requireCurrentUser } from "@/lib/current-user";
import { canViewManagerDashboard } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatCurrency, monthStart, sum } from "@/lib/metrics";
import { SLA_BREACH_LABELS } from "@/lib/sla/compute";
import { shapeLeadUrl } from "@/lib/shape-link";
import { getViewById } from "@/lib/shape-views";
import { parseShapePipelineSearchParams } from "@/lib/shape-views/parse-params";
import {
  countLoansByView,
  fetchShapeLoansWindow,
  filterLoansForView,
  windowStartIso,
} from "@/lib/shape-views/query-loans";

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
      <span className="lo-accent-text text-[11px] font-semibold uppercase tracking-[0.14em]">
        {children}
      </span>
      <div className="h-px flex-1 bg-[var(--lo-border)]" />
    </div>
  );
}

function EmptyRow({ cols, message }: { cols: number; message: string }) {
  return (
    <tr>
      <td colSpan={cols} className="lo-muted lo-td px-4 py-6 text-center text-sm">
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
    <div className="lo-table-shell">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`lo-th ${right ? "text-right" : ""}`}>{children}</th>;
}

function Td({ children, right, mono }: { children: React.ReactNode; right?: boolean; mono?: boolean }) {
  return (
    <td className={`lo-td ${right ? "text-right" : ""} ${mono ? "font-mono text-xs" : ""}`}>
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
      className="lo-card relative overflow-hidden p-4 transition-all duration-150"
      style={hasIssues ? { borderColor: "var(--color-red)", boxShadow: "inset 0 0 0 1px rgba(212,43,43,0.10)" } : undefined}
    >
      <div
        className="absolute right-3 top-3 h-2 w-2 rounded-full"
        style={{ background: hasIssues ? "var(--color-red)" : "var(--color-green)" }}
      />

      <div className="lo-heading mb-3 pr-4 text-sm font-semibold">{name}</div>

      <div className="mb-3 grid grid-cols-3 gap-2">
        <div className="text-center">
          <div className="lo-heading text-lg font-bold tabular-nums">{active}</div>
          <div className="lo-muted text-[10px]">Active</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold tabular-nums" style={{ color: stuck > 0 ? "var(--color-red)" : "var(--lo-text)" }}>{stuck}</div>
          <div className="lo-muted text-[10px]">Stuck</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold tabular-nums" style={{ color: closingThisWeek > 0 ? "var(--lo-teal)" : "var(--lo-text)" }}>{closingThisWeek}</div>
          <div className="lo-muted text-[10px]">Closing</div>
        </div>
      </div>

      <div className="rounded-lg px-2.5 py-1.5 text-xs" style={{ background: "var(--lo-surface-muted)" }}>
        <span className="lo-muted">MTD </span>
        <span className="lo-heading font-medium">{mtdLoans} loans</span>
        <span className="lo-muted mx-1.5">/</span>
        <span className="lo-heading font-medium">{formatCurrency(mtdVolumeCents)}</span>
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function ManagerDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; view?: string; lo?: string; team?: string }>;
}) {
  const { appUser } = await requireCurrentUser();
  if (!canViewManagerDashboard(appUser.role)) notFound();

  const params = await searchParams;
  const now = new Date();
  const { category, viewId } = parseShapePipelineSearchParams(params, now);
  const selectedLoId = params.lo?.trim() || null;
  const selectedTeamId = params.team?.trim() || null;
  const activeShapeView = getViewById(viewId, now);

  const supabase = await createSupabaseServerClient();
  const today = startOfDay(new Date());
  const ninetyDaysAgo = new Date(today);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const ninetyDaysIso = ninetyDaysAgo.toISOString();

  const [{ data: slaRows, error: slaError }, { data: teamRows, error: teamErr }, { data: loans, error: loansErr }, { data: activeLoUsers }, { data: teamMemberRows }] =
    await Promise.all([
      supabase.from("sla_thresholds").select("stage,max_days"),
      supabase.from("teams").select("id,name,manager_user_id"),
      supabase
        .from("loans")
        .select(
          "id,shape_record_id,borrower_first_name,borrower_last_name,borrower_phone,source,current_stage,status_raw,closing_date,closed_at,funded_at,loan_amount_cents,lead_created_at,assigned_loan_officer_user_id,assigned_loan_officer_name,lendingpad_loan_uuid,appraisal_payment_collected_at,loan_stage_events(entered_at),conditions(status)"
        )
        .gte("lead_created_at", ninetyDaysIso)
        .limit(1000),
      // Only LOs and managers who are active — used to filter the "Who Has What" grid.
      // Executives (Bill, Ray, Nikk) are excluded; they don't work the pipeline as LOs.
      supabase
        .from("users")
        .select("id,full_name")
        .in("role", ["loan_officer", "manager"])
        .eq("is_active", true),
      selectedTeamId
        ? supabase.from("team_members").select("user_id").eq("team_id", selectedTeamId)
        : Promise.resolve({ data: null, error: null }),
    ]);

  if (slaError) throw slaError;
  if (teamErr) throw teamErr;
  if (loansErr) throw loansErr;

  const shapeWindowStart = windowStartIso();
  const { loans: shapeLoans } = await fetchShapeLoansWindow(supabase, {
    windowStartIso: shapeWindowStart,
    assignedLoUserId: selectedLoId ?? undefined,
  });
  const shapeViewCounts = countLoansByView(shapeLoans, now);
  const shapeViewRows = filterLoansForView(shapeLoans, viewId, now);
  const shapeExtraParams: Record<string, string | undefined> = {};
  if (selectedLoId) shapeExtraParams.lo = selectedLoId;
  if (selectedTeamId) shapeExtraParams.team = selectedTeamId;

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
  const teamMemberIds = selectedTeamId
    ? new Set((teamMemberRows ?? []).map((m) => m.user_id as string))
    : null;
  const scopedUserIds = teamMemberIds
    ? new Set([...allowedUserIds].filter((id) => teamMemberIds.has(id)))
    : allowedUserIds;
  const scopedLoUsers = teamMemberIds
    ? (activeLoUsers ?? []).filter((u) => teamMemberIds.has(u.id as string))
    : (activeLoUsers ?? []);
  const allowedNamesNorm = new Set(
    scopedLoUsers.map((u) => (u.full_name as string ?? "").trim().toLowerCase())
  );

  const perLo = new Map<
    string,
    {
      loId: string | null;
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

    if (loId && !scopedUserIds.has(loId)) continue;
    if (!loId && (!loNameNorm || !allowedNamesNorm.has(loNameNorm))) continue;

    const key = loId ?? loNameRaw;
    const name = loNameRaw || "Unassigned";
    const row = perLo.get(key) ?? {
      loId: scopedUserIds.has(key) ? key : null,
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

  const teamLabel = selectedTeamId
    ? ((teamRows ?? []).find((t) => t.id === selectedTeamId)?.name as string | undefined) ?? "Team"
    : teams.map((t) => t.name).join(", ") || "All teams";

  // ── SLA view data (from 15-min sync) ─────────────────────────────────────
  type SlaViewRow = {
    loan_id: string;
    shape_record_id: number | null;
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
  let unassignedLoans: Array<{ id: string; shape_record_id: number | null; borrower_first_name: string | null; borrower_last_name: string | null; status_raw: string | null; current_stage: string | null; lead_created_at: string | null }> = [];

  try {
    const [slaRes, activityRes, unassignedRes] = await Promise.all([
      supabase
        .from("v_lead_sla_status")
        .select("loan_id,shape_record_id,borrower_name,lo_name,status_raw,current_stage,sla_color,sla_breach_type,hours_since_last_activity,lead_created_at,touched_today")
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
        .select("id,shape_record_id,borrower_first_name,borrower_last_name,status_raw,current_stage,lead_created_at")
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

  const PIPELINE_FUNNEL = [
    { stage: "new_lead", label: "New Lead" },
    { stage: "verification", label: "Verification" },
    { stage: "esign_out", label: "eSign Out" },
    { stage: "processing", label: "Processing" },
    { stage: "underwriting", label: "Underwriting" },
    { stage: "conditions", label: "Conditions" },
    { stage: "clear_to_close", label: "CTC" },
    { stage: "closing", label: "Closing" },
  ] as const;

  const funnelStages = PIPELINE_FUNNEL.map(({ stage, label }) => ({
    label,
    count: activeLoans.filter((l) => l.current_stage === stage).length,
  }));

  const slaHealthChartData = stageHealthBars.map((s) => ({
    label: s.label,
    value: s.pct,
  }));

  const leadSourcesChartData = sourceRows.slice(0, 10).map((r) => ({
    label: r.source.length > 22 ? `${r.source.slice(0, 20)}…` : r.source,
    value: r.total,
  }));

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

  const whoHasWhatRows: LoCardRow[] = loCards.map((r, i) => ({
    loId: r.loId,
    name: r.name,
    active: r.active,
    stuck: r.stuck,
    closingThisWeek: r.closingThisWeek,
    mtdLoans: r.mtdLoans,
    mtdVolumeCents: r.mtdVolumeCents,
    health: loHealth(r.stuck, r.active),
    avatar: LO_AVATAR_COLORS[i % LO_AVATAR_COLORS.length],
    initials: loInitials(r.name),
  }));

  return (
    <div className="qr-dashboard-page animate-fade-up">
      <DashboardPageHeader
        eyebrow="Manager"
        title="Pipeline"
        description={teamLabel}
        meta={format(new Date(), "EEE MMM d, yyyy")}
      />

      {/* ── Shape Pipeline (Nikk views) ─────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionHeading>Shape Pipeline</SectionHeading>
          {(scopedLoUsers ?? []).length > 0 && (
            <Suspense fallback={null}>
              <LoFilterSelector
                users={scopedLoUsers as Array<{ id: string; full_name: string | null }>}
                selectedLoId={selectedLoId}
              />
            </Suspense>
          )}
        </div>
        {activeShapeView && (
          <p className="lo-muted -mt-1 text-xs">
            {activeShapeView.label} · {shapeViewRows.length} records · 90-day window
          </p>
        )}
        <ShapePipelineNav
          basePath="/dashboard/manager"
          category={category}
          activeViewId={viewId}
          viewCounts={shapeViewCounts}
          extraParams={shapeExtraParams}
        />
        <ShapeViewTable rows={shapeViewRows} viewId={viewId} showLoColumn={!selectedLoId} />
      </section>

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

      <ManagerChartsPanel funnelStages={funnelStages} slaHealth={[]} leadSources={[]} />

      {/* ── Main bento grid ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12 anim-d2">

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
                  <div key={l.id} className="alert-row">
                    <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--color-red)" }} />
                    <div className="min-w-0 flex-1">
                      <div className="lo-heading truncate text-[12.5px] font-semibold">{borrowerName(l)}</div>
                      <div className="lo-muted mt-0.5 text-[11px]">
                        {l.assigned_loan_officer_name ?? "—"} · {stageLabel(l.current_stage)} · Was {formatClosingDate(l.closing_date!)}
                      </div>
                    </div>
                    <span className="pill-red shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold">{l.daysLate}d late</span>
                  </div>
                ))}
                {atRiskClosings.slice(0, 3).map((l) => (
                  <div key={l.id} className="alert-row">
                    <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--color-amber)" }} />
                    <div className="min-w-0 flex-1">
                      <div className="lo-heading truncate text-[12.5px] font-semibold">{borrowerName(l)}</div>
                      <div className="lo-muted mt-0.5 text-[11px]">
                        {l.assigned_loan_officer_name ?? "—"} · {formatClosingDate(l.closing_date!)} · {l.openConditions} open cond.
                      </div>
                    </div>
                    <span className="pill-amber shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold">{l.daysLeft}d left</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* SLA Health bars */}
          {stageHealthBars.length > 0 && (
            <div className="dash-card p-2">
              <ManagerChartsPanel funnelStages={[]} slaHealth={slaHealthChartData} leadSources={[]} />
            </div>
          )}
        </div>
      </div>

      {/* ── Manager Scorecard strip ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="dash-card flex flex-col gap-2 p-4">
          <div className="kpi-card-label">Contact Rate</div>
          <div className="flex items-end gap-2">
            <span className="kpi-card-value" style={{ color: contactRateColor }}>
              {contactRatePct != null ? `${contactRatePct}%` : "—"}
            </span>
            <span className="lo-muted mb-0.5 text-[11px]">
              {contactedCount} / {notContactedCount}
            </span>
          </div>
          <div className="h-[3px] overflow-hidden rounded-full" style={{ background: "var(--lo-surface-muted)" }}>
            <div className="h-full rounded-full" style={{ width: `${contactRatePct ?? 0}%`, background: contactRateColor }} />
          </div>
        </div>
        <div className="dash-card flex flex-col gap-2 p-4">
          <div className="kpi-card-label">SLA Status</div>
          <div className="flex items-center gap-3">
            <div className="text-center">
              <div className="text-xl font-bold tabular-nums" style={{ color: "var(--color-red)" }}>{slaRedCount}</div>
              <div className="lo-muted text-[10px]">Red</div>
            </div>
            <div className="h-6 w-px" style={{ background: "var(--lo-border)" }} />
            <div className="text-center">
              <div className="text-xl font-bold tabular-nums" style={{ color: "var(--color-amber)" }}>{slaYellowCount}</div>
              <div className="lo-muted text-[10px]">Yellow</div>
            </div>
            <div className="h-6 w-px" style={{ background: "var(--lo-border)" }} />
            <div className="text-center">
              <div className="text-xl font-bold tabular-nums" style={{ color: "var(--color-green)" }}>{Math.max(0, activeLoans.length - slaRedCount - slaYellowCount)}</div>
              <div className="lo-muted text-[10px]">Green</div>
            </div>
          </div>
        </div>
        <div className="dash-card flex flex-col gap-2 p-4">
          <div className="kpi-card-label">Piped &amp; Pumped</div>
          <div className="kpi-card-value kpi-value-yellow">{pipedCount}</div>
          <div className="lo-muted text-[11px]">in pipeline funnel</div>
        </div>
        <div className="dash-card flex flex-col gap-2 p-4">
          <div className="kpi-card-label">LOs Active Today</div>
          <div className="kpi-card-value" style={{ color: losTouchedToday > 0 ? "var(--color-green)" : "var(--color-red)" }}>
            {losTouchedToday}
          </div>
          <div className="lo-muted text-[11px]">{totalLoansTouchedToday} loans touched</div>
        </div>
      </div>

      {/* ── Who Are We Calling Today? ─────────────────────────────────────── */}
      {callingTodayLoans.length > 0 && (
        <div className="dash-card">
          <div className="dash-card-header">
            <div className="flex items-center gap-2">
              <span className="dash-card-title">Who Are We Calling Today?</span>
              <span className="pill-yellow rounded-full px-2 py-0.5 text-[10px] font-bold">{callingTodayLoans.length}</span>
            </div>
            <span className="lo-muted text-[11px]">Priority: CTC → Conditions → New Leads → Appointments</span>
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
                    <tr key={l.id} className="lo-data-row">
                      <td className="font-medium">{borrowerName(l)}</td>
                      <td><SourceBadge source={l.source} /></td>
                      <td>
                        <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: "var(--lo-chip-bg)", color: statusColor }}>
                          {l.status_raw ?? stageLabel(l.current_stage)}
                        </span>
                      </td>
                      <td className="lo-muted text-[12px]">{l.assigned_loan_officer_name ?? "—"}</td>
                      <td className="lo-muted text-[12px]">
                        {l.borrower_phone ? (
                          <a href={`tel:${l.borrower_phone}`} className="hover:underline">{l.borrower_phone}</a>
                        ) : "—"}
                      </td>
                      <td className="r">
                        {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="lo-link-chip shape">Open ↗</a>
                          : <span className="lo-muted font-mono text-[11px]">{l.shape_record_id ?? "—"}</span>}
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
          <div className="lo-muted px-4 py-8 text-center text-[12px]">No active loan officers found.</div>
        ) : (
          <WhoHasWhatTable rows={whoHasWhatRows} />
        )}
      </div>

      {/* ── Contact Rate Today ────────────────────────────────────────────── */}
      {dailyActivity.length > 0 && (
        <div className="dash-card anim-d4">
          <div className="dash-card-header">
            <span className="dash-card-title">Contact Rate Today</span>
            <span className="text-[11px] text-mutedForeground">{losTouchedToday} LOs active · {totalLoansTouchedToday} loans touched</span>
          </div>
          <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
            {loCards.map((lo) => {
              const activity = dailyActivity.find(
                (a) => (a.lo_name ?? "").toLowerCase() === lo.name.toLowerCase(),
              );
              const touched = activity?.loans_touched_today ?? 0;
              const total = lo.active;
              const pct = total > 0 ? Math.round((touched / total) * 100) : 0;
              const clr = total === 0 ? "var(--lo-muted)" : pct >= 60 ? "var(--color-green)" : pct >= 30 ? "var(--color-amber)" : "var(--color-red)";
              const loHref = lo.loId
                ? `/dashboard/manager?lo=${encodeURIComponent(lo.loId)}${selectedTeamId ? `&team=${encodeURIComponent(selectedTeamId)}` : ""}`
                : `/dashboard/manager?lo=${encodeURIComponent(lo.name)}${selectedTeamId ? `&team=${encodeURIComponent(selectedTeamId)}` : ""}`;
              return (
                <Link key={lo.name} href={loHref} className="lo-card flex flex-col gap-3 p-3.5 transition-colors hover:border-[var(--lo-teal)]">
                  <div className="flex items-start justify-between gap-2">
                    <div className="lo-heading text-[13px] font-semibold leading-tight">{lo.name}</div>
                    <div className="text-right">
                      <div className="text-lg font-bold tabular-nums" style={{ color: clr }}>{pct}%</div>
                      <div className="lo-muted text-[10px]">touch rate</div>
                    </div>
                  </div>
                  <div>
                    <div className="mb-1.5 h-[3px] overflow-hidden rounded-full" style={{ background: "var(--lo-surface-muted)" }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, background: clr }} />
                    </div>
                    <div className="lo-muted flex justify-between text-[10px]">
                      <span>{touched} touched</span>
                      <span>{total} active</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-1 border-t pt-2.5 text-center" style={{ borderColor: "var(--lo-border)" }}>
                    <div>
                      <div className="lo-heading text-[12px] font-semibold">{activity?.status_changes_today ?? 0}</div>
                      <div className="lo-muted text-[10px]">Status</div>
                    </div>
                    <div>
                      <div className="lo-heading text-[12px] font-semibold">{activity?.notes_today ?? 0}</div>
                      <div className="lo-muted text-[10px]">Notes</div>
                    </div>
                    <div>
                      <div className="text-[12px] font-semibold" style={{ color: (activity?.new_leads_today ?? 0) > 0 ? "var(--color-green)" : "var(--lo-text)" }}>
                        {activity?.new_leads_today ?? 0}
                      </div>
                      <div className="lo-muted text-[10px]">New</div>
                    </div>
                  </div>
                </Link>
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
              {slaRedCount > 0 && <span className="pill-red rounded-full px-2 py-0.5 text-[10px] font-bold">{slaRedCount} critical</span>}
              {slaYellowCount > 0 && <span className="pill-amber rounded-full px-2 py-0.5 text-[10px] font-bold">{slaYellowCount} at risk</span>}
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
                <th className="r">Shape</th>
              </tr>
            </thead>
            <tbody>
              <ExpandableRows max={6} label="alerts" colSpan={7}>
                {slaAlerts.map((row) => {
                  const shapeUrl = shapeLeadUrl(row.shape_record_id);
                  return (
                  <tr key={row.loan_id} className="lo-data-row" style={{ background: row.sla_color === "red" ? "color-mix(in srgb, var(--lo-card) 92%, #ff4b4b)" : "color-mix(in srgb, var(--lo-card) 94%, #f59e0b)" }}>
                    <td className="font-medium">{row.borrower_name || "—"}</td>
                    <td className="lo-muted">{row.lo_name || "Unassigned"}</td>
                    <td className="lo-muted">{row.current_stage?.replace(/_/g, " ") ?? "—"}</td>
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
                        ? <span style={{ color: "var(--color-green)", fontSize: "12px", fontWeight: 600 }}>Yes</span>
                        : <span style={{ color: "var(--color-red)", fontSize: "12px", fontWeight: 600 }}>No</span>}
                    </td>
                    <td className="r">
                      {shapeUrl ? (
                        <a href={shapeUrl} target="_blank" rel="noopener noreferrer" className="lo-link-chip shape">Open ↗</a>
                      ) : "—"}
                    </td>
                  </tr>
                  );
                })}
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
                  <td className="lo-muted text-[12px]">
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
        <div className="dash-card" style={{ borderColor: "var(--color-red)" }}>
          <div className="dash-card-header">
            <div className="flex items-center gap-2">
              <span className="dash-card-title">Unassigned Leads</span>
              <span className="pill-red rounded-full px-2 py-0.5 text-[10px] font-bold">{unassignedLoans.length}</span>
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
                <th className="r">Shape</th>
              </tr>
            </thead>
            <tbody>
              <ExpandableRows max={5} label="leads" colSpan={6}>
                {unassignedLoans.map((l) => {
                  const shapeUrl = shapeLeadUrl(l.shape_record_id);
                  return (
                  <tr key={l.id} className="lo-data-row" style={{ background: "color-mix(in srgb, var(--lo-card) 92%, #ff4b4b)" }}>
                    <td className="font-medium">
                      {[l.borrower_first_name, l.borrower_last_name].filter(Boolean).join(" ") || "—"}
                    </td>
                    <td>
                      <span className="lo-muted text-[11px]">—</span>
                    </td>
                    <td className="lo-muted text-[12px]">{l.status_raw || "—"}</td>
                    <td className="lo-muted text-[12px]">{l.current_stage?.replace(/_/g, " ") ?? "—"}</td>
                    <td className="lo-muted font-mono text-[11px]">
                      {l.lead_created_at ? format(new Date(l.lead_created_at), "MMM d, h:mm a") : "—"}
                    </td>
                    <td className="r">
                      {shapeUrl ? (
                        <a href={shapeUrl} target="_blank" rel="noopener noreferrer" className="lo-link-chip shape">Open ↗</a>
                      ) : "—"}
                    </td>
                  </tr>
                  );
                })}
              </ExpandableRows>
            </tbody>
          </table>
        </div>
      )}

      {/* ── Source Attribution ─────────────────────────────────────────────── */}
      {leadSourcesChartData.length > 0 && (
        <ManagerChartsPanel funnelStages={[]} slaHealth={[]} leadSources={leadSourcesChartData} />
      )}
    </div>
  );
}
