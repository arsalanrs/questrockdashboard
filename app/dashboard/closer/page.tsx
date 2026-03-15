import { notFound } from "next/navigation";
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
      <div className="rounded-lg border border-amber-500/50 bg-amber-50 p-4 text-sm dark:bg-amber-950/30">
        <p className="font-medium">Unable to load queue</p>
        <p className="mt-1 font-mono text-xs">{error.message}</p>
      </div>
    );
  }

  const rows = (loans ?? []) as unknown as LoanRow[];
  const byStage = new Map<string, number>();
  rows.forEach((l) => {
    if (l.current_stage) byStage.set(l.current_stage, (byStage.get(l.current_stage) ?? 0) + 1);
  });

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Closer queue</h1>
        <p className="text-sm text-mutedForeground">
          {appUser.full_name} · Files clear to close or in closing
        </p>
      </div>

      <section className="space-y-3">
        <div className="text-sm font-semibold">By stage</div>
        <div className="flex flex-wrap gap-3">
          {CLOSING_STAGES.map((s) => (
            <div
              key={s}
              className="rounded-lg border border-border bg-card px-4 py-2 text-sm text-cardForeground"
            >
              {STAGE_LABEL[s] ?? s}: {byStage.get(s) ?? 0}
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="text-sm font-semibold">Queue</div>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr className="text-left text-xs text-mutedForeground">
                <th className="px-3 py-2">Loan #</th>
                <th className="px-3 py-2">Borrower</th>
                <th className="px-3 py-2">Stage</th>
                <th className="px-3 py-2">Closing Date</th>
                <th className="px-3 py-2">Assigned LO</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">{l.shape_record_id ?? "—"}</td>
                  <td className="px-3 py-2">
                    {l.borrower_first_name ?? ""} {l.borrower_last_name ?? ""}
                  </td>
                  <td className="px-3 py-2">{STAGE_LABEL[l.current_stage ?? ""] ?? l.current_stage ?? "—"}</td>
                  <td className="px-3 py-2">{l.closing_date ?? "—"}</td>
                  <td className="px-3 py-2">{l.assigned_loan_officer_name ?? "—"}</td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-center text-sm text-mutedForeground" colSpan={5}>
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
