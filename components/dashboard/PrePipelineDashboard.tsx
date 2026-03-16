"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import { cn } from "@/lib/cn";

const ClientPieChart = dynamic(
  () => import("@/components/dashboard/ClientPieChart").then((m) => m.default),
  {
    ssr: false,
    loading: () => <div className="flex items-center justify-center" style={{ width: 180, height: 180 }} aria-hidden />,
  },
);
import {
  PRE_PIPELINE_CATEGORIES,
  categorizePrePipeline,
  type PrePipelineCategory,
} from "@/lib/loan-status-groups";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type PrePipelineLoan = {
  id: string;
  shape_record_id: number | null;
  borrower_first_name: string | null;
  borrower_last_name: string | null;
  status_raw: string | null;
  loan_type: string | null;
  record_type: string | null;
  loan_amount_cents: number | null;
  lead_created_at: string | null;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function borrowerName(l: PrePipelineLoan) {
  return [l.borrower_first_name, l.borrower_last_name].filter(Boolean).join(" ") || "—";
}

function fmt$(cents: number | null) {
  if (!cents) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function daysAgo(dateStr: string | null) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

const SHAPE_BASE = "https://secure.setshape.com/prospects/";
const LENDING_PAD_URL = "https://prod.lendingpad.com/questrock-llc/login";
const TEAMS_URL = "https://teams.microsoft.com";

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function PrePipelineDashboard({ loans }: { loans: PrePipelineLoan[] }) {
  const [expandedCat, setExpandedCat] = useState<PrePipelineCategory | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  /* ---- categorize loans ---- */
  const { byCat, byStatus } = useMemo(() => {
    const byCat = new Map<PrePipelineCategory, PrePipelineLoan[]>();
    const byStatus = new Map<string, PrePipelineLoan[]>();
    for (const l of loans) {
      const cat = categorizePrePipeline(l.status_raw);
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat)!.push(l);
      const st = l.status_raw ?? "(no status)";
      if (!byStatus.has(st)) byStatus.set(st, []);
      byStatus.get(st)!.push(l);
    }
    return { byCat, byStatus };
  }, [loans]);

  /* ---- pie data ---- */
  const pieData = useMemo(
    () =>
      PRE_PIPELINE_CATEGORIES.map((c) => ({
        name: c.label,
        value: byCat.get(c.key)?.length ?? 0,
        color: c.color,
        percent: loans.length ? (byCat.get(c.key)?.length ?? 0) / loans.length : 0,
      })),
    [byCat, loans.length],
  );

  /* ---- statuses in expanded category ---- */
  const catStatuses = useMemo(() => {
    if (!expandedCat) return [];
    const catLoans = byCat.get(expandedCat) ?? [];
    const counts = new Map<string, number>();
    for (const l of catLoans) {
      const s = l.status_raw ?? "(no status)";
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([status, count]) => ({ status, count, pct: catLoans.length ? count / catLoans.length : 0 }));
  }, [expandedCat, byCat]);

  /* ---- leads in selected status ---- */
  const panelLoans = useMemo(
    () => (selectedStatus ? byStatus.get(selectedStatus) ?? [] : []),
    [selectedStatus, byStatus],
  );

  const toggleCat = useCallback(
    (cat: PrePipelineCategory) => {
      setExpandedCat((prev) => (prev === cat ? null : cat));
      setSelectedStatus(null);
    },
    [],
  );

  const openPanel = useCallback((status: string) => {
    setSelectedStatus(status);
    setPanelOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setSelectedStatus(null);
  }, []);

  if (loans.length === 0) return null;

  return (
    <>
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div className="h-1 w-4 rounded-full" style={{ background: "#E8FF00" }} />
              <h3 className="text-sm font-semibold tracking-tight">Pre-Pipeline</h3>
            </div>
            <p className="mt-0.5 text-xs text-mutedForeground pl-6">
              Leads in Shape, not yet in the file flow. Click a category to drill down.
            </p>
          </div>
          <div className="text-2xl font-bold tabular-nums" style={{ color: "#E8FF00" }}>{loans.length}</div>
        </div>

        {/* ---- summary cards + pie chart ---- */}
        <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
          {/* category cards */}
          <div className="grid gap-3 sm:grid-cols-3">
            {PRE_PIPELINE_CATEGORIES.map((c) => {
              const count = byCat.get(c.key)?.length ?? 0;
              const pct = loans.length ? ((count / loans.length) * 100).toFixed(1) : "0";
              const active = expandedCat === c.key;
              return (
                <button
                  key={c.key}
                  onClick={() => toggleCat(c.key)}
                  className="flex flex-col justify-between rounded-xl p-4 text-left transition-all duration-200 min-h-[120px]"
                  style={
                    active
                      ? { border: "1px solid #E8FF00", background: "rgba(232,255,0,0.07)", backdropFilter: "blur(12px)" }
                      : { border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.03)", backdropFilter: "blur(12px)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" }
                  }
                >
                  {/* top row: label + arrow */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full shrink-0 mt-0.5" style={{ background: c.color }} />
                      <span className="text-[13px] font-medium text-foreground leading-tight">{c.label}</span>
                    </div>
                    <div
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors"
                      style={
                        active
                          ? { background: "#E8FF00" }
                          : { background: "hsl(220 10% 18%)" }
                      }
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        style={{ color: active ? "hsl(220 13% 7%)" : "hsl(215 14% 52%)" }}
                        fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" />
                      </svg>
                    </div>
                  </div>

                  {/* bottom row: large number + percent */}
                  <div className="mt-4">
                    <div className="flex items-baseline gap-2">
                      <span
                        className="text-3xl font-bold tabular-nums tracking-tight"
                        style={active ? { color: "#E8FF00" } : undefined}
                      >
                        {count}
                      </span>
                      <span className="text-xs text-mutedForeground">
                        {pct}% of total
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* pie chart */}
          <div className="flex items-center justify-center">
            <ClientPieChart data={pieData} width={180} height={180} innerRadius={45} outerRadius={75} />
          </div>
        </div>

        {/* ---- expanded sub-statuses ---- */}
        {expandedCat && catStatuses.length > 0 && (
          <div className="rounded-xl overflow-hidden"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" }}>
            <div className="border-b px-4 py-2.5"
              style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.07)" }}>
              <span className="text-xs font-semibold" style={{ color: "#E8FF00" }}>
                {PRE_PIPELINE_CATEGORIES.find((c) => c.key === expandedCat)?.label} — Statuses
              </span>
            </div>
            <div className="divide-y divide-border/30">
              {catStatuses.map(({ status, count, pct }) => (
                <button
                  key={status}
                  onClick={() => openPanel(status)}
                  className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted/20"
                >
                  <span className="font-medium">{status}</span>
                  <div className="flex items-center gap-3">
                    <span className="tabular-nums text-mutedForeground">{(pct * 100).toFixed(1)}%</span>
                    <span className="min-w-[2.5rem] rounded-full px-2 py-0.5 text-center text-xs font-semibold tabular-nums"
                      style={{ background: "rgba(232,255,0,0.12)", color: "#E8FF00" }}>
                      {count}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── Side Panel ────────────────────────────────────────────── */}
      <div
        className={cn(
          "fixed left-0 top-0 z-50 h-full w-full max-w-xl border-r border-border/50 shadow-2xl transition-transform duration-200 ease-out",
          panelOpen ? "translate-x-0" : "-translate-x-full",
        )}
        style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" }}
        aria-hidden={!panelOpen}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b px-4 py-3"
            style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.08)" }}>
            <h2 className="text-sm font-semibold" style={{ color: "#E8FF00" }}>{selectedStatus}</h2>
            <button type="button" onClick={closePanel} className="rounded-lg p-1.5 transition-colors hover:bg-muted/50">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {panelLoans.length === 0 ? (
              <p className="text-sm text-mutedForeground">No leads in this status.</p>
            ) : (
              <ul className="space-y-2">
                {panelLoans.map((l) => (
                  <li key={l.id} className="rounded-xl px-3 py-3 text-sm transition-all"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{borrowerName(l)}</span>
                      <span className="text-xs text-mutedForeground">{l.record_type ?? "—"}</span>
                    </div>
                    {l.shape_record_id && (
                      <div className="mt-0.5 text-[11px] text-mutedForeground">
                        ID: <span className="font-mono">{l.shape_record_id}</span>
                      </div>
                    )}
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-mutedForeground">
                      <span>{l.loan_type ?? "—"}</span>
                      <span style={{ color: "#E8FF00" }}>{fmt$(l.loan_amount_cents)}</span>
                      {l.lead_created_at && (
                        <span>{daysAgo(l.lead_created_at)}d ago</span>
                      )}
                    </div>
                    {/* quick-access buttons */}
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {l.shape_record_id && (
                        <a
                          href={`${SHAPE_BASE}${l.shape_record_id}/edit`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1 text-xs font-medium transition-all hover:border-[#E8FF00]/40 hover:text-[#E8FF00]"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-4.5-6 5.25 5.25M15 3l6 6-9 9H6v-6l9-9Z" /></svg>
                          Open in Shape
                        </a>
                      )}
                      <a
                        href={LENDING_PAD_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1 text-xs font-medium transition-all hover:border-[#E8FF00]/40 hover:text-[#E8FF00]"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
                        LendingPad
                      </a>
                      <a
                        href={TEAMS_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1 text-xs font-medium transition-all hover:border-[#E8FF00]/40 hover:text-[#E8FF00]"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.028-.68.049-1.02.062v-5.04a3.001 3.001 0 0 0-2.25-2.905V8.511ZM15 6.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm3 2a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM6.75 13.5a.75.75 0 0 0-.75.75v3a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3v-3a.75.75 0 0 0-.75-.75h-10.5Z" /></svg>
                        Teams
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* backdrop */}
      {panelOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          onClick={closePanel}
          aria-label="Close panel"
        />
      )}
    </>
  );
}
