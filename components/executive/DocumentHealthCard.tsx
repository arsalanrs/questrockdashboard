import type { DocumentHealthSummary } from "@/lib/documents/load-document-health";

/**
 * Executive-dashboard document completeness panel.
 * Shows overall coverage, top blocker loans, and missing-docs-by-LO leaderboard.
 */
export function DocumentHealthCard({ health }: { health: DocumentHealthSummary }) {
  const {
    loansTracked,
    totalRequired,
    totalProvided,
    completionPct,
    missingByCategory,
    topBlockers,
    missingByLO,
  } = health;

  const tone =
    completionPct >= 80
      ? "bg-green-100 text-green-800"
      : completionPct >= 50
        ? "bg-amber-100 text-amber-800"
        : "bg-red-100 text-red-800";

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-mutedForeground">
            Document Health
          </h2>
          <p className="mt-1 text-sm text-mutedForeground">
            Required docs that are missing across your pipeline. Drives which deals
            can't move forward until paperwork lands.
          </p>
        </div>
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>
          {completionPct}% complete
        </span>
      </header>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
        <Stat label="Loans tracked" value={loansTracked.toLocaleString()} />
        <Stat label="Required docs" value={totalRequired.toLocaleString()} />
        <Stat label="Provided" value={totalProvided.toLocaleString()} tone="positive" />
        <Stat
          label="Missing"
          value={(totalRequired - totalProvided).toLocaleString()}
          tone="danger"
        />
      </dl>

      {topBlockers.length > 0 ? (
        <div className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">
            Top blocker loans
          </h3>
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-background">
            {topBlockers.slice(0, 8).map((b) => (
              <li key={b.loanId} className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{b.borrower}</p>
                  <p className="mt-0.5 text-xs text-mutedForeground">
                    {[b.lo ?? "Unassigned", b.stage ?? "no stage", b.loanType, b.loanPurpose]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <p className="mt-1.5 text-xs text-mutedForeground">
                    Missing: {b.missingDocs.join(", ")}
                    {b.missingCount > b.missingDocs.length
                      ? ` +${b.missingCount - b.missingDocs.length} more`
                      : ""}
                  </p>
                </div>
                <span className="inline-flex shrink-0 items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800 tabular-nums">
                  {b.missingCount}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-4 text-xs text-mutedForeground">
          No document data yet — run a LendingPad sync with{" "}
          <code className="rounded bg-muted px-1 py-0.5">LENDINGPAD_FETCH_LOAN_DETAIL=1</code> so
          document metadata is collected alongside loan details.
        </p>
      )}

      <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
        {missingByCategory.length > 0 ? (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">
              Missing by category
            </h3>
            <ul className="mt-2 space-y-1.5 text-sm">
              {missingByCategory.map((c) => (
                <li key={c.category} className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm">{c.category}</span>
                  <span className="tabular-nums text-mutedForeground">{c.count}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {missingByLO.length > 0 ? (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">
              Missing-docs by LO
            </h3>
            <ul className="mt-2 space-y-1.5 text-sm">
              {missingByLO.map((l) => (
                <li key={l.lo} className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm">{l.lo}</span>
                  <span className="tabular-nums text-mutedForeground">
                    {l.missingCount} across {l.loansAffected} loan
                    {l.loansAffected === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
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
  tone?: "positive" | "danger";
}) {
  const valueClass =
    tone === "positive"
      ? "text-green-700"
      : tone === "danger"
        ? "text-red-700"
        : "text-foreground";
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-mutedForeground">{label}</dt>
      <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${valueClass}`}>{value}</dd>
    </div>
  );
}
