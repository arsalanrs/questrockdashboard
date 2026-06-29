import type { MlReadiness } from "@/lib/signals/load-ml-readiness";

/**
 * Phase-5 progress card. We can't train a ranker until we have ~6 months of
 * labeled outcomes — this card shows execs how close we are.
 */
export function MlReadinessCard({ readiness }: { readiness: MlReadiness }) {
  const {
    totalOutcomes,
    closedCount,
    dismissedCount,
    staleCount,
    daysOfData,
    progressPct,
    trainingReady,
    byType,
  } = readiness;

  const topTypes = [...byType].sort((a, b) => b.total - a.total).slice(0, 5);

  return (
    <section className="dash-card p-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold tracking-wide text-mutedForeground uppercase">
            Deal-Signal Learning
          </h2>
          <p className="mt-1 text-sm text-mutedForeground">
            The AI ranker trains itself on closed vs. dismissed signals. We launch the
            learned ranker once we have 6 months of labels.
          </p>
        </div>
        <span
          className={
            "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium " +
            (trainingReady
              ? "bg-green-100 text-green-800"
              : "bg-amber-100 text-amber-800")
          }
        >
          {trainingReady ? "Training ready" : "Collecting"}
        </span>
      </header>

      <div className="mt-4">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-mutedForeground">Training window</span>
          <span className="font-medium">
            {daysOfData} / 180 days ({progressPct}%)
          </span>
        </div>
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary"
            style={{ width: `${Math.min(100, progressPct)}%` }}
          />
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
        <Stat label="Total labels" value={totalOutcomes.toLocaleString()} />
        <Stat label="Closed" value={closedCount.toLocaleString()} tone="positive" />
        <Stat label="Dismissed" value={dismissedCount.toLocaleString()} />
        <Stat label="Stale" value={staleCount.toLocaleString()} tone="muted" />
      </dl>

      {topTypes.length > 0 ? (
        <div className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">
            Close rate by signal type
          </h3>
          <ul className="mt-2 space-y-1.5 text-sm">
            {topTypes.map((t) => (
              <li key={t.signal_type} className="flex items-center justify-between gap-3">
                <span className="truncate font-mono text-xs text-mutedForeground">
                  {t.signal_type}
                </span>
                <span className="tabular-nums">
                  {t.closed}/{t.total}
                  {t.closeRatePct != null ? (
                    <span className="ml-2 text-mutedForeground">({t.closeRatePct}%)</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-4 text-xs text-mutedForeground">
          No labeled outcomes yet. The nightly labeler will start populating data as
          signals close, get dismissed, or age past the 45-day window.
        </p>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "positive" | "muted";
}) {
  const valueClass =
    tone === "positive"
      ? "text-green-700"
      : tone === "muted"
        ? "text-mutedForeground"
        : "text-foreground";
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-mutedForeground">{label}</dt>
      <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${valueClass}`}>{value}</dd>
    </div>
  );
}
