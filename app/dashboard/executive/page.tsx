import { notFound } from "next/navigation";
import { requireCurrentUser } from "@/lib/current-user";
import { canViewExecutiveDashboard } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ExecutiveFilters, type ExecLoan } from "@/components/dashboard/ExecutiveFilters";

export default async function ExecutiveDashboardPage() {
  const { appUser } = await requireCurrentUser();
  if (!canViewExecutiveDashboard(appUser.role)) notFound();

  const admin = createSupabaseAdminClient();

  const [{ data: loans, error }, { data: users }] = await Promise.all([
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
  ]);

  if (error) throw error;

  const loNames = (users ?? []).map((u) => u.full_name).filter(Boolean) as string[];

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Executive Dashboard</h1>
        <p className="text-sm text-mutedForeground">
          All-company visibility with filters and drill-downs.
        </p>
      </div>

      <ExecutiveFilters loans={(loans ?? []) as ExecLoan[]} loNames={loNames} />
    </div>
  );
}
