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
import { loadOpportunitiesPanelData } from "@/lib/signals/load-for-panel";
import { loadMlReadiness } from "@/lib/signals/load-ml-readiness";
import { loadDocumentHealth } from "@/lib/documents/load-document-health";

export default async function ExecutiveDashboardPage() {
  const { appUser } = await requireCurrentUser();
  if (!canViewExecutiveDashboard(appUser.role)) notFound();

  const admin = createSupabaseAdminClient();

  const [
    { data: loans, error },
    { data: users },
    opportunities,
    { data: notificationRows },
    mlReadiness,
    documentHealth,
  ] = await Promise.all([
      admin
        .from("loans")
        .select(
          "id,source,utm_campaign,property_state,status_raw,current_stage,loan_amount_cents,lead_created_at,credit_report_requested_at,appraisal_ordered_at,closed_at,closing_date,borrower_first_name,borrower_last_name,shape_record_id,assigned_loan_officer_name,loan_type,documentation_type,esign_returned_at,appraisal_payment_collected_at,validation_launched_at",
        )
        .limit(5000),
      admin
        .from("users")
        .select("full_name")
        .in("role", ["loan_officer", "manager", "executive"])
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
      loadMlReadiness(admin).catch((e) => {
        console.error("ML readiness load error:", e);
        return null;
      }),
      loadDocumentHealth(admin).catch((e) => {
        console.error("Document health load error:", e);
        return null;
      }),
    ]);

  if (error) throw error;

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

      <OpportunitiesPanel
        signals={opportunities.panelSignals}
        loRollups={opportunities.loRollups}
        lastRunAt={opportunities.lastRunAt}
      />

      {documentHealth ? <DocumentHealthCard health={documentHealth} /> : null}

      {mlReadiness ? <MlReadinessCard readiness={mlReadiness} /> : null}

      <ExecChat />

      <ExecutiveFilters loans={(loans ?? []) as ExecLoan[]} loNames={loNames} />
    </div>
  );
}
