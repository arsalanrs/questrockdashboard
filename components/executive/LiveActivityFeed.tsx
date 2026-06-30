"use client";

import { useMemo, useState } from "react";
import { shapeLeadUrl } from "@/lib/shape-link";

export type ActivityLogRow = {
  id: string;
  synced_at: string;
  change_type: string;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  lo_name: string | null;
  borrower_name: string | null;
  shape_record_id?: number | null;
};

function dotColor(type: string): string {
  if (type === "loan_created" || type === "status_changed") return "var(--color-green)";
  if (type === "note_added" || type === "field_changed") return "#2e6190";
  if (type === "owner_changed") return "var(--gold-600)";
  return "var(--color-red)";
}

function feedSummary(row: ActivityLogRow): React.ReactNode {
  const lo = row.lo_name ?? "Someone";
  const borrower = row.borrower_name ?? "a lead";
  if (row.change_type === "status_changed") {
    return (
      <>
        <b>{lo}</b> moved {borrower} to <b>{row.new_value ?? "new status"}</b>
      </>
    );
  }
  if (row.change_type === "note_added") {
    return (
      <>
        <b>{lo}</b> added note on {borrower}
      </>
    );
  }
  if (row.change_type === "loan_created") {
    return (
      <>
        <b>{lo}</b> received new lead {borrower}
      </>
    );
  }
  if (row.change_type === "owner_changed") {
    return (
      <>
        <b>{borrower}</b> reassigned to <b>{row.new_value ?? "—"}</b>
      </>
    );
  }
  return (
    <>
      <b>{lo}</b> updated {borrower}
    </>
  );
}

function relativeMins(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

export function LiveActivityFeed({ rows }: { rows: ActivityLogRow[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        (r.borrower_name ?? "").toLowerCase().includes(q) ||
        (r.lo_name ?? "").toLowerCase().includes(q) ||
        (r.change_type ?? "").toLowerCase().includes(q),
    );
  }, [rows, query]);

  return (
    <section className="exec-section" style={{ marginBottom: 0 }}>
      <div className="exec-section-head">
        <h2 className="exec-section-title">
          <span className="icon" aria-hidden>〰</span>
          Live Activity
        </h2>
        <span className="exec-section-meta">Shape field changes</span>
      </div>
      <div className="exec-section-body" style={{ paddingTop: 6 }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter activity…"
          className="exec-chat-input mb-3 w-full max-w-sm"
        />
        {filtered.slice(0, 12).map((row) => {
          const url = shapeLeadUrl(row.shape_record_id ?? null);
          return (
            <div key={row.id} className="exec-feed-row">
              <span className="exec-feed-dot" style={{ background: dotColor(row.change_type) }} />
              <span className="exec-feed-text">
                {url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {feedSummary(row)}
                  </a>
                ) : (
                  feedSummary(row)
                )}
              </span>
              <span className="exec-feed-time">{relativeMins(row.synced_at)}</span>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <p className="lo-muted py-4 text-center text-sm">No activity matches your filter.</p>
        )}
      </div>
    </section>
  );
}
