import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireCurrentUser } from "@/lib/current-user";
import { canViewExecutiveDashboard } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ExecutiveFilters, type ExecLoan } from "@/components/dashboard/ExecutiveFilters";
import { OpportunitiesPanel } from "@/components/executive/OpportunitiesPanel";
import { ExecChat } from "@/components/executive/ExecChat";
import { ExecNotifications, type ExecNotification } from "@/components/executive/ExecNotifications";
import { MlReadinessCard } from "@/components/executive/MlReadinessCard";
import { DocumentHealthCard } from "@/components/executive/DocumentHealthCard";
import { LeadTierOverview, type TierBreakdownRow } from "@/components/executive/LeadTierOverview";
import { AssignmentQueuePanel, type AssignmentQueueRow } from "@/components/executive/AssignmentQueuePanel";
import { BlitzBuilder } from "@/components/executive/BlitzBuilder";
import { loadOpportunitiesPanelData } from "@/lib/signals/load-for-panel";
import { loadMlReadiness } from "@/lib/signals/load-ml-readiness";
import { loadDocumentHealth } from "@/lib/documents/load-document-health";

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

type ActivityLogRow = {
  id: string;
  synced_at: string;
  change_type: string;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  lo_name: string | null;
  borrower_name: string | null;
};

const CHANGE_TYPE_LABELS: Record<string, string> = {
  loan_created: "New Lead",
  status_changed: "Status",
  owner_changed: "Reassigned",
  note_added: "Note",
  field_changed: "Field",
};

function ActivityBadge({ type }: { type: string }) {
  const label = CHANGE_TYPE_LABELS[type] ?? type;
  const style =
    type === "loan_created"
      ? { background: "rgba(34,197,94,0.15)", color: "#4ade80" }
      : type === "status_changed"
      ? { background: "rgba(232,255,0,0.1)", color: "#E8FF00" }
      : type === "owner_changed"
      ? { background: "rgba(139,92,246,0.15)", color: "#a78bfa" }
      : type === "note_added"
      ? { background: "rgba(59,130,246,0.15)", color: "#60a5fa" }
      : { background: "rgba(255,255,255,0.07)", color: "hsl(215 14% 52%)" };
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={style}>
      {label}
    </span>
  );
}

async function LiveActivityFeedSection() {
  const admin = createSupabaseAdminClient();
  try {
    const { data } = await admin
      .from("shape_activity_log")
      .select("id,synced_at,change_type,field_name,old_value,new_value,lo_name,borrower_name")
      .order("synced_at", { ascending: false })
      .limit(50);

    const rows = (data ?? []) as ActivityLogRow[];
    if (rows.length === 0) return null;

    return (
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
          <span className="text-sm font-semibold tracking-tight">Live Activity Feed</span>
          <span className="text-xs text-mutedForeground">— last 50 changes from Shape sync</span>
        </div>
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
                <th className="px-4 py-2.5">Time</th>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5">Borrower</th>
                <th className="px-4 py-2.5">LO</th>
                <th className="px-4 py-2.5">Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
                  className="transition-colors hover:bg-white/[0.02]"
                >
                  <td className="px-4 py-2.5 font-mono text-xs text-mutedForeground">
                    {new Date(row.synced_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-4 py-2.5">
                    <ActivityBadge type={row.change_type} />
                  </td>
                  <td className="px-4 py-2.5 text-xs font-medium">{row.borrower_name || "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-mutedForeground">{row.lo_name || "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-mutedForeground max-w-xs truncate">
                    {row.change_type === "status_changed"
                      ? `${row.old_value ?? "?"} → ${row.new_value ?? "?"}`
                      : row.change_type === "owner_changed"
                      ? `${row.old_value ?? "?"} → ${row.new_value ?? "?"}`
                      : row.change_type === "note_added"
                      ? (row.new_value ?? "").slice(0, 80)
                      : row.field_name
                      ? `${row.field_name}: ${row.new_value ?? "—"}`
                      : row.new_value ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  } catch {
    return null;
  }
}

// ─── Manager Scorecards ───────────────────────────────────────────────────────

type ManagerScorecardData = {
  managerId: string;
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
    const [{ data: teams }, { data: slaRows }, { data: mStart }] = await Promise.all([
      admin
        .from("teams")
        .select("id,name,manager_user_id,users!team_members(id)")
        .limit(20),
      admin
        .from("v_lead_sla_status")
        .select("loan_id,assigned_loan_officer_user_id,sla_color"),
      Promise.resolve(null),
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
        <div className="text-sm font-semibold tracking-tight">Manager Scorecards</div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {scorecards.map((sc) => (
            <div
              key={sc.managerId}
              className="rounded-xl p-5 space-y-4"
              style={{
                border: sc.slaRed > 0 ? "1px solid rgba(239,68,68,0.25)" : "1px solid rgba(255,255,255,0.07)",
                background: "rgba(255,255,255,0.03)",
              }}
            >
              <div>
                <div className="text-sm font-semibold">{sc.managerName}</div>
                <div className="text-xs text-mutedForeground">{sc.teamName}</div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg p-2.5 text-center" style={{ background: "rgba(255,255,255,0.04)" }}>
                  <div className="text-2xl font-bold tabular-nums" style={{ color: sc.slaRed > 0 ? "#f87171" : "inherit" }}>
                    {sc.slaRed}
                  </div>
                  <div className="text-[10px] text-mutedForeground mt-0.5">SLA Critical</div>
                </div>
                <div className="rounded-lg p-2.5 text-center" style={{ background: "rgba(255,255,255,0.04)" }}>
                  <div className="text-2xl font-bold tabular-nums" style={{ color: sc.slaGreenPct >= 80 ? "#4ade80" : "#fbbf24" }}>
                    {sc.slaGreenPct}%
                  </div>
                  <div className="text-[10px] text-mutedForeground mt-0.5">SLA Compliant</div>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-mutedForeground">MTD Closed</span>
                <span className="font-medium">
                  {sc.closedMtd} loans · {formatCurrencyK(sc.mtdVolumeCents)}
                </span>
              </div>

              {/* SLA compliance bar */}
              <div className="space-y-1">
                <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${sc.slaGreenPct}%`,
                      background: sc.slaGreenPct >= 80 ? "#4ade80" : sc.slaGreenPct >= 60 ? "#fbbf24" : "#f87171",
                    }}
                  />
                </div>
              </div>
            </div>
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
  ] = await Promise.all([
    // One query for both ExecutiveFilters AND tier breakdown.
    // lead_tier is included so we compute tier stats from the same dataset.
    admin
      .from("loans")
      .select(
        "id,lead_tier,source,utm_campaign,property_state,status_raw,current_stage," +
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

  return (
    <div className="space-y-10">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Executive Dashboard</h1>
          <p className="text-sm text-mutedForeground">
            All-company visibility with filters, drill-downs, deal detection signals, and AI command center.
          </p>
        </div>
        <ExecNotifications initial={notifications} />
      </div>

      <LeadTierOverview stats={tierStats} />

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
