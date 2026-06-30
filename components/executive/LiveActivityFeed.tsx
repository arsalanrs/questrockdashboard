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

const CHANGE_TYPE_LABELS: Record<string, string> = {
  loan_created: "New Lead",
  status_changed: "Status",
  owner_changed: "Reassigned",
  note_added: "Note",
  field_changed: "Field",
};

function ActivityBadge({ type }: { type: string }) {
  const label = CHANGE_TYPE_LABELS[type] ?? type;
  const cls =
    type === "loan_created" ? "pill-green"
    : type === "status_changed" ? "pill-yellow"
    : type === "owner_changed" ? "pill-blue"
    : type === "note_added" ? "pill-blue"
    : "pill-muted";
  return (
    <span className={`${cls} inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide`}>
      {label}
    </span>
  );
}

function detailText(row: ActivityLogRow) {
  if (row.change_type === "status_changed") return `${row.old_value ?? "?"} → ${row.new_value ?? "?"}`;
  if (row.change_type === "owner_changed") return `${row.old_value ?? "?"} → ${row.new_value ?? "?"}`;
  if (row.change_type === "note_added") return (row.new_value ?? "").slice(0, 80);
  if (row.field_name) return `${row.field_name}: ${row.old_value ?? ""} → ${row.new_value ?? ""}`;
  return row.new_value ?? "—";
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
        (r.change_type ?? "").toLowerCase().includes(q) ||
        detailText(r).toLowerCase().includes(q),
    );
  }, [rows, query]);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: "var(--color-green)" }} />
          <span className="lo-heading text-sm font-semibold tracking-tight">Live Activity Feed</span>
          <span className="lo-muted text-xs">— last {rows.length} changes</span>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter activity…"
          className="lo-input ml-auto h-9 max-w-xs rounded-lg px-3 text-sm"
        />
      </div>
      <div className="lo-table-shell max-h-[360px] overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="lo-th">Time</th>
              <th className="lo-th">Type</th>
              <th className="lo-th">Borrower</th>
              <th className="lo-th">LO</th>
              <th className="lo-th">Detail</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const shapeUrl = shapeLeadUrl(row.shape_record_id ?? null);
              return (
                <tr key={row.id} className="lo-data-row">
                  <td className="lo-muted lo-td font-mono text-xs">
                    {new Date(row.synced_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="lo-td">
                    <ActivityBadge type={row.change_type} />
                  </td>
                  <td className="lo-td">
                    {shapeUrl ? (
                      <a href={shapeUrl} target="_blank" rel="noopener noreferrer" className="lo-heading text-xs font-semibold hover:underline">
                        {row.borrower_name || "—"}
                      </a>
                    ) : (
                      <span className="lo-heading text-xs font-semibold">{row.borrower_name || "—"}</span>
                    )}
                  </td>
                  <td className="lo-muted lo-td text-xs">{row.lo_name || "—"}</td>
                  <td className="lo-muted lo-td max-w-xs truncate text-xs">{detailText(row)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
