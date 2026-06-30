import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCurrentUser } from "@/lib/current-user";
import { canViewExecutiveDashboard } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ExecutiveFilters, type ExecLoan } from "@/components/dashboard/ExecutiveFilters";
import { KpiCard } from "@/components/KpiCard";
import { OpportunitiesPanel } from "@/components/executive/OpportunitiesPanel";
import { ExecChat } from "@/components/executive/ExecChat";
import { ExecNotifications, type ExecNotification } from "@/components/executive/ExecNotifications";
import { LiveActivityFeed } from "@/components/executive/LiveActivityFeed";
import { MlReadinessCard } from "@/components/executive/MlReadinessCard";
import { DocumentHealthCard } from "@/components/executive/DocumentHealthCard";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { LeadTierOverview, type TierBreakdownRow } from "@/components/executive/LeadTierOverview";
import { AssignmentQueuePanel, type AssignmentQueueRow } from "@/components/executive/AssignmentQueuePanel";
import { BlitzBuilder } from "@/components/executive/BlitzBuilder";
import { SourceBadge } from "@/components/SourceBadge";
import { ExpandableRows } from "@/components/ExpandableRows";
import { loadOpportunitiesPanelData } from "@/lib/signals/load-for-panel";
import { loadMlReadiness } from "@/lib/signals/load-ml-readiness";
import { loadDocumentHealth } from "@/lib/documents/load-document-health";
import { formatCurrency } from "@/lib/metrics";

// ─── Performance notes ────────────────────────────────────────────────────────
// • persistLeadTiers() is NOT called here. It runs in the nightly cron only.
//   Calling it on every page load issued hundreds of sequential DB UPDATEs,
//   which was the primary cause of 5–15 second load times.
// • The two separate loans queries (5k + 25k rows) are merged into one.
// • The assignment-queue assignee lookup is merged into the main Promise.all.
// • Heavy non-critical cards (DocumentHealth, MlReadiness) stream via Suspense.
// ─────────────────────────────────────────────────────────────────────────────

// Revalidate every 5 minutes — dashboard data doesn't need to be fresh on
// every single request. The nightly cron keeps underlying data current.
export const revalidate = 300;

// ─── Streaming loaders (for Suspense-wrapped cards) ───────────────────────────

async function DocumentHealthSection() {
  const admin = createSupabaseAdminClient();
  try {
    const health = await loadDocumentHealth(admin);
    return <DocumentHealthCard health={health} />;
  } catch {
    return null;
  }
}

async function MlReadinessSection() {
  const admin = createSupabaseAdminClient();
  try {
    const readiness = await loadMlReadiness(admin);
    return <MlReadinessCard readiness={readiness} />;
  } catch {
    return null;
  }
}

// ─── Live Activity Feed ───────────────────────────────────────────────────────

async function LiveActivityFeedSection() {
  const admin = createSupabaseAdminClient();
  try {
    const { data } = await admin
      .from("shape_activity_log")
      .select("id,synced_at,change_type,field_name,old_value,new_value,lo_name,borrower_name,loan_id,loans(shape_record_id)")
      .order("synced_at", { ascending: false })
      .limit(50);

    const rows = (data ?? []).map((row) => {
      const loanRaw = row.loans as { shape_record_id: number | null } | { shape_record_id: number | null }[] | null;
      const loan = Array.isArray(loanRaw) ? loanRaw[0] ?? null : loanRaw;
      return {
        id: row.id as string,
        synced_at: row.synced_at as string,
        change_type: row.change_type as string,
        field_name: row.field_name as string | null,
        old_value: row.old_value as string | null,
        new_value: row.new_value as string | null,
        lo_name: row.lo_name as string | null,
        borrower_name: row.borrower_name as string | null,
        shape_record_id: loan?.shape_record_id ?? null,
      };
    });

    if (rows.length === 0) return null;
    return <LiveActivityFeed rows={rows} />;
  } catch {
    return null;
  }
}

// ─── Manager Scorecards ───────────────────────────────────────────────────────

type ManagerScorecardData = {
  managerId: string;
  teamId: string;
  managerName: string;
  teamName: string;
  totalActive: number;
  slaRed: number;
  slaGreen: number;
  slaGreenPct: number;
  closedMtd: number;
  mtdVolumeCents: number;
};

async function ManagerScorecardsSection() {
  const admin = createSupabaseAdminClient();
  try {
    const [{ data: teams }, { data: slaRows }] = await Promise.all([
      admin
        .from("teams")
        .select("id,name,manager_user_id,users!team_members(id)")
        .limit(20),
      admin
        .from("v_lead_sla_status")
        .select("loan_id,assigned_loan_officer_user_id,sla_color"),
    ]);

    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();

    const { data: managers } = await admin
      .from("users")
      .select("id,full_name")
      .eq("role", "manager");

    if (!managers?.length) return null;

    const slaByLo = new Map<string, { red: number; total: number }>();
    for (const r of slaRows ?? []) {
      const loId = r.assigned_loan_officer_user_id as string | null;
      if (!loId) continue;
      const s = slaByLo.get(loId) ?? { red: 0, total: 0 };
      s.total += 1;
      if (r.sla_color === "red") s.red += 1;
      slaByLo.set(loId, s);
    }

    const { data: mtdLoans } = await admin
      .from("loans")
      .select("assigned_loan_officer_user_id,loan_amount_cents,closed_at,funded_at")
      .or(`closed_at.gte.${monthStart},funded_at.gte.${monthStart}`);

    const scorecards: ManagerScorecardData[] = [];

    for (const mgr of managers) {
      const team = (teams ?? []).find((t) => t.manager_user_id === mgr.id);
      if (!team) continue;

      const teamMemberIds = new Set(
        ((team.users as Array<{ id: string }>) ?? []).map((u) => u.id),
      );

      let slaRed = 0;
      let totalSla = 0;
      for (const [loId, stats] of slaByLo) {
        if (teamMemberIds.has(loId)) {
          slaRed += stats.red;
          totalSla += stats.total;
        }
      }

      let closedMtd = 0;
      let mtdVolumeCents = 0;
      for (const loan of mtdLoans ?? []) {
        const loId = loan.assigned_loan_officer_user_id as string | null;
        if (loId && teamMemberIds.has(loId)) {
          closedMtd += 1;
          mtdVolumeCents += (loan.loan_amount_cents as number | null) ?? 0;
        }
      }

      scorecards.push({
        managerId: mgr.id as string,
        teamId: team.id as string,
        managerName: (mgr.full_name as string | null) ?? "Manager",
        teamName: (team.name as string) ?? "Team",
        totalActive: totalSla,
        slaRed,
        slaGreen: totalSla - slaRed,
        slaGreenPct: totalSla > 0 ? Math.round(((totalSla - slaRed) / totalSla) * 100) : 100,
        closedMtd,
        mtdVolumeCents,
      });
    }

    if (scorecards.length === 0) return null;

    function formatCurrencyK(cents: number) {
      const dollars = cents / 100;
      if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
      if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(0)}K`;
      return `$${dollars.toFixed(0)}`;
    }

    return (
      <section className="space-y-3">
        <div className="lo-accent-text text-[11px] font-bold uppercase tracking-[0.14em]">Manager Scorecards</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {scorecards.map((sc) => (
            <Link
              key={sc.managerId}
              href={`/dashboard/manager?team=${encodeURIComponent(sc.teamId)}`}
              className="lo-card block space-y-4 p-5 transition-colors hover:border-[var(--lo-teal)]"
              style={sc.slaRed > 0 ? { borderColor: "var(--color-red)" } : undefined}
            >
              <div>
                <div className="lo-heading text-sm font-semibold">{sc.managerName}</div>
                <div className="lo-muted text-xs">{sc.teamName}</div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg p-2.5 text-center" style={{ background: "var(--lo-surface-muted)" }}>
                  <div className="text-2xl font-bold tabular-nums" style={{ color: sc.slaRed > 0 ? "var(--color-red)" : "var(--lo-text)" }}>
                    {sc.slaRed}
                  </div>
                  <div className="lo-muted mt-0.5 text-[10px]">SLA Critical</div>
                </div>
                <div className="rounded-lg p-2.5 text-center" style={{ background: "var(--lo-surface-muted)" }}>
                  <div className="text-2xl font-bold tabular-nums" style={{ color: sc.slaGreenPct >= 80 ? "var(--color-green)" : "var(--color-amber)" }}>
                    {sc.slaGreenPct}%
                  </div>
                  <div className="lo-muted mt-0.5 text-[10px]">SLA Compliant</div>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="lo-muted">MTD Closed</span>
                <span className="lo-heading font-medium">{sc.closedMtd} loans · {formatCurrencyK(sc.mtdVolumeCents)}</span>
              </div>

              <div>
                <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--lo-surface-muted)" }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${sc.slaGreenPct}%`,
                      background: sc.slaGreenPct >= 80 ? "var(--color-green)" : sc.slaGreenPct >= 60 ? "var(--color-amber)" : "var(--color-red)",
                    }}
                  />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    );
  } catch {
    return null;
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function ExecutiveDashboardPage() {
  const { appUser } = await requireCurrentUser();
  if (!canViewExecutiveDashboard(appUser.role)) notFound();

  const admin = createSupabaseAdminClient();

  // ── Single parallel data fetch — no sequential waterfalls ──────────────────
  const [
    { data: loans, error: loansErr },
    { data: users },
    opportunities,
    { data: notificationRows },
    { data: queueRaw, error: queueErr },
    { count: slaRedCount },
  ] = await Promise.all([
    // One query for both ExecutiveFilters AND tier breakdown.
    // lead_tier is included so we compute tier stats from the same dataset.
    admin
      .from("loans")
      .select(
        "id,lead_tier,source,assigned_loan_officer_user_id,utm_campaign,property_state,status_raw,current_stage," +
        "loan_amount_cents,lead_created_at,credit_report_requested_at,appraisal_ordered_at," +
        "closed_at,closing_date,borrower_first_name,borrower_last_name,shape_record_id," +
        "assigned_loan_officer_name,loan_type,documentation_type,esign_returned_at," +
        "appraisal_payment_collected_at,validation_launched_at"
      )
      .limit(3000),

    admin
      .from("users")
      .select("full_name")
      .in("role", ["loan_officer", "manager", "executive"])
      .eq("is_active", true)
      .order("full_name"),

    loadOpportunitiesPanelData(admin).catch((e) => {
      console.error("Opportunities panel load error:", e);
      return { panelSignals: [], loRollups: [], lastRunAt: null };
    }),

    admin
      .from("executive_notifications")
      .select("id,kind,title,body,created_at,read_at,signal_id,payload")
      .eq("user_id", appUser.id)
      .order("created_at", { ascending: false })
      .limit(50),

    admin
      .from("auto_assignment_queue")
      .select("id,loan_id,tier,status,assignment_method,created_at,assigned_to,error_message")
      .order("created_at", { ascending: false })
      .limit(40),

    admin
      .from("v_lead_sla_status")
      .select("*", { count: "exact", head: true })
      .eq("sla_color", "red"),
  ]);

  if (loansErr) throw loansErr;
  if (queueErr) console.error("Assignment queue load error:", queueErr);

  // ── Tier breakdown from the loans we already fetched ──────────────────────
  const tierStatsMap = new Map<string | null, { count: number; volumeCents: number }>();
  for (const r of ((loans as unknown) as ExecLoan[] | null) ?? []) {
    const t = r.lead_tier ?? null;
    const b = tierStatsMap.get(t) ?? { count: 0, volumeCents: 0 };
    b.count += 1;
    b.volumeCents += (r.loan_amount_cents as number | null) ?? 0;
    tierStatsMap.set(t, b);
  }
  const tierStats: TierBreakdownRow[] = [...tierStatsMap.entries()].map(([tier, v]) => ({
    tier,
    count: v.count,
    volumeCents: v.volumeCents,
  }));

  // ── Assignment queue assignee names (fetched only if queue is non-empty) ──
  const assigneeIds = [
    ...new Set((queueRaw ?? []).map((r) => r.assigned_to as string | null).filter(Boolean)),
  ] as string[];

  const assigneeNameById = new Map<string, string | null>();
  if (assigneeIds.length > 0) {
    const { data: assignees } = await admin
      .from("users")
      .select("id,full_name")
      .in("id", assigneeIds);
    for (const u of assignees ?? []) {
      assigneeNameById.set(u.id as string, u.full_name as string | null);
    }
  }

  const assignmentQueue: AssignmentQueueRow[] = (queueRaw ?? []).map((r) => ({
    id: r.id as string,
    loan_id: r.loan_id as string,
    tier: (r.tier as string | null) ?? null,
    status: r.status as string,
    assignment_method: (r.assignment_method as string | null) ?? null,
    created_at: r.created_at as string,
    assignee_name: r.assigned_to ? (assigneeNameById.get(r.assigned_to as string) ?? null) : null,
    error_message: (r.error_message as string | null) ?? null,
  }));

  const loNames = (users ?? []).map((u) => u.full_name).filter(Boolean) as string[];

  // ── Unassigned leads for the executive view ──────────────────────────────
  const TERMINAL = new Set(["funded", "closed", "withdrawn", "denied", "duplicate", "bad_lead"]);
  const TERMINAL_STATUS = new Set(["Funded", "Withdrawn", "Denied", "Duplicate", "Bad Lead", "Do Not Contact", "Long Term Nurture"]);
  type UnassignedLoan = {
    id: string;
    shape_record_id: number | null;
    borrower_first_name: string | null;
    borrower_last_name: string | null;
    source: string | null;
    status_raw: string | null;
    current_stage: string | null;
    lead_created_at: string | null;
    assigned_loan_officer_user_id: string | null;
    assigned_loan_officer_name: string | null;
  };
  const unassignedExecLoans: UnassignedLoan[] = ((loans ?? []) as unknown as UnassignedLoan[])
    .filter((l) =>
      !l.assigned_loan_officer_user_id &&
      !TERMINAL.has(l.current_stage ?? "") &&
      !TERMINAL_STATUS.has(l.status_raw ?? "")
    )
    .sort((a, b) => {
      const da = a.lead_created_at ? new Date(a.lead_created_at).getTime() : 0;
      const db = b.lead_created_at ? new Date(b.lead_created_at).getTime() : 0;
      return db - da;
    })
    .slice(0, 50);

  const notifications: ExecNotification[] = (notificationRows ?? []).map((r) => ({
    id: r.id as string,
    kind: r.kind as string,
    title: r.title as string,
    body: (r.body as string | null) ?? null,
    createdAt: r.created_at as string,
    readAt: (r.read_at as string | null) ?? null,
    signalId: (r.signal_id as string | null) ?? null,
    payload: (r.payload ?? {}) as Record<string, unknown>,
  }));

  const execLoans = ((loans ?? []) as unknown as ExecLoan[]);
  const monthStartDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const activePipelineCount = execLoans.filter(
    (l) => l.current_stage && !TERMINAL.has(l.current_stage) && !TERMINAL_STATUS.has(l.status_raw ?? ""),
  ).length;
  const fundedMtdExec = execLoans.filter((l) => {
    const end = l.closed_at;
    return end && new Date(end) >= monthStartDate;
  });
  const mtdVolumeExec = fundedMtdExec.reduce((n, l) => n + (l.loan_amount_cents ?? 0), 0);

  return (
    <div className="qr-dashboard-page animate-fade-up">
      <DashboardPageHeader
        eyebrow="Executive"
        title="Executive Dashboard"
        description="All-company visibility · signals · AI command center"
        actions={<ExecNotifications initial={notifications} />}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Active Pipeline" value={activePipelineCount} color="yellow" />
        <KpiCard
          label="Funded MTD"
          value={fundedMtdExec.length}
          sub={formatCurrency(mtdVolumeExec)}
          color="green"
          subColor="up"
        />
        <KpiCard
          label="SLA Critical"
          value={slaRedCount ?? 0}
          color={(slaRedCount ?? 0) > 0 ? "red" : "green"}
          subColor={(slaRedCount ?? 0) > 0 ? "down" : "up"}
        />
        <KpiCard
          label="Unassigned"
          value={unassignedExecLoans.length}
          color={unassignedExecLoans.length > 0 ? "red" : "green"}
          sub={unassignedExecLoans.length > 0 ? "needs routing" : "all assigned"}
        />
      </div>

      <LeadTierOverview stats={tierStats} />

      {/* ── Unassigned Leads — need immediate attention ───────────────────── */}
      {unassignedExecLoans.length > 0 && (
        <div className="dash-card" style={{ borderColor: "rgba(255,75,75,0.25)" }}>
          <div className="dash-card-header">
            <div className="flex items-center gap-2">
              <span className="dash-card-title">Unassigned Leads</span>
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: "rgba(255,75,75,0.15)", color: "#FF4B4B" }}>
                {unassignedExecLoans.length}
              </span>
            </div>
            <span className="lo-muted text-[11px]">No LO assigned — needs routing</span>
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
                {unassignedExecLoans.map((l) => {
                  const name = [l.borrower_first_name, l.borrower_last_name].filter(Boolean).join(" ") || "—";
                  const shapeUrl = l.shape_record_id ? `https://secure.setshape.com/leads/${l.shape_record_id}` : null;
                  return (
                    <tr key={l.id} style={{ background: "rgba(255,75,75,0.02)" }}>
                      <td className="font-medium">{name}</td>
                      <td><SourceBadge source={l.source} /></td>
                      <td className="lo-muted text-[12px]">{l.status_raw || "—"}</td>
                      <td className="lo-muted text-[12px]">{l.current_stage?.replace(/_/g, " ") ?? "—"}</td>
                      <td className="lo-muted font-mono text-[11px]">
                        {l.lead_created_at ? new Date(l.lead_created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                      </td>
                      <td className="r">
                        {shapeUrl ? (
                          <a href={shapeUrl} target="_blank" rel="noopener noreferrer" className="lo-link-chip shape">
                            Open ↗
                          </a>
                        ) : <span className="lo-muted font-mono text-[11px]">{l.shape_record_id ?? "—"}</span>}
                      </td>
                    </tr>
                  );
                })}
              </ExpandableRows>
            </tbody>
          </table>
        </div>
      )}

      <OpportunitiesPanel
        signals={opportunities.panelSignals}
        loRollups={opportunities.loRollups}
        lastRunAt={opportunities.lastRunAt}
      />

      <AssignmentQueuePanel rows={assignmentQueue} />

      <BlitzBuilder />

      {/* Document health and ML readiness stream in after the above renders */}
      <Suspense fallback={null}>
        <DocumentHealthSection />
      </Suspense>

      <Suspense fallback={null}>
        <MlReadinessSection />
      </Suspense>

      {/* Manager Scorecards — per-manager SLA compliance + MTD performance */}
      <Suspense fallback={null}>
        <ManagerScorecardsSection />
      </Suspense>

      {/* Live Activity Feed — most recent Shape sync changes */}
      <Suspense fallback={null}>
        <LiveActivityFeedSection />
      </Suspense>

      <ExecChat />

      <ExecutiveFilters loans={((loans ?? []) as unknown) as ExecLoan[]} loNames={loNames} />
    </div>
  );
}
