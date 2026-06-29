import { notFound } from "next/navigation";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { requireCurrentUser } from "@/lib/current-user";
import { canViewCloserDashboard } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const CLOSING_STAGES = ["clear_to_close", "closing"] as const;
const STAGE_LABEL: Record<string, string> = {
  clear_to_close: "Clear to Close",
  closing: "Closing",
};

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
    .in("current_stage", [...CLOSING_STAGES])
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
  const byStage = new Map<string, number>();
  rows.forEach((l) => {
    if (l.current_stage) byStage.set(l.current_stage, (byStage.get(l.current_stage) ?? 0) + 1);
  });

  return (
    <div className="qr-dashboard-page animate-fade-up">
      <DashboardPageHeader
        eyebrow="Operations"
        title="Closer Queue"
        description={`${appUser.full_name} · Files clear to close or in closing`}
      />

      <section className="space-y-2">
        <div className="lo-accent-text text-[11px] font-semibold uppercase tracking-[0.14em]">By stage</div>
        <div className="flex flex-wrap gap-2">
          {CLOSING_STAGES.map((s) => (
            <div key={s} className="lo-mini-stat">
              <div>
                <div className="lo-mini-stat-label">{STAGE_LABEL[s] ?? s}</div>
                <div className="lo-mini-stat-value">{byStage.get(s) ?? 0}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <div className="lo-accent-text text-[11px] font-semibold uppercase tracking-[0.14em]">Queue</div>
        <div className="lo-card lo-table-wrap">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="lo-th">Loan #</th>
                <th className="lo-th">Borrower</th>
                <th className="lo-th">Stage</th>
                <th className="lo-th">Closing Date</th>
                <th className="lo-th">Assigned LO</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="lo-data-row">
                  <td className="lo-td font-mono text-xs">{l.shape_record_id ?? "—"}</td>
                  <td className="lo-td lo-name-text">
                    {l.borrower_first_name ?? ""} {l.borrower_last_name ?? ""}
                  </td>
                  <td className="lo-td">{STAGE_LABEL[l.current_stage ?? ""] ?? l.current_stage ?? "—"}</td>
                  <td className="lo-td">{l.closing_date ?? "—"}</td>
                  <td className="lo-td">{l.assigned_loan_officer_name ?? "—"}</td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td className="lo-muted lo-td px-3 py-6 text-center text-sm" colSpan={5}>
                    No files in closing queue.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
