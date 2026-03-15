import { startOfDay } from "date-fns";
import { notFound } from "next/navigation";
import { Badge } from "@/components/Badge";
import { StatCard } from "@/components/StatCard";
import { requireCurrentUser } from "@/lib/current-user";
import { canViewExecutiveDashboard } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { avg, formatCurrency, monthStart, sum } from "@/lib/metrics";

type LoanRow = {
  id: string;
  source: string | null;
  utm_campaign: string | null;
  channel: string | null;
  property_state: string | null;
  status_raw: string | null;
  current_stage: string | null;
  loan_amount_cents: number | null;
  lead_created_at: string | null;
  application_completed_at: string | null;
  credit_report_requested_at: string | null;
  appraisal_requested_at: string | null;
  closed_at: string | null;
  closing_date: string | null;
};

function groupCount(rows: LoanRow[], keyFn: (r: LoanRow) => string) {
  const m = new Map<string, number>();
  for (const r of rows) m.set(keyFn(r), (m.get(keyFn(r)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export default async function ExecutiveDashboardPage() {
  const { appUser } = await requireCurrentUser();
  if (!canViewExecutiveDashboard(appUser.role)) notFound();

  const supabase = await createSupabaseServerClient();
  const { data: loans, error } = await supabase
    .from("loans")
    .select(
      "id,source,utm_campaign,channel,property_state,status_raw,current_stage,loan_amount_cents,lead_created_at,application_completed_at,credit_report_requested_at,appraisal_requested_at,closed_at,closing_date"
    )
    .limit(2000);
  if (error) throw error;

  const rows = (loans ?? []) as unknown as LoanRow[];
  const today = startOfDay(new Date());
  const mStart = monthStart();

  const fundedMtd = rows.filter((l) => l.closed_at && new Date(l.closed_at) >= mStart);
  const mtdVolumeCents = sum(fundedMtd.map((l) => l.loan_amount_cents ?? null));
  const mtdClosed = fundedMtd.length;
  const avgLoanSize = mtdClosed ? Math.round(mtdVolumeCents / mtdClosed) : null;
  const revenueBps = 250;
  const revenueCents = Math.round(mtdVolumeCents * (revenueBps / 10_000));

  const leadsMtd = rows.filter((l) => l.lead_created_at && new Date(l.lead_created_at) >= mStart);
  const appCompletedMtd = leadsMtd.filter((l) => !!l.application_completed_at);
  const creditPulledMtd = leadsMtd.filter((l) => !!l.credit_report_requested_at);
  const appraisalMtd = leadsMtd.filter((l) => !!l.appraisal_requested_at);

  const upcomingClosings = rows
    .filter((l) => l.closing_date && new Date(l.closing_date) >= today && l.current_stage !== "funded")
    .sort((a, b) => new Date(a.closing_date!).getTime() - new Date(b.closing_date!).getTime())
    .slice(0, 10);

  const byUtm = groupCount(leadsMtd, (r) => r.utm_campaign?.trim() || "(none)").slice(0, 10);
  const bySource = groupCount(leadsMtd, (r) => r.source?.trim() || "(none)").slice(0, 10);
  const byState = groupCount(rows, (r) => r.property_state?.trim() || "(none)").slice(0, 10);

  const leadToAppDays = avg(
    rows.map((l) => {
      if (!l.lead_created_at || !l.application_completed_at) return null;
      const a = new Date(l.lead_created_at);
      const b = new Date(l.application_completed_at);
      return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
    })
  );

  return (
    <div className="space-y-10">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Executive</h1>
        <p className="text-sm text-mutedForeground">All-company visibility · MTD focus</p>
      </div>

      <section className="space-y-3">
        <div className="text-sm font-semibold">Revenue & volume</div>
        <div className="grid gap-3 md:grid-cols-5">
          <StatCard label="MTD Volume" value={formatCurrency(mtdVolumeCents)} />
          <StatCard label="Loans Closed" value={mtdClosed} />
          <StatCard label="Average Loan Size" value={formatCurrency(avgLoanSize)} />
          <StatCard label="Revenue Generated" value={formatCurrency(revenueCents)} subtext={`${revenueBps} bps`} />
          <StatCard label="Upcoming Closings" value={upcomingClosings.length} />
        </div>
      </section>

      <section className="space-y-3">
        <div className="text-sm font-semibold">Marketing ROI (proxy funnel, MTD)</div>
        <div className="grid gap-3 md:grid-cols-4">
          <StatCard label="Leads" value={leadsMtd.length} />
          <StatCard label="Applications Completed" value={appCompletedMtd.length} />
          <StatCard label="Credit Pulled" value={creditPulledMtd.length} />
          <StatCard label="Appraisals Requested" value={appraisalMtd.length} subtext={`Lead→App avg ${leadToAppDays?.toFixed(1) ?? "—"}d`} />
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="text-sm font-semibold">Lead source conversion (MTD)</div>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr className="text-left text-xs text-mutedForeground">
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Leads</th>
                </tr>
              </thead>
              <tbody>
                {bySource.map(([k, v]) => (
                  <tr key={k} className="border-t border-border">
                    <td className="px-3 py-2">{k}</td>
                    <td className="px-3 py-2">{v}</td>
                  </tr>
                ))}
                {bySource.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-sm text-mutedForeground" colSpan={2}>
                      No data yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-3">
          <div className="text-sm font-semibold">UTM campaign performance (MTD)</div>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr className="text-left text-xs text-mutedForeground">
                  <th className="px-3 py-2">UTM campaign</th>
                  <th className="px-3 py-2">Leads</th>
                </tr>
              </thead>
              <tbody>
                {byUtm.map(([k, v]) => (
                  <tr key={k} className="border-t border-border">
                    <td className="px-3 py-2">{k}</td>
                    <td className="px-3 py-2">{v}</td>
                  </tr>
                ))}
                {byUtm.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-sm text-mutedForeground" colSpan={2}>
                      No data yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="text-sm font-semibold">State performance</div>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr className="text-left text-xs text-mutedForeground">
                  <th className="px-3 py-2">State</th>
                  <th className="px-3 py-2">Loans/Leads</th>
                </tr>
              </thead>
              <tbody>
                {byState.map(([k, v]) => (
                  <tr key={k} className="border-t border-border">
                    <td className="px-3 py-2">{k}</td>
                    <td className="px-3 py-2">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">Upcoming closings</div>
            <Badge variant="muted">Next</Badge>
          </div>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr className="text-left text-xs text-mutedForeground">
                  <th className="px-3 py-2">Closing</th>
                  <th className="px-3 py-2">Stage</th>
                  <th className="px-3 py-2">Source</th>
                </tr>
              </thead>
              <tbody>
                {upcomingClosings.map((l) => (
                  <tr key={l.id} className="border-t border-border">
                    <td className="px-3 py-2">{l.closing_date}</td>
                    <td className="px-3 py-2">{l.current_stage ?? "—"}</td>
                    <td className="px-3 py-2">{l.source ?? "—"}</td>
                  </tr>
                ))}
                {upcomingClosings.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-sm text-mutedForeground" colSpan={3}>
                      No upcoming closings visible.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

