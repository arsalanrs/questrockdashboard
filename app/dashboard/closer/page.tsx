import { notFound } from "next/navigation";
import { CloserQueue, type CloserLoanRow } from "@/components/dashboard/closer/CloserQueue";
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
  loan_amount_cents: number | null;
  loan_type: string | null;
  lock_expiration_date: string | null;
  lendingpad_loan_number: string | null;
  conditions: Array<{ status: string }> | null;
};

export default async function CloserDashboardPage() {
  const { appUser } = await requireCurrentUser();
  if (!canViewCloserDashboard(appUser.role)) notFound();

  const supabase = await createSupabaseServerClient();
  const { data: loans, error } = await supabase
    .from("loans")
    .select(
      "id,shape_record_id,borrower_first_name,borrower_last_name,current_stage,closing_date,assigned_loan_officer_name,loan_amount_cents,loan_type,lock_expiration_date,lendingpad_loan_number,conditions(status)",
    )
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

  const rawRows = (loans ?? []) as unknown as LoanRow[];

  const rows: CloserLoanRow[] = rawRows.map((l) => ({
    id: l.id,
    shape_record_id: l.shape_record_id,
    borrower_first_name: l.borrower_first_name,
    borrower_last_name: l.borrower_last_name,
    current_stage: l.current_stage,
    closing_date: l.closing_date,
    assigned_loan_officer_name: l.assigned_loan_officer_name,
    loan_amount_cents: l.loan_amount_cents,
    loan_type: l.loan_type,
    lock_expiration_date: l.lock_expiration_date,
    lendingpad_loan_number: l.lendingpad_loan_number,
    openConditions: (l.conditions ?? []).filter((c) => c.status === "open").length,
  }));

  return (
    <div className="qr-dashboard-page ops-dashboard animate-fade-up">
      <CloserQueue rows={rows} closerName={appUser.full_name ?? "Closer"} />
    </div>
  );
}
