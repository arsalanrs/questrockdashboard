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
  return (
    <section className="dash-card p-4">
      <div className="mb-3 text-[11px] uppercase tracking-wider text-mutedForeground">Auto-assignment</div>
      <h2 className="text-base font-semibold">Recent blitz queue</h2>
      <p className="mt-1 text-xs text-mutedForeground">
        Audit trail for bulk assignments (executive tooling). Status updates when each loan is processed.
      </p>
      {rows.length === 0 ? (
        <div className="mt-4 rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-mutedForeground">
          No queue rows yet. Run a blitz preview below when EXEC_AUTO_ASSIGNMENT_JSON is configured.
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-border rounded-md border border-border">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-xs">
              <div>
                <span className="font-mono text-[11px] text-mutedForeground">{r.loan_id.slice(0, 8)}…</span>
                {r.tier && (
                  <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-semibold">{r.tier}</span>
                )}
                <span className="ml-2 text-mutedForeground">{r.assignment_method ?? "—"}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={
                    r.status === "completed"
                      ? "text-emerald-600"
                      : r.status === "failed"
                        ? "text-red-500"
                        : "text-mutedForeground"
                  }
                >
                  {r.status}
                </span>
                <span className="text-mutedForeground">{fmtTime(r.created_at)}</span>
              </div>
              <div className="w-full text-[11px] text-mutedForeground">
                → {r.assignee_name ?? "—"}
                {r.error_message ? (
                  <span className="ml-2 text-red-500">({r.error_message})</span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
