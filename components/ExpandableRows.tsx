"use client";

import { useState, Children } from "react";

/**
 * Wraps table <tr> children and shows only `max` rows by default.
 * A footer row with a "View all X" button expands the rest inline.
 * Must be placed inside a <tbody>.
 */
export function ExpandableRows({
  children,
  max = 5,
  label = "items",
  colSpan = 8,
}: {
  children: React.ReactNode;
  max?: number;
  /** plural label for the count, e.g. "loans" */
  label?: string;
  colSpan?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const all = Children.toArray(children);
  const visible = expanded ? all : all.slice(0, max);
  const hiddenCount = all.length - max;

  return (
    <>
      {visible}
      {!expanded && hiddenCount > 0 && (
        <tr>
          <td
            colSpan={colSpan}
            className="px-4 py-2.5 text-center"
            style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
          >
            <button
              onClick={() => setExpanded(true)}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors"
              style={{
                background: "rgba(255,255,255,0.05)",
                color: "hsl(215 14% 65%)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              View all {all.length} {label}
              <svg width="12" height="12" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Simple expandable card list (non-table version).
 * Renders children as-is but caps the visible count.
 */
export function ExpandableCards({
  children,
  max = 4,
  label = "items",
}: {
  children: React.ReactNode;
  max?: number;
  label?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const all = Children.toArray(children);
  const visible = expanded ? all : all.slice(0, max);
  const hiddenCount = all.length - max;

  return (
    <>
      {visible}
      {!expanded && hiddenCount > 0 && (
        <div className="flex justify-center pt-1">
          <button
            onClick={() => setExpanded(true)}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors"
            style={{
              background: "rgba(255,255,255,0.05)",
              color: "hsl(215 14% 65%)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            View all {all.length} {label}
            <svg width="12" height="12" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
        </div>
      )}
    </>
  );
}
