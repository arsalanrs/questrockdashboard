function fmtTime(iso: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export type AssignmentQueueRow = {
  id: string;
  loan_id: string;
  tier: string | null;
  status: string;
  assignment_method: string | null;
  created_at: string;
  assignee_name: string | null;
  error_message: string | null;
};

export function AssignmentQueuePanel({ rows }: { rows: AssignmentQueueRow[] }) {
  function relativeAgo(iso: string) {
    const ms = Date.now() - new Date(iso).getTime();
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return fmtTime(iso);
  }

  return (
    <section className="exec-section" style={{ marginBottom: 0 }}>
      <div className="exec-section-head">
        <h2 className="exec-section-title">
          <span className="icon" aria-hidden>↺</span>
          Assignment Queue
        </h2>
        <span className="exec-section-meta">Last 24h</span>
      </div>
      <div className="exec-section-body" style={{ paddingTop: 6 }}>
        {rows.length === 0 ? (
          <div className="lo-muted py-6 text-center text-xs">
            No queue rows yet. Run a blitz preview when EXEC_AUTO_ASSIGNMENT_JSON is configured.
          </div>
        ) : (
          rows.slice(0, 8).map((r) => (
            <div key={r.id} className="exec-audit-row">
              <div className="exec-audit-icon" aria-hidden>✓</div>
              <div className="audit-text flex-1 text-[var(--ink-700)]">
                <b>{r.status}</b>
                {r.tier && <> · {r.tier}</>}
                {r.assignee_name && <> → {r.assignee_name}</>}
                {r.error_message && (
                  <span style={{ color: "var(--color-red)" }}> ({r.error_message})</span>
                )}
              </div>
              <span className="audit-time">{relativeAgo(r.created_at)}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
