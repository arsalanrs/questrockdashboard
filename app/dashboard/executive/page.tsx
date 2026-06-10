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
  for (const r of loans ?? []) {
    const t = (r.lead_tier as string | null) ?? null;
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
        {/* @ts-expect-error async server component */}
        <DocumentHealthSection />
      </Suspense>

      <Suspense fallback={null}>
        {/* @ts-expect-error async server component */}
        <MlReadinessSection />
      </Suspense>

      <ExecChat />

      <ExecutiveFilters loans={(loans ?? []) as ExecLoan[]} loNames={loNames} />
    </div>
  );
}
