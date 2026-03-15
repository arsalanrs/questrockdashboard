import { differenceInCalendarDays, startOfDay } from "date-fns";
import { notFound } from "next/navigation";
import { Badge } from "@/components/Badge";
import { StatCard } from "@/components/StatCard";
import { requireCurrentUser } from "@/lib/current-user";
import { canViewManagerDashboard } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { avg, formatCurrency, monthStart, sum } from "@/lib/metrics";

type LoanRow = {
  id: string;
  shape_record_id: number | null;
  borrower_first_name: string | null;
  borrower_last_name: string | null;
  current_stage: string | null;
  closing_date: string | null;
  closed_at: string | null;
  loan_amount_cents: number | null;
  assigned_loan_officer_user_id: string | null;
  assigned_loan_officer_name: string | null;
  loan_stage_events: Array<{ entered_at: string }> | null;
  conditions: Array<{ status: "open" | "cleared" }> | null;
};

function daysInStage(events: Array<{ entered_at: string }> | null | undefined) {
  const latest = (events ?? [])
    .map((e) => new Date(e.entered_at))
    .filter((d) => !Number.isNaN(d.getTime()))
    .sort((a, b) => b.getTime() - a.getTime())[0];
  if (!latest) return null;
  return differenceInCalendarDays(new Date(), latest);
}

export default async function ManagerDashboardPage() {
  const { appUser } = await requireCurrentUser();
  if (!canViewManagerDashboard(appUser.role)) notFound();

  const supabase = await createSupabaseServerClient();

  const [{ data: slaRows, error: slaError }, { data: teamRows, error: teamErr }, { data: loans, error: loansErr }] =
    await Promise.all([
      supabase.from("sla_thresholds").select("stage,max_days"),
      supabase.from("teams").select("id,name,manager_user_id"),
      supabase
        .from("loans")
        .select(
          "id,shape_record_id,borrower_first_name,borrower_last_name,current_stage,closing_date,closed_at,loan_amount_cents,assigned_loan_officer_user_id,assigned_loan_officer_name,loan_stage_events(entered_at),conditions(status)"
        )
        .limit(500),
    ]);

  if (slaError) throw slaError;
  if (teamErr) throw teamErr;
  if (loansErr) throw loansErr;

  const teams = (teamRows ?? []).filter((t) => t.manager_user_id === appUser.id);
  if (!teams.length && appUser.role === "manager") {
    return (
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">Manager</h1>
        <p className="text-sm text-mutedForeground">No team is assigned to you yet.</p>
      </div>
    );
  }

  const slaByStage = new Map<string, number>();
  (slaRows ?? []).forEach((r) => slaByStage.set(r.stage, r.max_days));

  const today = startOfDay(new Date());
  const mStart = monthStart();

  const loanRows = (loans ?? []) as unknown as LoanRow[];
  const activeLoans = loanRows.filter((l) => l.current_stage && l.current_stage !== "funded");

  const stuckLoans = activeLoans
    .map((l) => {
      const d = daysInStage(l.loan_stage_events);
      const sla = l.current_stage ? slaByStage.get(l.current_stage) ?? null : null;
      const exceeded = d != null && sla != null ? d > sla : false;
      const openConditions = (l.conditions ?? []).filter((c) => c.status === "open").length;
      return { ...l, daysInStage: d, sla, exceeded, openConditions };
    })
    .filter((l) => l.exceeded)
    .sort((a, b) => (b.daysInStage ?? 0) - (a.daysInStage ?? 0))
    .slice(0, 25);

  // LO ranking (by MTD volume, then closings)
  const fundedMtd = loanRows.filter((l) => l.closed_at && new Date(l.closed_at) >= mStart);
  const perLo = new Map<
    string,
    { name: string; active: number; mtdLoans: number; mtdVolumeCents: number; upcomingClosings: number }
  >();

  for (const l of loanRows) {
    const key = l.assigned_loan_officer_user_id ?? l.assigned_loan_officer_name ?? "unassigned";
    const name = l.assigned_loan_officer_name ?? "Unassigned";
    const row = perLo.get(key) ?? { name, active: 0, mtdLoans: 0, mtdVolumeCents: 0, upcomingClosings: 0 };
    if (l.current_stage && l.current_stage !== "funded") row.active += 1;
    if (l.closed_at && new Date(l.closed_at) >= mStart) {
      row.mtdLoans += 1;
      row.mtdVolumeCents += l.loan_amount_cents ?? 0;
    }
    if (l.closing_date) {
      const cd = new Date(l.closing_date);
      if (cd >= today) row.upcomingClosings += 1;
    }
    perLo.set(key, row);
  }

  const ranking = [...perLo.values()]
    .filter((r) => r.name !== "Unassigned")
    .sort((a, b) => b.mtdVolumeCents - a.mtdVolumeCents || b.mtdLoans - a.mtdLoans)
    .slice(0, 10);

  const mtdVolumeCents = sum(fundedMtd.map((l) => l.loan_amount_cents ?? null));
  const mtdClosed = fundedMtd.length;
  const avgLoanSize = mtdClosed ? Math.round(mtdVolumeCents / mtdClosed) : null;

  const upcoming = activeLoans
    .filter((l) => l.closing_date)
    .filter((l) => new Date(l.closing_date!) >= today)
    .sort((a, b) => new Date(a.closing_date!).getTime() - new Date(b.closing_date!).getTime())
    .slice(0, 10);

  const avgDaysInStage = avg(activeLoans.map((l) => daysInStage(l.loan_stage_events)));

  return (
    <div className="space-y-10">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Manager</h1>
        <p className="text-sm text-mutedForeground">
          {teams.map((t) => t.name).join(", ") || "All teams"} · Avg days in stage: {avgDaysInStage?.toFixed(1) ?? "—"}
        </p>
      </div>

      <section className="space-y-3">
        <div className="text-sm font-semibold">Team performance</div>
        <div className="grid gap-3 md:grid-cols-4">
          <StatCard label="Active Loans" value={activeLoans.length} />
          <StatCard label="Loans Stuck (SLA)" value={stuckLoans.length} />
          <StatCard label="MTD Volume" value={formatCurrency(mtdVolumeCents)} />
          <StatCard label="Avg Loan Size" value={formatCurrency(avgLoanSize)} />
        </div>
      </section>

      <section className="space-y-3">
        <div className="text-sm font-semibold">Loan Officer ranking (MTD)</div>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr className="text-left text-xs text-mutedForeground">
                <th className="px-3 py-2">Loan Officer</th>
                <th className="px-3 py-2">Active</th>
                <th className="px-3 py-2">MTD Loans</th>
                <th className="px-3 py-2">MTD Volume</th>
                <th className="px-3 py-2">Upcoming Closings</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((r) => (
                <tr key={r.name} className="border-t border-border">
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2">{r.active}</td>
                  <td className="px-3 py-2">{r.mtdLoans}</td>
                  <td className="px-3 py-2">{formatCurrency(r.mtdVolumeCents)}</td>
                  <td className="px-3 py-2">{r.upcomingClosings}</td>
                </tr>
              ))}
              {ranking.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-center text-sm text-mutedForeground" colSpan={5}>
                    No team production yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <div className="text-sm font-semibold">Loans stuck (SLA exceeded)</div>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr className="text-left text-xs text-mutedForeground">
                <th className="px-3 py-2">Loan #</th>
                <th className="px-3 py-2">Borrower</th>
                <th className="px-3 py-2">Stage</th>
                <th className="px-3 py-2">Days in Stage</th>
                <th className="px-3 py-2">Conditions</th>
                <th className="px-3 py-2">Owner</th>
              </tr>
            </thead>
            <tbody>
              {stuckLoans.map((l) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">{l.shape_record_id ?? "—"}</td>
                  <td className="px-3 py-2">
                    {l.borrower_first_name ?? ""} {l.borrower_last_name ?? ""}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="red">{l.current_stage ?? "—"}</Badge>
                  </td>
                  <td className="px-3 py-2">{l.daysInStage ?? "—"}</td>
                  <td className="px-3 py-2">{l.openConditions}</td>
                  <td className="px-3 py-2">{l.assigned_loan_officer_name ?? "—"}</td>
                </tr>
              ))}
              {stuckLoans.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-center text-sm text-mutedForeground" colSpan={6}>
                    No stuck loans right now.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <div className="text-sm font-semibold">Upcoming closings</div>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr className="text-left text-xs text-mutedForeground">
                <th className="px-3 py-2">Closing Date</th>
                <th className="px-3 py-2">Loan #</th>
                <th className="px-3 py-2">Borrower</th>
                <th className="px-3 py-2">Stage</th>
                <th className="px-3 py-2">Owner</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((l) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="px-3 py-2">{l.closing_date}</td>
                  <td className="px-3 py-2 font-mono text-xs">{l.shape_record_id ?? "—"}</td>
                  <td className="px-3 py-2">
                    {l.borrower_first_name ?? ""} {l.borrower_last_name ?? ""}
                  </td>
                  <td className="px-3 py-2">{l.current_stage ?? "—"}</td>
                  <td className="px-3 py-2">{l.assigned_loan_officer_name ?? "—"}</td>
                </tr>
              ))}
              {upcoming.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-center text-sm text-mutedForeground" colSpan={5}>
                    No upcoming closings visible.
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

