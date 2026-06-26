"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { ShapeViewTable } from "@/components/dashboard/ShapeViewTable";
import {
  SHAPE_VIEW_CATEGORIES,
  defaultViewIdForCategory,
  getViewById,
  getViewsForCategory,
  type ShapeViewCategory,
} from "@/lib/shape-views";
import { countLoansByView, filterLoansForView } from "@/lib/shape-views/query-loans";
import type { LoDashboardLoanRow } from "@/lib/shape-views/lo-dashboard";

type Props = {
  loans: LoDashboardLoanRow[];
  showLoColumn?: boolean;
};

export function ShapeViewsPanel({ loans, showLoColumn = false }: Props) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<ShapeViewCategory>("Leads");
  const [viewId, setViewId] = useState(defaultViewIdForCategory("Leads"));

  const viewCounts = useMemo(() => countLoansByView(loans), [loans]);
  const sidebarViews = useMemo(() => getViewsForCategory(category), [category]);
  const viewRows = useMemo(() => filterLoansForView(loans, viewId), [loans, viewId]);
  const activeView = getViewById(viewId);
  const totalInCategory = sidebarViews.reduce((n, v) => n + (viewCounts[v.id] ?? 0), 0);

  function selectCategory(next: ShapeViewCategory) {
    setCategory(next);
    setViewId(defaultViewIdForCategory(next));
  }

  return (
    <section className="lo-card min-w-0 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
        aria-expanded={open}
      >
        <div>
          <p className="lo-accent-text text-xs font-bold uppercase tracking-wide">Shape CRM</p>
          <h2 className="lo-heading text-lg font-semibold">Pipeline Views</h2>
          <p className="lo-muted mt-1 text-xs">
            Nikk&apos;s saved Shape views · 90-day window
            {open && activeView ? ` · ${activeView.label} (${viewRows.length})` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="lo-muted hidden text-xs tabular-nums sm:inline">
            {loans.length} records loaded
          </span>
          <span
            className={cn(
              "lo-muted flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--lo-border)] text-lg transition-transform",
              open && "rotate-180",
            )}
            aria-hidden
          >
            ▾
          </span>
        </div>
      </button>

      {open ? (
        <div className="space-y-4 border-t border-[var(--lo-border)] px-5 pb-5 pt-4">
          <div className="lo-segment-track flex flex-wrap gap-1 rounded-lg p-1">
            {SHAPE_VIEW_CATEGORIES.map(({ key, label }) => {
              const catViews = getViewsForCategory(key);
              const total = catViews.reduce((n, v) => n + (viewCounts[v.id] ?? 0), 0);
              const isActive = category === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => selectCategory(key)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    isActive ? "lo-segment-active" : "lo-muted",
                  )}
                >
                  {label}
                  <span className="ml-1.5 tabular-nums text-xs opacity-80">({total})</span>
                </button>
              );
            })}
          </div>

          <div className="flex min-w-0 flex-col gap-4 lg:flex-row">
            <nav
              className="flex shrink-0 flex-row gap-1 overflow-x-auto lg:w-56 lg:flex-col lg:gap-0.5"
              aria-label="Shape pipeline views"
            >
              {sidebarViews.map((view) => {
                const isActive = view.id === viewId;
                const count = viewCounts[view.id] ?? 0;
                return (
                  <button
                    key={view.id}
                    type="button"
                    onClick={() => setViewId(view.id)}
                    title={view.deferred ? view.deferredReason : undefined}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors whitespace-nowrap lg:whitespace-normal",
                      isActive ? "lo-phase-chip font-semibold" : "lo-muted hover:bg-[var(--lo-accent-soft)]",
                      view.deferred && "opacity-60",
                    )}
                  >
                    <span className="leading-snug">{view.label}</span>
                    <span className="shrink-0 rounded-full bg-[var(--lo-chip-bg)] px-2 py-0.5 text-[10px] font-bold tabular-nums">
                      {view.deferred ? "—" : count}
                    </span>
                  </button>
                );
              })}
            </nav>

            <div className="min-w-0 flex-1">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h3 className="lo-heading text-[13px] font-black uppercase">
                  {activeView?.label ?? "View"}
                </h3>
                <span className="lo-muted text-xs tabular-nums">
                  {viewRows.length} in view · {totalInCategory} in {category}
                </span>
              </div>
              <div
                className="lo-table-wrap min-w-0 rounded-lg border border-[var(--lo-border)]"
                style={{ maxHeight: "min(50vh, 520px)" }}
              >
                <ShapeViewTable rows={viewRows} viewId={viewId} showLoColumn={showLoColumn} />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
