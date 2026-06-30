"use client";

import { useMemo, useState } from "react";
import { differenceInCalendarDays } from "date-fns";
import { cn } from "@/lib/cn";
import { DataTable } from "@/components/DataTable";
import { shapeLeadUrl } from "@/lib/shape-link";

export type CloserLoanRow = {
  id: string;
  shape_record_id: number | null;
  borrower_first_name: string | null;
  borrower_last_name: string | null;
  current_stage: string | null;
  closing_date: string | null;
  assigned_loan_officer_name: string | null;
};

const STAGE_LABEL: Record<string, string> = {
  clear_to_close: "Clear to Close",
  closing: "Closing",
};

const CLOSING_STAGES = ["clear_to_close", "closing"] as const;

function closingTone(dateStr: string | null): { className: string; label: string } {
  if (!dateStr) return { className: "lo-muted", label: "—" };
  const days = differenceInCalendarDays(new Date(dateStr), new Date());
  if (days < 0) return { className: "text-[var(--color-red)] font-semibold", label: dateStr };
  if (days <= 3) return { className: "text-[var(--color-amber)] font-semibold", label: dateStr };
  return { className: "text-[var(--color-green)] font-semibold", label: dateStr };
}

type Props = {
  rows: CloserLoanRow[];
};

export function CloserQueue({ rows }: Props) {
  const [stageFilter, setStageFilter] = useState<string | null>(null);

  const byStage = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((l) => {
      if (l.current_stage) m.set(l.current_stage, (m.get(l.current_stage) ?? 0) + 1);
    });
    return m;
  }, [rows]);

  const filtered = useMemo(() => {
    if (!stageFilter) return rows;
    return rows.filter((r) => r.current_stage === stageFilter);
  }, [rows, stageFilter]);

  const borrower = (r: CloserLoanRow) =>
    [r.borrower_first_name, r.borrower_last_name].filter(Boolean).join(" ") || "—";

  return (
    <>
      <section className="space-y-2">
        <div className="lo-accent-text text-[11px] font-semibold uppercase tracking-[0.14em]">By stage</div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setStageFilter(null)}
            className={cn(
              "lo-mini-stat transition-colors",
              stageFilter === null && "ring-2 ring-[var(--lo-teal)]",
            )}
          >
            <div>
              <div className="lo-mini-stat-label">All</div>
              <div className="lo-mini-stat-value">{rows.length}</div>
            </div>
          </button>
          {CLOSING_STAGES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStageFilter(s)}
              className={cn(
                "lo-mini-stat transition-colors hover:border-[var(--lo-teal)]",
                stageFilter === s && "ring-2 ring-[var(--lo-teal)]",
              )}
            >
              <div>
                <div className="lo-mini-stat-label">{STAGE_LABEL[s] ?? s}</div>
                <div className="lo-mini-stat-value">{byStage.get(s) ?? 0}</div>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <div className="lo-accent-text text-[11px] font-semibold uppercase tracking-[0.14em]">Queue</div>
        <DataTable
          rows={filtered}
          rowKey={(r) => r.id}
          maxHeight="520px"
          emptyMessage="No files in closing queue."
          columns={[
            {
              key: "shape_record_id",
              label: "Loan #",
              sortable: true,
              render: (r) => <span className="font-mono text-xs">{r.shape_record_id ?? "—"}</span>,
            },
            {
              key: "borrower",
              label: "Borrower",
              sortable: true,
              sortValue: (r) => borrower(r),
              render: (r) => <span className="lo-name-text">{borrower(r)}</span>,
            },
            {
              key: "current_stage",
              label: "Stage",
              sortable: true,
              render: (r) => STAGE_LABEL[r.current_stage ?? ""] ?? r.current_stage ?? "—",
            },
            {
              key: "closing_date",
              label: "Closing Date",
              sortable: true,
              sortValue: (r) => r.closing_date ?? "",
              render: (r) => {
                const t = closingTone(r.closing_date);
                return <span className={t.className}>{t.label}</span>;
              },
            },
            { key: "assigned_loan_officer_name", label: "Assigned LO", sortable: true },
            {
              key: "actions",
              label: "Actions",
              align: "right",
              render: (r) => {
                const url = shapeLeadUrl(r.shape_record_id);
                return url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer" className="lo-link-chip shape">
                    Shape ↗
                  </a>
                ) : (
                  "—"
                );
              },
            },
          ]}
        />
      </section>
    </>
  );
}
