"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { SIGNAL_LABEL, type SignalCategory, type SignalType } from "@/lib/signals/types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type CachedPlaybook = {
  headline: string;
  callScript: string;
  email: { subject: string; body: string };
  nextSteps: string[];
  source: "template" | "llm";
  generatedAt: string;
};

export type PanelSignal = {
  id: string;
  loanId: string;
  signalType: SignalType;
  category: SignalCategory;
  priority: number;
  reason: string;
  loUserId: string | null;
  loName: string | null;
  meta: Record<string, unknown>;
  borrowerName: string | null;
  loanAmountCents: number | null;
  shapeRecordId: number | null;
  computedAt: string | null;
  /** Persisted `deal_signals.playbook_json` — shown after refresh without regenerating. */
  cachedPlaybook: CachedPlaybook | null;
};

export type LoRollup = {
  loUserId: string | null;
  loName: string;
  total: number;
  hot: number;
  byType: Record<string, number>;
};

type Props = {
  signals: PanelSignal[];
  loRollups: LoRollup[];
  lastRunAt: string | null;
};

/** Funded-book cadence & retention (distinct from general funnel hygiene in the same category). */
const BOOK_CADENCE_SIGNAL_TYPES = new Set<SignalType>([
  "book_checkin_6m",
  "book_checkin_12m",
  "post_close_skip_payment_due",
  "first_payment_touch",
  "fha_seasoning_prep",
  "arm_book_checkin_due",
  "closing_8month_due",
  "epo_window_opening",
]);

const SHAPE_BASE =
  process.env.NEXT_PUBLIC_SHAPE_LEAD_BASE_URL?.trim() || "https://secure.setshape.com/prospects/";

function fmt$(cents: number | null) {
  if (!cents) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

function formatRelative(iso: string | null) {
  if (!iso) return "never";
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

/* ------------------------------------------------------------------ */
/*  Card subcomponents                                                 */
/* ------------------------------------------------------------------ */

function DotBadge({ tone }: { tone: "red" | "orange" | "green" | "violet" | "blue" }) {
  const map = {
    red: "bg-red-500",
    orange: "bg-amber-500",
    green: "bg-emerald-500",
    violet: "bg-violet-500",
    blue: "bg-blue-500",
  };
  return <span className={cn("inline-block h-2 w-2 rounded-full", map[tone])} />;
}

function SignalRow({
  s,
  tone,
  onSelect,
}: {
  s: PanelSignal;
  tone: "red" | "orange" | "green" | "violet" | "blue";
  onSelect: (s: PanelSignal) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(s)}
      className="flex w-full items-start gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/50"
    >
      <span className="mt-1.5">
        <DotBadge tone={tone} />
      </span>
      <span className="flex-1">
        <span className="flex items-center gap-2 text-sm font-medium">
          {SIGNAL_LABEL[s.signalType] ?? s.signalType}
          {s.priority >= 4 && (
            <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-500">
              hot
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-xs text-mutedForeground">
          {s.borrowerName ?? "Borrower —"} · {s.loName ?? "Unassigned"} · {fmt$(s.loanAmountCents)}
          <br />
          <span className="text-[11px]">{s.reason}</span>
        </span>
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Detail drawer                                                      */
/* ------------------------------------------------------------------ */

type Playbook = CachedPlaybook;

function DetailDrawer({
  signal,
  onClose,
}: {
  signal: PanelSignal | null;
  onClose: () => void;
}) {
  const [playbook, setPlaybook] = useState<Playbook | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [polishing, setPolishing] = useState(false);

  useEffect(() => {
    if (!signal) return;
    let cancelled = false;
    setError(null);

    if (signal.cachedPlaybook) {
      setPlaybook(signal.cachedPlaybook);
      return;
    }

    setPlaybook(null);
    (async () => {
      try {
        const res = await fetch(`/api/signals/${signal.id}/playbook?peek=1`, { method: "GET" });
        const body = await res.json();
        if (cancelled || !res.ok) return;
        if (body.playbook) setPlaybook(body.playbook as Playbook);
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [signal?.id, signal?.cachedPlaybook]);

  if (!signal) return null;
  const shapeHref = signal.shapeRecordId ? `${SHAPE_BASE}${signal.shapeRecordId}/edit` : null;

  async function loadPlaybook(opts: { polish?: boolean; force?: boolean } = {}) {
    if (!signal) return;
    const qs = new URLSearchParams();
    if (opts.polish) qs.set("polish", "1");
    if (opts.force) qs.set("force", "1");
    if (opts.polish) setPolishing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/signals/${signal.id}/playbook?${qs.toString()}`, { method: "GET" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setPlaybook(body.playbook as Playbook);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setPolishing(false);
    }
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-end bg-black/40"
      onClick={onClose}
      role="dialog"
    >
      <div
        className="flex h-full w-full max-w-md flex-col overflow-hidden border-l border-border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between border-b border-border p-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-mutedForeground">
              {signal.category} · priority {signal.priority}
            </div>
            <h3 className="mt-1 text-lg font-semibold">
              {SIGNAL_LABEL[signal.signalType] ?? signal.signalType}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-mutedForeground hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            ✕
          </button>
        </header>
        <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
          <div className="rounded-md border border-border p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-medium text-foreground">
                Playbook
                {playbook && (
                  <span className="ml-2 font-normal text-mutedForeground">· saved — refresh-safe</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!playbook && !loading && (
                  <button
                    type="button"
                    onClick={() => loadPlaybook()}
                    className="rounded-md border border-border bg-primary px-2 py-1.5 text-[11px] font-medium text-primary-foreground hover:opacity-90"
                  >
                    Generate &amp; save
                  </button>
                )}
                {playbook && (
                  <>
                    <button
                      type="button"
                      onClick={() => loadPlaybook({ force: true })}
                      className="rounded-md border border-border px-2 py-1.5 text-[11px] hover:bg-muted"
                      disabled={loading}
                    >
                      {loading ? "…" : "Regenerate &amp; save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => loadPlaybook({ polish: true, force: true })}
                      className="rounded-md border border-border px-2 py-1.5 text-[11px] hover:bg-muted"
                      disabled={polishing}
                    >
                      {polishing ? "AI polish…" : "AI polish &amp; save"}
                    </button>
                  </>
                )}
              </div>
            </div>
            {!playbook && !loading && (
              <p className="mb-2 text-[11px] text-mutedForeground">
                Creates a call script + email and stores it on this signal. After that, reload the page — you won&apos;t need to generate again unless you choose Regenerate.
              </p>
            )}

            {loading && !playbook && (
              <div className="text-xs text-mutedForeground">Generating playbook…</div>
            )}
            {error && (
              <div className="rounded bg-red-500/10 px-2 py-1 text-[11px] text-red-500">{error}</div>
            )}

            {playbook && (
              <div className="space-y-3 text-xs">
                <div className="font-medium text-foreground">{playbook.headline}</div>

                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <div className="text-[11px] uppercase tracking-wide text-mutedForeground">
                      Call script · {playbook.source === "llm" ? "AI-polished" : "template"}
                    </div>
                    <button
                      type="button"
                      className="text-[11px] text-mutedForeground hover:text-foreground"
                      onClick={() => copyText(playbook.callScript)}
                    >
                      Copy
                    </button>
                  </div>
                  <pre className="whitespace-pre-wrap rounded bg-muted/40 p-2 text-[11px] leading-snug">
                    {playbook.callScript}
                  </pre>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <div className="text-[11px] uppercase tracking-wide text-mutedForeground">
                      Re-engagement email
                    </div>
                    <button
                      type="button"
                      className="text-[11px] text-mutedForeground hover:text-foreground"
                      onClick={() =>
                        copyText(`Subject: ${playbook.email.subject}\n\n${playbook.email.body}`)
                      }
                    >
                      Copy
                    </button>
                  </div>
                  <div className="rounded bg-muted/40 p-2 text-[11px]">
                    <div className="font-medium">Subject: {playbook.email.subject}</div>
                    <pre className="mt-1 whitespace-pre-wrap leading-snug">{playbook.email.body}</pre>
                  </div>
                </div>

                {playbook.nextSteps?.length > 0 && (
                  <div>
                    <div className="mb-1 text-[11px] uppercase tracking-wide text-mutedForeground">
                      Next steps
                    </div>
                    <ul className="list-disc space-y-1 pl-4">
                      {playbook.nextSteps.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <div className="text-xs font-medium text-mutedForeground">Borrower</div>
            <div className="font-medium">{signal.borrowerName ?? "—"}</div>
          </div>
          <div>
            <div className="text-xs font-medium text-mutedForeground">Assigned LO</div>
            <div>{signal.loName ?? "Unassigned"}</div>
          </div>
          <div>
            <div className="text-xs font-medium text-mutedForeground">Loan amount</div>
            <div className="tabular-nums">{fmt$(signal.loanAmountCents)}</div>
          </div>
          <div>
            <div className="text-xs font-medium text-mutedForeground">Reason</div>
            <div>{signal.reason}</div>
          </div>
          {Object.keys(signal.meta ?? {}).length > 0 && (
            <div>
              <div className="text-xs font-medium text-mutedForeground">Meta</div>
              <pre className="rounded bg-muted/40 p-2 text-[11px] leading-snug">
                {JSON.stringify(signal.meta, null, 2)}
              </pre>
            </div>
          )}
          {shapeHref && (
            <a
              href={shapeHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
            >
              Open in Shape ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function OpportunitiesPanel({ signals, loRollups, lastRunAt }: Props) {
  const [selected, setSelected] = useState<PanelSignal | null>(null);
  const [filterLo, setFilterLo] = useState<string>("");

  const filtered = useMemo(() => {
    if (!filterLo) return signals;
    return signals.filter((s) => (s.loName ?? "Unassigned") === filterLo);
  }, [signals, filterLo]);

  const byCategory = useMemo(() => {
    const stall: PanelSignal[] = [];
    const refi: PanelSignal[] = [];
    const life: PanelSignal[] = [];
    const leadTier: PanelSignal[] = [];
    const bookCadence: PanelSignal[] = [];
    const funnelLeadTier: PanelSignal[] = [];
    for (const s of filtered) {
      if (s.category === "stall") stall.push(s);
      else if (s.category === "refi") refi.push(s);
      else if (s.category === "lead_tier") {
        leadTier.push(s);
        if (BOOK_CADENCE_SIGNAL_TYPES.has(s.signalType)) bookCadence.push(s);
        else funnelLeadTier.push(s);
      } else life.push(s);
    }
    return { stall, refi, life, leadTier, bookCadence, funnelLeadTier };
  }, [filtered]);

  const loNames = useMemo(() => loRollups.map((l) => l.loName), [loRollups]);

  return (
    <section className="exec-section" style={{ marginBottom: 0 }}>
      <div className="exec-section-head">
        <h2 className="exec-section-title">
          <span className="icon" aria-hidden>💡</span>
          Opportunities
        </h2>
        <span className="exec-pill-ai">✦ AI Signals</span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-3">
        <p className="lo-muted text-xs">
          {signals.length} active signal{signals.length === 1 ? "" : "s"} · last run {formatRelative(lastRunAt)}
        </p>
        <select
          value={filterLo}
          onChange={(e) => setFilterLo(e.target.value)}
          className="exec-select-pill text-xs"
        >
          <option value="">All LOs</option>
          {loNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      <div className="exec-opp-list" style={{ paddingTop: 12 }}>
        {filtered.slice(0, 5).map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSelected(s)}
            className="exec-opp-card w-full text-left"
          >
            <div className="exec-opp-score">
              <span className="n">{s.priority * 20 + 14}</span>
              <span className="l">Score</span>
            </div>
            <div className="exec-opp-body">
              <p className="exec-opp-title">
                {s.borrowerName ?? "Borrower"} — {SIGNAL_LABEL[s.signalType] ?? s.signalType}
              </p>
              <span className="exec-opp-sub">{s.reason}</span>
            </div>
            <span className="exec-opp-tag">{s.category}</span>
            <span className="text-xs font-semibold" style={{ color: "var(--green-700)" }}>
              Open ↗
            </span>
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="lo-muted py-6 text-center text-sm">No opportunities match the current filter.</p>
        )}
      </div>

      <div className="space-y-4 border-t border-[var(--border-soft)] p-4">
        {/* Stalled pipeline — easiest wins */}
        <div className="rounded-lg border border-orange-500/30 bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded-full bg-orange-500/10 px-2 py-0.5 text-[11px] font-semibold text-orange-500">
              Stalled pipeline
            </span>
          </div>
          <h3 className="text-base font-semibold">Easiest wins — stuck deals</h3>
          <ul className="mt-3 space-y-1 divide-y divide-border">
            {byCategory.stall.length === 0 && (
              <li className="px-2 py-3 text-xs text-mutedForeground">No stalled deals detected.</li>
            )}
            {byCategory.stall.slice(0, 8).map((s) => (
              <li key={s.id}>
                <SignalRow
                  s={s}
                  tone={s.priority >= 4 ? "red" : "orange"}
                  onSelect={setSelected}
                />
              </li>
            ))}
          </ul>
        </div>

        {/* LO performance intelligence */}
        <div className="rounded-lg border border-blue-500/30 bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[11px] font-semibold text-blue-500">
              LO performance intelligence
            </span>
          </div>
          <h3 className="text-base font-semibold">Per-LO deal scoring</h3>
          <div className="mt-3 space-y-2">
            {loRollups.length === 0 && (
              <div className="text-xs text-mutedForeground">No per-LO signals yet.</div>
            )}
            {loRollups.slice(0, 6).map((lo) => (
              <div
                key={lo.loUserId ?? lo.loName}
                className="rounded-md border border-border px-3 py-2"
              >
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">{lo.loName}</div>
                  <button
                    type="button"
                    onClick={() => setFilterLo(lo.loName)}
                    className="text-xs text-mutedForeground hover:text-foreground"
                  >
                    Focus ↗
                  </button>
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                  <span className="rounded bg-muted px-1.5 py-0.5">
                    {lo.total} signal{lo.total === 1 ? "" : "s"}
                  </span>
                  {lo.hot > 0 && (
                    <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-red-500">
                      {lo.hot} hot
                    </span>
                  )}
                  {Object.entries(lo.byType).slice(0, 3).map(([t, n]) => (
                    <span key={t} className="rounded bg-muted px-1.5 py-0.5">
                      {n} {SIGNAL_LABEL[t as SignalType] ?? t}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Refinance radar */}
        <RefiRadarCard
          signals={byCategory.refi}
          onSelect={setSelected}
          onFocusLo={(name) => setFilterLo(name)}
        />

        {/* Lead tier & retention */}
        <div className="rounded-lg border border-rose-500/30 bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-semibold text-rose-500">
              Lead tier &amp; retention
            </span>
          </div>
          <h3 className="text-base font-semibold">Funnel, pipeline hygiene, book cadence</h3>
          <div className="mt-3 space-y-4">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-mutedForeground">
                Book cadence &amp; funded-book outreach
              </div>
              <ul className="mt-1 space-y-1 divide-y divide-border">
                {byCategory.bookCadence.length === 0 && (
                  <li className="px-2 py-2 text-xs text-mutedForeground">No book cadence signals right now.</li>
                )}
                {byCategory.bookCadence.slice(0, 6).map((s) => (
                  <li key={s.id}>
                    <SignalRow
                      s={s}
                      tone={s.priority >= 4 ? "red" : "orange"}
                      onSelect={setSelected}
                    />
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-mutedForeground">
                Funnel &amp; pipeline hygiene
              </div>
              <ul className="mt-1 space-y-1 divide-y divide-border">
                {byCategory.leadTier.length === 0 && (
                  <li className="px-2 py-3 text-xs text-mutedForeground">
                    No active lead-tier signals — run the nightly job or widen pipeline volume.
                  </li>
                )}
                {byCategory.leadTier.length > 0 && byCategory.funnelLeadTier.length === 0 && (
                  <li className="px-2 py-2 text-xs text-mutedForeground">No funnel-only signals (book cadence above).</li>
                )}
                {byCategory.funnelLeadTier.slice(0, 6).map((s) => (
                  <li key={s.id}>
                    <SignalRow
                      s={s}
                      tone={s.priority >= 4 ? "red" : "orange"}
                      onSelect={setSelected}
                    />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Life-event signals */}
        <div className="rounded-lg border border-violet-500/30 bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] font-semibold text-violet-500">
              New opportunity signals
            </span>
          </div>
          <h3 className="text-base font-semibold">Life event &amp; market triggers</h3>
          <ul className="mt-3 space-y-1 divide-y divide-border">
            {byCategory.life.length === 0 && (
              <li className="px-2 py-3 text-xs text-mutedForeground">
                Credit-rescore + property-listing triggers arrive in later phases.
              </li>
            )}
            {byCategory.life.slice(0, 6).map((s) => (
              <li key={s.id}>
                <SignalRow s={s} tone="violet" onSelect={setSelected} />
              </li>
            ))}
          </ul>
        </div>
      </div>

      <DetailDrawer signal={selected} onClose={() => setSelected(null)} />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Refinance Radar card                                               */
/* ------------------------------------------------------------------ */

const REFI_SUBTYPES: Array<{ key: SignalType; label: string; short: string }> = [
  { key: "rate_above_market", label: "Rate above market", short: "Rate" },
  { key: "cash_out_candidate", label: "Cash-out candidate", short: "Cash-out" },
  { key: "fha_to_conventional", label: "FHA → Conventional", short: "FHA→Conv" },
  { key: "va_irrrl", label: "VA IRRRL eligible", short: "VA IRRRL" },
  { key: "arm_reset_window", label: "ARM reset window", short: "ARM" },
];

function RefiRadarCard({
  signals,
  onSelect,
  onFocusLo,
}: {
  signals: PanelSignal[];
  onSelect: (s: PanelSignal) => void;
  onFocusLo: (loName: string) => void;
}) {
  const byType = useMemo(() => {
    const out = new Map<SignalType, PanelSignal[]>();
    for (const s of signals) {
      const bucket = out.get(s.signalType) ?? [];
      bucket.push(s);
      out.set(s.signalType, bucket);
    }
    return out;
  }, [signals]);

  const byLo = useMemo(() => {
    const out = new Map<string, { loName: string; count: number; volume: number; hot: number }>();
    for (const s of signals) {
      const key = s.loName ?? "Unassigned";
      const existing = out.get(key) ?? { loName: key, count: 0, volume: 0, hot: 0 };
      existing.count += 1;
      existing.volume += s.loanAmountCents ?? 0;
      if (s.priority >= 4) existing.hot += 1;
      out.set(key, existing);
    }
    return [...out.values()].sort((a, b) => b.count - a.count);
  }, [signals]);

  const totalVolume = signals.reduce((acc, s) => acc + (s.loanAmountCents ?? 0), 0);
  const hotCount = signals.filter((s) => s.priority >= 4).length;

  return (
    <div className="rounded-lg border border-emerald-500/30 bg-card p-4 lg:col-span-2">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-500">
          Refinance radar
        </span>
        <div className="text-xs text-mutedForeground">
          {signals.length} signal{signals.length === 1 ? "" : "s"} · {hotCount} hot ·{" "}
          <span className="tabular-nums">{fmt$(totalVolume)}</span> book value
        </div>
      </div>

      <h3 className="text-base font-semibold">Rate, equity &amp; loan-structure triggers</h3>

      {signals.length === 0 ? (
        <div className="mt-3 rounded-md border border-dashed border-border px-3 py-4 text-xs text-mutedForeground">
          No refi signals yet — populate market_rates and make sure note rates / LTV / ARM
          reset dates are flowing from LendingPad or the Insellerate import.
        </div>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {REFI_SUBTYPES.map((t) => {
              const bucket = byType.get(t.key) ?? [];
              if (bucket.length === 0) return null;
              return (
                <span
                  key={t.key}
                  className="rounded bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-500"
                  title={t.label}
                >
                  {bucket.length} {t.short}
                </span>
              );
            })}
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <div className="mb-1.5 text-[11px] uppercase tracking-wide text-mutedForeground">
                Top signals
              </div>
              <ul className="space-y-1 divide-y divide-border">
                {signals.slice(0, 8).map((s) => (
                  <li key={s.id}>
                    <SignalRow s={s} tone="green" onSelect={onSelect} />
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="mb-1.5 text-[11px] uppercase tracking-wide text-mutedForeground">
                Per-LO split
              </div>
              <div className="space-y-1.5">
                {byLo.slice(0, 6).map((lo) => (
                  <button
                    key={lo.loName}
                    type="button"
                    onClick={() => onFocusLo(lo.loName)}
                    className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-left hover:bg-muted/50"
                  >
                    <div>
                      <div className="text-sm font-medium">{lo.loName}</div>
                      <div className="text-[11px] text-mutedForeground tabular-nums">
                        {fmt$(lo.volume)} potential volume
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <span className="rounded bg-muted px-1.5 py-0.5">{lo.count}</span>
                      {lo.hot > 0 && (
                        <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-red-500">
                          {lo.hot} hot
                        </span>
                      )}
                      <span className="text-mutedForeground">Focus ↗</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
