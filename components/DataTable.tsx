"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";

export type DataTableColumn<T> = {
  key: keyof T | string;
  label: string;
  sortable?: boolean;
  align?: "left" | "right";
  render?: (row: T) => React.ReactNode;
  sortValue?: (row: T) => string | number | null;
};

type Props<T extends Record<string, unknown>> = {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  className?: string;
  maxHeight?: string;
};

type SortDir = "asc" | "desc";

export function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  rowKey,
  onRowClick,
  emptyMessage = "No rows",
  className,
  maxHeight,
}: Props<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => String(c.key) === sortKey);
    return [...rows].sort((a, b) => {
      const av = col?.sortValue ? col.sortValue(a) : a[sortKey as keyof T];
      const bv = col?.sortValue ? col.sortValue(b) : b[sortKey as keyof T];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, sortKey, sortDir, columns]);

  return (
    <div
      className={cn("lo-table-shell", maxHeight && "overflow-auto", className)}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <table className="w-full text-sm">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={String(col.key)}
                className={cn(
                  "lo-th",
                  col.align === "right" && "text-right",
                  col.sortable && "cursor-pointer select-none hover:text-[var(--lo-text)]",
                )}
                onClick={col.sortable ? () => toggleSort(String(col.key)) : undefined}
              >
                {col.label}
                {col.sortable && sortKey === String(col.key) ? (
                  <span className="ml-1 opacity-60">{sortDir === "asc" ? "↑" : "↓"}</span>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="lo-muted lo-td px-4 py-8 text-center text-sm">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            sorted.map((row) => (
              <tr
                key={rowKey(row)}
                className={cn("lo-data-row", onRowClick && "cursor-pointer")}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((col) => (
                  <td
                    key={String(col.key)}
                    className={cn("lo-td", col.align === "right" && "text-right")}
                  >
                    {col.render
                      ? col.render(row)
                      : String(row[col.key as keyof T] ?? "—")}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
