"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/Badge";
import { DataTable } from "@/components/DataTable";
import { shapeLeadUrl } from "@/lib/shape-link";

type SlaStatus = "On Track" | "At Risk" | "Exceeded";

export type ProcessorLoanRow = {
  id: string;
  shape_record_id: number | null;
  borrower_first_name: string | null;
  borrower_last_name: string | null;
  current_stage: string | null;
  loan_type: string | null;
  is_restructure_hold: boolean;
  assigned_loan_officer_name: string | null;
  hours: number | null;
  slaStatus: SlaStatus;
  queue: string;
  openConditions: number;
};

type SummaryCard = {
  id: string;
  label: string;
  filter: (row: ProcessorLoanRow) => boolean;
  exceeded: (rows: ProcessorLoanRow[]) => boolean;
};

const STAGE_LABEL: Record<string, string> = {
  verification: "Verification",
  esign_out: "eSign Out",
  processing: "Processing",
  submission: "Submission",
  underwriting: "Underwriting",
  conditions: "Conditions",
  approval_conditions: "Approval Conditions",
  clear_to_close: "Clear to Close",
};

const SLA_BADGE_VARIANT: Record<SlaStatus, "green" | "yellow" | "red"> = {
  "On Track": "green",
  "At Risk": "yellow",
  Exceeded: "red",
};

type Props = {
  loans: ProcessorLoanRow[];
  summaryCards: Array<{ id: string; label: string; stages: string[]; useRestructure?: boolean }>;
};

export function ProcessorQueue({ loans, summaryCards }: Props) {
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<ProcessorLoanRow | null>(null);

  const cards: SummaryCard[] = useMemo(
    () =>
      summaryCards.map((c) => ({
        id: c.id,
        label: c.label,
        filter: (row) => {
          if (c.useRestructure) return row.is_restructure_hold;
          return !row.is_restructure_hold && c.stages.includes(row.current_stage ?? "");
        },
        exceeded: (rows) => {
          const subset = rows.filter((r) => {
            if (c.useRestructure) return r.is_restructure_hold;
            return !r.is_restructure_hold && c.stages.includes(r.current_stage ?? "");
          });
          return subset.some((l) => l.slaStatus === "Exceeded");
        },
      })),
    [summaryCards],
  );

  const filtered = useMemo(() => {
    if (!activeFilter) return loans;
    const card = cards.find((c) => c.id === activeFilter);
    return card ? loans.filter(card.filter) : loans;
  }, [loans, activeFilter, cards]);

  const borrower = (l: ProcessorLoanRow) =>
    [l.borrower_first_name, l.borrower_last_name].filter(Boolean).join(" ") || "—";

  return (
    <>
      <section className="space-y-2">
        <div className="lo-accent-text text-[11px] font-semibold uppercase tracking-[0.14em]">Pipeline Overview</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <button
            type="button"
            onClick={() => setActiveFilter(null)}
            className={cn(
              "lo-mini-stat text-left transition-colors",
              activeFilter === null && "ring-2 ring-[var(--lo-teal)]",
            )}
          >
            <div>
              <div className="lo-mini-stat-label">All queues</div>
              <div className="lo-mini-stat-value">{loans.length}</div>
            </div>
          </button>
          {cards.map((card) => {
            const count = loans.filter(card.filter).length;
            const exceeded = card.exceeded(loans);
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => setActiveFilter(card.id)}
                className={cn(
                  "lo-mini-stat text-left transition-colors hover:border-[var(--lo-teal)]",
                  activeFilter === card.id && "ring-2 ring-[var(--lo-teal)]",
                )}
              >
                <span
                  className={cn(
                    "inline-block h-2.5 w-2.5 shrink-0 rounded-full",
                    exceeded ? "bg-red-500" : "bg-emerald-500",
                  )}
                />
                <div className="min-w-0">
                  <div className="lo-mini-stat-label truncate">{card.label}</div>
                  <div className="lo-mini-stat-value">{count}</div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        <div className="lo-accent-text text-[11px] font-semibold uppercase tracking-[0.14em]">Work Queue</div>
        <DataTable
          rows={filtered}
          rowKey={(r) => r.id}
          onRowClick={setSelected}
          maxHeight="480px"
          emptyMessage="No files in this queue."
          columns={[
            { key: "queue", label: "Queue", sortable: true },
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
            { key: "loan_type", label: "Type", sortable: true },
            {
              key: "current_stage",
              label: "Stage",
              sortable: true,
              render: (r) => STAGE_LABEL[r.current_stage ?? ""] ?? r.current_stage ?? "—",
            },
            {
              key: "hours",
              label: "Hours",
              sortable: true,
              align: "right",
              sortValue: (r) => r.hours ?? -1,
              render: (r) => <span className="tabular-nums">{r.hours ?? "—"}</span>,
            },
            {
              key: "openConditions",
              label: "Conditions",
              sortable: true,
              align: "right",
            },
            { key: "assigned_loan_officer_name", label: "LO", sortable: true },
            {
              key: "slaStatus",
              label: "SLA",
              sortable: true,
              render: (r) => <Badge variant={SLA_BADGE_VARIANT[r.slaStatus]}>{r.slaStatus}</Badge>,
            },
            {
              key: "actions",
              label: "Actions",
              align: "right",
              render: (r) => {
                const url = shapeLeadUrl(r.shape_record_id);
                return url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="lo-link-chip shape"
                    onClick={(e) => e.stopPropagation()}
                  >
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

      <section className="lo-card p-5">
        <h2 className="lo-heading text-sm font-semibold">Game Plan</h2>
        {!selected ? (
          <p className="lo-muted mt-2 text-sm">Click a row in the queue to view file details and next steps.</p>
        ) : (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="lo-heading text-base font-semibold">{borrower(selected)}</p>
                <p className="lo-muted text-sm">
                  {selected.queue} · {STAGE_LABEL[selected.current_stage ?? ""] ?? selected.current_stage ?? "—"}
                </p>
              </div>
              {shapeLeadUrl(selected.shape_record_id) ? (
                <a
                  href={shapeLeadUrl(selected.shape_record_id)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="lo-link-chip shape"
                >
                  Open in Shape ↗
                </a>
              ) : null}
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div className="lo-detail-cell rounded-lg p-2">
                <dt className="lo-muted text-[10px] uppercase">Loan #</dt>
                <dd className="lo-heading font-mono">{selected.shape_record_id ?? "—"}</dd>
              </div>
              <div className="lo-detail-cell rounded-lg p-2">
                <dt className="lo-muted text-[10px] uppercase">Hours in stage</dt>
                <dd className="lo-heading tabular-nums">{selected.hours ?? "—"}</dd>
              </div>
              <div className="lo-detail-cell rounded-lg p-2">
                <dt className="lo-muted text-[10px] uppercase">Open conditions</dt>
                <dd className="lo-heading tabular-nums">{selected.openConditions}</dd>
              </div>
              <div className="lo-detail-cell rounded-lg p-2">
                <dt className="lo-muted text-[10px] uppercase">SLA</dt>
                <dd><Badge variant={SLA_BADGE_VARIANT[selected.slaStatus]}>{selected.slaStatus}</Badge></dd>
              </div>
            </dl>
          </div>
        )}
      </section>
    </>
  );
}
