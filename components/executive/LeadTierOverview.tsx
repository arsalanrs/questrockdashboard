"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";

export type TierBreakdownRow = {
  tier: string | null;
  count: number;
  volumeCents: number;
};

type TierKey = "RED" | "ORANGE" | "GREEN" | "UNSET";

type LoanRow = {
  id: string;
  borrower: string | null;
  current_stage: string | null;
  status_raw: string | null;
  loan_amount_cents: number | null;
  shape_record_id: number | null;
  lead_tier: string | null;
  assigned_loan_officer_name: string | null;
  unsetReason?: string;
};

const SHAPE_BASE =
  process.env.NEXT_PUBLIC_SHAPE_LEAD_BASE_URL?.trim() || "https://secure.setshape.com/prospects/";

function fmt$(cents: number | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

const TONE: Record<string, string> = {
  RED: "border-rose-500/35 bg-rose-500/5 hover:border-rose-500/60",
  ORANGE: "border-amber-500/35 bg-amber-500/5 hover:border-amber-500/60",
  GREEN: "border-emerald-500/35 bg-emerald-500/5 hover:border-emerald-500/60",
  UNSET: "border-slate-500/35 bg-slate-500/5 hover:border-slate-500/60 border-dashed",
};

function normalizeCards(stats: TierBreakdownRow[]): { key: TierKey; label: string; row: TierBreakdownRow }[] {
  const byTier = new Map<string | null, TierBreakdownRow>();
  for (const s of stats) {
    byTier.set(s.tier ?? null, s);
  }
  const base = (tier: string | null, key: TierKey, label: string) => ({
    key,
    label,
    row: byTier.get(tier) ?? { tier, count: 0, volumeCents: 0 },
  });
  return [
    base("RED", "RED", "RED"),
    base("ORANGE", "ORANGE", "ORANGE"),
    base("GREEN", "GREEN", "GREEN"),
    base(null, "UNSET", "Unset / null"),
  ];
}

export function LeadTierOverview({ stats }: { stats: TierBreakdownRow[] }) {
  const router = useRouter();
  const cards = useMemo(() => normalizeCards(stats), [stats]);
  const [panel, setPanel] = useState<{ tier: TierKey; title: string } | null>(null);
  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [recomputeMsg, setRecomputeMsg] = useState<string | null>(null);
  const [recomputeErr, setRecomputeErr] = useState<string | null>(null);

  async function recomputeSignalsAndTiers() {
    setRecomputing(true);
    setRecomputeErr(null);
    setRecomputeMsg(null);
    try {
      const res = await fetch("/api/signals/run", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      const loansScanned = (body as { loansScanned?: number }).loansScanned;
      const leadTiers = (body as { leadTiers?: { scanned: number; updated: number } }).leadTiers;
      const signalsWritten = (body as { signalsWritten?: number }).signalsWritten;
      const signalsDismissed = (body as { signalsDismissed?: number }).signalsDismissed;
      const parts: string[] = [];
      if (typeof loansScanned === "number") parts.push(`${loansScanned} loans scanned`);
      if (typeof signalsWritten === "number") parts.push(`${signalsWritten} signals upserted`);
      if (typeof signalsDismissed === "number" && signalsDismissed > 0) {
        parts.push(`${signalsDismissed} cleared`);
      }
      if (leadTiers) parts.push(`tiers ${leadTiers.updated}/${leadTiers.scanned} rows updated`);
      setRecomputeMsg(parts.length > 0 ? parts.join(" · ") : "Done.");
      router.refresh();
    } catch (e) {
      setRecomputeErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRecomputing(false);
    }
  }

  async function openTier(tier: TierKey, title: string) {
    setPanel({ tier, title });
    setLoading(true);
    setErr(null);
    setLoans([]);
    setTruncated(false);
    try {
      const res = await fetch(`/api/executive/lead-tier-loans?tier=${tier}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setLoans(body.loans ?? []);
      setTruncated(!!body.truncated);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function closePanel() {
    setPanel(null);
    setLoans([]);
    setErr(null);
    setTruncated(false);
  }

  return (
    <>
      <section className="dash-card p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div className="lo-accent-text text-[11px] font-semibold uppercase tracking-[0.14em]">Lead tier</div>
          <button
            type="button"
            onClick={() => void recomputeSignalsAndTiers()}
            disabled={recomputing}
            className="rounded-md border border-border bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {recomputing ? "Recomputing…" : "Recompute buckets & signals"}
          </button>
        </div>
        <h2 className="lo-heading text-base font-semibold">RED / ORANGE / GREEN snapshot</h2>
        <p className="lo-muted mt-1 text-xs">
          Tiers are rule-based (pipeline stage, status, funded/closed) — same logic as deal-signal detectors and book
          cadence policy. The page also refreshes tiers on load. Use{" "}
          <strong>Recompute buckets &amp; signals</strong> after you change rules so RED/ORANGE/GREEN and opportunity
          signals match the latest config without waiting for cron.
        </p>
        {recomputeMsg && (
          <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">{recomputeMsg}</p>
        )}
        {recomputeErr && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{recomputeErr}</p>
        )}
        <p className="lo-muted mt-2 text-xs">
          Click a box below to see loans in that bucket. <strong>Unset</strong> shows why each row has no tier (inactive /
          dispositions, or not persisted yet).
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map(({ key, label, row }) => (
            <button
              key={key}
              type="button"
              onClick={() => void openTier(key, label)}
              className={cn(
                "rounded-md border px-3 py-3 text-left transition-colors",
                TONE[key] ?? "border-border",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <div className="text-xs font-medium text-mutedForeground">{label}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{row.count}</div>
              <div className="mt-0.5 text-[11px] text-mutedForeground tabular-nums">
                {fmt$(row.volumeCents)} volume
              </div>
              <div className="mt-2 text-[10px] font-medium text-mutedForeground">View loans →</div>
            </button>
          ))}
        </div>
      </section>

      {panel && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-end bg-black/40"
          onClick={closePanel}
          role="presentation"
        >
          <div
            className="flex h-full w-full max-w-lg flex-col overflow-hidden border-l border-border bg-background shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="lead-tier-panel-title"
          >
            <header className="flex items-start justify-between border-b border-border p-4">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-mutedForeground">Lead tier drill-down</div>
                <h3 id="lead-tier-panel-title" className="mt-1 text-lg font-semibold">
                  {panel.title}
                </h3>
                {panel.tier === "UNSET" && (
                  <p className="lo-muted mt-2 text-xs">
                    Reasons are computed from flags and status (not AI). “Should be X after refresh” means the loan
                    qualifies for RED/ORANGE/GREEN but <code className="rounded bg-muted px-1">lead_tier</code> wasn’t
                    saved yet.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={closePanel}
                className="rounded-md p-1 text-mutedForeground hover:bg-muted hover:text-foreground"
                aria-label="Close"
              >
                ✕
              </button>
            </header>

            <div className="flex-1 overflow-y-auto p-4">
              {loading && <div className="text-sm text-mutedForeground">Loading loans…</div>}
              {err && (
                <div className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600">{err}</div>
              )}
              {!loading && !err && truncated && (
                <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700">
                  Showing first 500 loans only — narrow with filters elsewhere if needed.
                </div>
              )}
              {!loading && !err && loans.length === 0 && (
                <div className="text-sm text-mutedForeground">No loans in this bucket.</div>
              )}
              <ul className="space-y-2">
                {loans.map((loan) => {
                  const shapeHref = loan.shape_record_id ? `${SHAPE_BASE}${loan.shape_record_id}/edit` : null;
                  return (
                    <li
                      key={loan.id}
                      className="rounded-md border border-border px-3 py-2 text-sm"
                    >
                      <div className="font-medium">{loan.borrower ?? "Borrower —"}</div>
                      <div className="mt-0.5 text-xs text-mutedForeground">
                        {loan.assigned_loan_officer_name ?? "Unassigned"} · {fmt$(loan.loan_amount_cents)}
                      </div>
                      <div className="mt-1 text-[11px] text-mutedForeground">
                        Stage: {loan.current_stage ?? "—"} · Status: {loan.status_raw ?? "—"}
                      </div>
                      {loan.unsetReason && (
                        <div className="mt-2 rounded bg-muted/50 px-2 py-1.5 text-[11px] leading-snug text-foreground">
                          <span className="font-semibold text-mutedForeground">Why unset: </span>
                          {loan.unsetReason}
                        </div>
                      )}
                      {shapeHref && (
                        <a
                          href={shapeHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-block text-[11px] text-mutedForeground underline hover:text-foreground"
                        >
                          Open in Shape ↗
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
