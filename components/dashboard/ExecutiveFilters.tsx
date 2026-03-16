"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

const ClientPieChart = dynamic(
  () => import("@/components/dashboard/ClientPieChart").then((m) => m.default),
  {
    ssr: false,
    loading: () => <div className="rounded bg-muted/30 animate-pulse" style={{ width: "100%", height: 180 }} aria-hidden />,
  },
);

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type ExecLoan = {
  id: string;
  source: string | null;
  utm_campaign: string | null;
  property_state: string | null;
  status_raw: string | null;
  loan_amount_cents: number | null;
  lead_created_at: string | null;
  credit_report_requested_at: string | null;
  appraisal_ordered_at: string | null;
  closed_at: string | null;
  closing_date: string | null;
  borrower_first_name: string | null;
  borrower_last_name: string | null;
  shape_record_id: number | null;
  assigned_loan_officer_name: string | null;
  loan_type: string | null;
  documentation_type: string | null;
};

type Props = {
  loans: ExecLoan[];
  loNames: string[];
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function fmt$(cents: number) {
  if (!cents) return "$0";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

function pct(n: number, total: number) {
  if (!total) return "0%";
  return `${((n / total) * 100).toFixed(1)}%`;
}

const COLORS = [
  "#3b82f6", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#84cc16", "#6366f1",
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ExecutiveFilters({ loans, loNames }: Props) {
  const [dateMode, setDateMode] = useState<"mtd" | "ytd" | "prev_year" | "custom">("mtd");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [filterState, setFilterState] = useState("");
  const [filterUtm, setFilterUtm] = useState("");
  const [filterLo, setFilterLo] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  /* ---- date range ---- */
  const { from, to } = useMemo(() => {
    const now = new Date();
    if (dateMode === "mtd") return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
    if (dateMode === "ytd") return { from: new Date(now.getFullYear(), 0, 1), to: now };
    if (dateMode === "prev_year") return { from: new Date(now.getFullYear() - 1, 0, 1), to: new Date(now.getFullYear() - 1, 11, 31) };
    return {
      from: customFrom ? new Date(customFrom) : new Date(now.getFullYear(), 0, 1),
      to: customTo ? new Date(customTo) : now,
    };
  }, [dateMode, customFrom, customTo]);

  /* ---- filter loans ---- */
  const filtered = useMemo(() => {
    return loans.filter((l) => {
      const ld = l.lead_created_at ? new Date(l.lead_created_at) : null;
      if (ld && (ld < from || ld > to)) return false;
      if (filterSource && (l.source ?? "").toLowerCase() !== filterSource.toLowerCase()) return false;
      if (filterState && (l.property_state ?? "").toLowerCase() !== filterState.toLowerCase()) return false;
      if (filterUtm && (l.utm_campaign ?? "").toLowerCase() !== filterUtm.toLowerCase()) return false;
      if (filterLo && (l.assigned_loan_officer_name ?? "").toLowerCase() !== filterLo.toLowerCase()) return false;
      if (filterStatus && (l.status_raw ?? "").toLowerCase() !== filterStatus.toLowerCase()) return false;
      return true;
    });
  }, [loans, from, to, filterSource, filterState, filterUtm, filterLo, filterStatus]);

  /* ---- unique values for filters ---- */
  const uniqueSources = useMemo(() => [...new Set(loans.map((l) => l.source?.trim()).filter(Boolean))].sort() as string[], [loans]);
  const uniqueStates = useMemo(() => [...new Set(loans.map((l) => l.property_state?.trim()).filter(Boolean))].sort() as string[], [loans]);
  const uniqueUtms = useMemo(() => [...new Set(loans.map((l) => l.utm_campaign?.trim()).filter(Boolean))].sort() as string[], [loans]);
  const uniqueStatuses = useMemo(() => [...new Set(loans.map((l) => l.status_raw?.trim()).filter(Boolean))].sort() as string[], [loans]);

  /* ---- pipeline metrics ---- */
  const totalFiltered = filtered.length;
  const creditPulled = filtered.filter((l) => l.credit_report_requested_at);
  const piped = filtered.filter((l) => l.appraisal_ordered_at);
  const closed = filtered.filter((l) => l.closed_at);
  const closedVolume = closed.reduce((s, l) => s + (l.loan_amount_cents ?? 0), 0);
  const denied = filtered.filter((l) => (l.status_raw ?? "").startsWith("Denied"));
  const withdrawn = filtered.filter((l) => l.status_raw === "Withdrawn");
  const deniedAfterCredit = creditPulled.filter((l) => (l.status_raw ?? "").startsWith("Denied"));

  /* ---- pie data: by source ---- */
  const bySourcePie = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of filtered) { const k = l.source?.trim() || "(none)"; m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, value], i) => ({ name, value, color: COLORS[i % COLORS.length], percent: totalFiltered ? value / totalFiltered : 0 }));
  }, [filtered, totalFiltered]);

  /* ---- pie data: by state ---- */
  const byStatePie = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of filtered) { const k = l.property_state?.trim() || "(none)"; m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, value], i) => ({ name, value, color: COLORS[i % COLORS.length], percent: totalFiltered ? value / totalFiltered : 0 }));
  }, [filtered, totalFiltered]);

  /* ---- pie data: by status ---- */
  const byStatusPie = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of filtered) { const k = l.status_raw?.trim() || "(none)"; m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, value], i) => ({ name, value, color: COLORS[i % COLORS.length], percent: totalFiltered ? value / totalFiltered : 0 }));
  }, [filtered, totalFiltered]);

  /* ---- loan anniversaries ---- */
  const anniversaries = useMemo(() => {
    const now = Date.now();
    const results: Array<ExecLoan & { milestone: string; daysSinceClosed: number }> = [];
    for (const l of loans) {
      if (!l.closed_at) continue;
      const cd = new Date(l.closed_at);
      const daysSince = Math.floor((now - cd.getTime()) / (1000 * 60 * 60 * 24));
      const milestones = [
        { days: 180, label: "6 months" },
        { days: 365, label: "1 year" },
        { days: 548, label: "1.5 years" },
        { days: 730, label: "2 years" },
      ];
      for (const m of milestones) {
        if (Math.abs(daysSince - m.days) <= 15) {
          results.push({ ...l, milestone: m.label, daysSinceClosed: daysSince });
          break;
        }
      }
    }
    return results.sort((a, b) => a.daysSinceClosed - b.daysSinceClosed);
  }, [loans]);

  /* ---- pre-pipeline by status ---- */
  const byStatus = useMemo(() => {
    const m = new Map<string, ExecLoan[]>();
    for (const l of filtered) {
      const k = l.status_raw?.trim() || "(no status)";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(l);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [filtered]);

  const [expandedStatus, setExpandedStatus] = useState<string | null>(null);

  return (
    <div className="space-y-8">
      {/* ── Filters ────────────────────────────────────────────────── */}
      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-mutedForeground">Date Range:</span>
          {(["mtd", "ytd", "prev_year", "custom"] as const).map((m) => (
            <button key={m} onClick={() => setDateMode(m)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${dateMode === m ? "bg-foreground text-background" : "bg-muted text-foreground hover:bg-muted/80"}`}>
              {m === "mtd" ? "MTD" : m === "ytd" ? "YTD" : m === "prev_year" ? "Prev Year" : "Custom"}
            </button>
          ))}
          {dateMode === "custom" && (
            <div className="flex items-center gap-2 ml-2">
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="rounded border border-border bg-transparent px-2 py-1 text-xs" />
              <span className="text-xs text-mutedForeground">to</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="rounded border border-border bg-transparent px-2 py-1 text-xs" />
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <select value={filterSource} onChange={(e) => setFilterSource(e.target.value)} className="rounded border border-border bg-transparent px-2 py-1 text-xs">
            <option value="">All Sources</option>
            {uniqueSources.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filterState} onChange={(e) => setFilterState(e.target.value)} className="rounded border border-border bg-transparent px-2 py-1 text-xs">
            <option value="">All States</option>
            {uniqueStates.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filterUtm} onChange={(e) => setFilterUtm(e.target.value)} className="rounded border border-border bg-transparent px-2 py-1 text-xs">
            <option value="">All UTM Campaigns</option>
            {uniqueUtms.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filterLo} onChange={(e) => setFilterLo(e.target.value)} className="rounded border border-border bg-transparent px-2 py-1 text-xs">
            <option value="">All Loan Officers</option>
            {loNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="rounded border border-border bg-transparent px-2 py-1 text-xs">
            <option value="">All Statuses</option>
            {uniqueStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {(filterSource || filterState || filterUtm || filterLo || filterStatus) && (
            <button onClick={() => { setFilterSource(""); setFilterState(""); setFilterUtm(""); setFilterLo(""); setFilterStatus(""); }}
              className="text-xs text-mutedForeground hover:text-foreground">Clear filters</button>
          )}
        </div>
        <div className="text-xs text-mutedForeground">{filtered.length} loans in view</div>
      </div>

      {/* ── Volume ─────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="text-sm font-semibold">Volume</div>
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-border bg-card px-4 py-3"><div className="text-xs text-mutedForeground">Total Leads</div><div className="mt-1 text-xl font-bold tabular-nums">{totalFiltered}</div></div>
          <div className="rounded-lg border border-border bg-card px-4 py-3"><div className="text-xs text-mutedForeground">MTD Closed</div><div className="mt-1 text-xl font-bold tabular-nums">{closed.length}</div></div>
          <div className="rounded-lg border border-border bg-card px-4 py-3"><div className="text-xs text-mutedForeground">Closed Volume</div><div className="mt-1 text-xl font-bold tabular-nums">{fmt$(closedVolume)}</div></div>
          <div className="rounded-lg border border-border bg-card px-4 py-3"><div className="text-xs text-mutedForeground">Avg Loan Size</div><div className="mt-1 text-xl font-bold tabular-nums">{closed.length ? fmt$(Math.round(closedVolume / closed.length)) : "—"}</div></div>
        </div>
      </section>

      {/* ── Pipeline Metrics ───────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="text-sm font-semibold">Pipeline Metrics</div>
        <div className="grid gap-3 md:grid-cols-5">
          <div className="rounded-lg border border-border bg-card px-4 py-3">
            <div className="text-xs text-mutedForeground">Credit Pulls</div>
            <div className="mt-1 text-xl font-bold tabular-nums">{creditPulled.length} <span className="text-sm font-normal text-mutedForeground">{pct(creditPulled.length, totalFiltered)}</span></div>
            {deniedAfterCredit.length > 0 && <div className="mt-1 text-[10px] text-red-500">{deniedAfterCredit.length} denied after credit</div>}
          </div>
          <div className="rounded-lg border border-border bg-card px-4 py-3">
            <div className="text-xs text-mutedForeground">Piped (Appraisals)</div>
            <div className="mt-1 text-xl font-bold tabular-nums">{piped.length} <span className="text-sm font-normal text-mutedForeground">{pct(piped.length, totalFiltered)}</span></div>
          </div>
          <div className="rounded-lg border border-border bg-card px-4 py-3">
            <div className="text-xs text-mutedForeground">Closed</div>
            <div className="mt-1 text-xl font-bold tabular-nums">{closed.length} <span className="text-sm font-normal text-mutedForeground">{pct(closed.length, totalFiltered)}</span></div>
          </div>
          <div className="rounded-lg border border-border bg-card px-4 py-3">
            <div className="text-xs text-mutedForeground">Denied</div>
            <div className="mt-1 text-xl font-bold tabular-nums text-red-500">{denied.length}</div>
          </div>
          <div className="rounded-lg border border-border bg-card px-4 py-3">
            <div className="text-xs text-mutedForeground">Withdrawn</div>
            <div className="mt-1 text-xl font-bold tabular-nums text-amber-500">{withdrawn.length}</div>
          </div>
        </div>
      </section>

      {/* ── Pie Charts ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="text-sm font-semibold">Distribution</div>
        <div className="grid gap-6 lg:grid-cols-3">
          {[
            { title: "By Source", data: bySourcePie },
            { title: "By State", data: byStatePie },
            { title: "By Status", data: byStatusPie },
          ].map(({ title, data }) => (
            <div key={title} className="rounded-lg border border-border bg-card p-4">
              <div className="text-xs font-semibold mb-3">{title}</div>
              <ClientPieChart data={data} width="100%" height={180} innerRadius={40} outerRadius={70} />
              <div className="mt-2 space-y-1">
                {data.map((d) => (
                  <div key={d.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <div className="h-2 w-2 rounded-full" style={{ background: d.color }} />
                      <span className="truncate max-w-[120px]">{d.name}</span>
                    </div>
                    <span className="tabular-nums text-mutedForeground">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Pre-Pipeline by Status ─────────────────────────────────── */}
      <section className="space-y-3">
        <div className="text-sm font-semibold">All Leads by Status</div>
        <div className="rounded-lg border border-border bg-card">
          <div className="max-h-[400px] overflow-y-auto divide-y divide-border">
            {byStatus.map(([status, statusLoans]) => (
              <div key={status}>
                <button
                  onClick={() => setExpandedStatus(expandedStatus === status ? null : status)}
                  className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-muted/40 transition-colors"
                >
                  <span className="font-medium">{status}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-mutedForeground">{pct(statusLoans.length, totalFiltered)}</span>
                    <span className="min-w-[2rem] rounded-full bg-muted px-2 py-0.5 text-center text-xs font-semibold tabular-nums">{statusLoans.length}</span>
                    <svg className={`h-3.5 w-3.5 transition-transform ${expandedStatus === status ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                    </svg>
                  </div>
                </button>
                {expandedStatus === status && (
                  <div className="border-t border-border bg-muted/20 px-4 py-2 max-h-[200px] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-mutedForeground">
                          <th className="py-1 pr-2">Borrower</th>
                          <th className="py-1 pr-2">LO</th>
                          <th className="py-1 pr-2">Source</th>
                          <th className="py-1">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {statusLoans.slice(0, 25).map((l) => (
                          <tr key={l.id}>
                            <td className="py-1 pr-2 font-medium">{[l.borrower_first_name, l.borrower_last_name].filter(Boolean).join(" ") || "—"}</td>
                            <td className="py-1 pr-2 text-mutedForeground">{l.assigned_loan_officer_name ?? "Unassigned"}</td>
                            <td className="py-1 pr-2 text-mutedForeground">{l.source ?? "—"}</td>
                            <td className="py-1 tabular-nums">{l.loan_amount_cents ? fmt$(l.loan_amount_cents) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Loan Anniversaries ─────────────────────────────────────── */}
      {anniversaries.length > 0 && (
        <section className="space-y-3">
          <div className="text-sm font-semibold">Loan Anniversaries</div>
          <p className="text-xs text-mutedForeground">Closed loans reaching a milestone — reach out to customer about refinance opportunities.</p>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr className="text-left text-xs text-mutedForeground">
                  <th className="px-3 py-2">Borrower</th>
                  <th className="px-3 py-2">Milestone</th>
                  <th className="px-3 py-2">Closed</th>
                  <th className="px-3 py-2">Loan Type</th>
                  <th className="px-3 py-2">Amount</th>
                  <th className="px-3 py-2">State</th>
                  <th className="px-3 py-2">LO</th>
                  <th className="px-3 py-2">Shape</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {anniversaries.map((l) => (
                  <tr key={l.id} className="hover:bg-muted/40">
                    <td className="px-3 py-2 font-medium">{[l.borrower_first_name, l.borrower_last_name].filter(Boolean).join(" ") || "—"}</td>
                    <td className="px-3 py-2"><span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-600 dark:text-blue-400">{l.milestone}</span></td>
                    <td className="px-3 py-2 text-xs text-mutedForeground">{l.closed_at ? new Date(l.closed_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}</td>
                    <td className="px-3 py-2 text-xs">{l.loan_type ?? "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{l.loan_amount_cents ? fmt$(l.loan_amount_cents) : "—"}</td>
                    <td className="px-3 py-2 text-xs">{l.property_state ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-mutedForeground">{l.assigned_loan_officer_name ?? "—"}</td>
                    <td className="px-3 py-2">
                      {l.shape_record_id ? (
                        <a href={`https://secure.setshape.com/prospects/${l.shape_record_id}/edit`} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline dark:text-blue-400">#{l.shape_record_id}</a>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
