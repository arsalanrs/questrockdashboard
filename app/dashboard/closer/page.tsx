import { notFound } from "next/navigation";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { CloserQueue } from "@/components/dashboard/closer/CloserQueue";
import { requireCurrentUser } from "@/lib/current-user";
import { canViewCloserDashboard } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type LoanRow = {
  id: string;
  shape_record_id: number | null;
  borrower_first_name: string | null;
  borrower_last_name: string | null;
  current_stage: string | null;
  closing_date: string | null;
  assigned_loan_officer_name: string | null;
};

export default async function CloserDashboardPage() {
  const { appUser } = await requireCurrentUser();
  if (!canViewCloserDashboard(appUser.role)) notFound();

  const supabase = await createSupabaseServerClient();
  const { data: loans, error } = await supabase
    .from("loans")
    .select("id,shape_record_id,borrower_first_name,borrower_last_name,current_stage,closing_date,assigned_loan_officer_name")
    .in("current_stage", ["clear_to_close", "closing"])
    .order("closing_date", { ascending: true, nullsFirst: false })
    .limit(500);

  if (error) {
    return (
      <div className="lo-card border-amber-500/50 bg-amber-50 p-4 text-sm dark:bg-amber-950/30">
        <p className="lo-heading font-medium">Unable to load queue</p>
        <p className="lo-muted mt-1 font-mono text-xs">{error.message}</p>
      </div>
    );
  }

  const rows = (loans ?? []) as unknown as LoanRow[];

  return (
    <div className="qr-dashboard-page animate-fade-up">
      <DashboardPageHeader
        eyebrow="Operations"
        title="Closer Queue"
        description={`${appUser.full_name} · Files clear to close or in closing`}
      />
      <CloserQueue rows={rows} />
    </div>
  );
}
