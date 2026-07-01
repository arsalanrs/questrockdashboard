"use client";

import { useMemo, useState } from "react";
import { differenceInCalendarDays, format } from "date-fns";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/Badge";
import { shapeLeadUrl } from "@/lib/shape-link";

export type CloserLoanRow = {
  id: string;
  shape_record_id: number | null;
  borrower_first_name: string | null;
  borrower_last_name: string | null;
  current_stage: string | null;
  closing_date: string | null;
  assigned_loan_officer_name: string | null;
  loan_amount_cents: number | null;
  loan_type: string | null;
  lock_expiration_date: string | null;
  lendingpad_loan_number: string | null;
  openConditions: number;
};

const STAGE_LABEL: Record<string, string> = {
  clear_to_close: "Clear to Close",
  closing: "Closing",
};

const CLOSING_STAGES = [
  { key: "clear_to_close", label: "Clear to Close", tone: "t7", icon: "✓" },
  { key: "closing", label: "Closing", tone: "t8", icon: "🔑" },
] as const;

function borrower(r: CloserLoanRow) {
  return [r.borrower_first_name, r.borrower_last_name].filter(Boolean).join(" ") || "—";
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function closingMeta(dateStr: string | null): { label: string; badge: "red" | "yellow" | "green" } {
  if (!dateStr) return { label: "—", badge: "green" };
  const days = differenceInCalendarDays(new Date(dateStr), new Date());
  const label = format(new Date(dateStr), "MMM d, yyyy");
  if (days < 0) return { label: `${label} (${Math.abs(days)}d late)`, badge: "red" };
  if (days <= 3) return { label: `${label} (${days}d)`, badge: "yellow" };
  return { label, badge: "green" };
}

function lockMeta(dateStr: string | null): { label: string; cls: string } {
  if (!dateStr) return { label: "—", cls: "ok" };
  const days = differenceInCalendarDays(new Date(dateStr), new Date());
  if (days < 0) return { label: `Exp ${Math.abs(days)}d ago`, cls: "danger" };
  if (days <= 7) return { label: `${days}d left`, cls: "warn" };
  return { label: `${days}d left`, cls: "ok" };
}

function fmtAmount(cents: number | null): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

type Props = {
  rows: CloserLoanRow[];
  closerName: string;
};

export function CloserQueue({ rows, closerName }: Props) {
  const [stageFilter, setStageFilter] = useState<string | null>(null);

  const condWarning = useMemo(() => rows.filter((r) => r.openConditions > 0).length, [rows]);

  const filtered = useMemo(() => {
    if (!stageFilter) return rows;
    return rows.filter((r) => r.current_stage === stageFilter);
  }, [rows, stageFilter]);

  return (
    <>
      <div className="ops-page-head">
        <div>
          <div className="ops-eyebrow">
            <span className="ops-eyebrow-pulse" aria-hidden />
            {rows.length} files to close{condWarning > 0 ? ` · ${condWarning} with open conditions` : ""}
          </div>
          <h1 className="ops-page-title">Closer Queue</h1>
          <p className="ops-page-sub">{closerName} · sorted by closing date</p>
        </div>
      </div>

      <div className="ops-stat-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <button
          type="button"
          className={cn("ops-stat-tile t2", stageFilter === null && "active")}
          onClick={() => setStageFilter(null)}
        >
          <div className="icon" aria-hidden>📋</div>
          <p className="n">{rows.length}</p>
          <p className="l">All closing files</p>
        </button>
        {CLOSING_STAGES.map((s) => {
          const count = rows.filter((r) => r.current_stage === s.key).length;
          return (
            <button
              key={s.key}
              type="button"
              className={cn("ops-stat-tile", s.tone, stageFilter === s.key && "active")}
              onClick={() => setStageFilter(stageFilter === s.key ? null : s.key)}
            >
              <div className="icon" aria-hidden>{s.icon}</div>
              <p className="n">{count}</p>
              <p className="l">{s.label}</p>
            </button>
          );
        })}
      </div>

      <section className="ops-section">
        <div className="ops-section-head">
          <h2 className="ops-section-title">
            <span className="icon" aria-hidden>☰</span>
            Closing Queue
          </h2>
          <span className="ops-section-meta">Soonest closing first</span>
        </div>
        <table className="dt">
          <thead>
            <tr>
              <th>Borrower</th>
              <th>Stage</th>
              <th>Closing Date</th>
              <th className="r">Amount</th>
              <th>Lock</th>
              <th>Conds</th>
              <th>Assigned LO</th>
              <th className="r">Shape</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="lo-muted px-6 py-8 text-center text-sm">
                  No files in closing queue.
                </td>
              </tr>
            )}
            {filtered.map((row) => {
              const name = borrower(row);
              const closing = closingMeta(row.closing_date);
              const lock = lockMeta(row.lock_expiration_date);
              const av =
                closing.badge === "red"
                  ? { bg: "#FCEEEC", color: "#A33B2E" }
                  : closing.badge === "yellow"
                    ? { bg: "#FCF3E3", color: "#96631A" }
                    : { bg: "#E9F4ED", color: "#1F7A4D" };
              const url = shapeLeadUrl(row.shape_record_id);
              return (
                <tr
                  key={row.id}
                  className={closing.badge === "red" ? "row-critical" : undefined}
                  onClick={() => url && window.open(url, "_blank")}
                >
                  <td>
                    <div className="ops-name-cell">
                      <div className="ops-avatar" style={{ background: av.bg, color: av.color }}>
                        {initials(name)}
                      </div>
                      <div>
                        <div className="ops-name-main">{name}</div>
                        <div className="ops-name-sub font-mono text-[11px]">
                          {row.lendingpad_loan_number
                            ? `LP #${row.lendingpad_loan_number}`
                            : `#${row.shape_record_id ?? "—"}`}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <Badge variant={row.current_stage === "closing" ? "green" : "yellow"}>
                      {STAGE_LABEL[row.current_stage ?? ""] ?? row.current_stage ?? "—"}
                    </Badge>
                  </td>
                  <td>
                    <span className={cn("ops-hrs", closing.badge === "red" ? "danger" : closing.badge === "yellow" ? "warn" : "ok")}>
                      {closing.label}
                    </span>
                  </td>
                  <td className="r font-mono text-[12px]">{fmtAmount(row.loan_amount_cents)}</td>
                  <td>
                    <span className={cn("ops-hrs text-[11px]", lock.cls)}>{lock.label}</span>
                  </td>
                  <td>
                    {row.openConditions > 0 ? (
                      <span className="ops-cond-count">☑ {row.openConditions} open</span>
                    ) : (
                      <span className="lo-muted text-[11px]">All clear</span>
                    )}
                  </td>
                  <td className="lo-muted text-[12px]">{row.assigned_loan_officer_name ?? "—"}</td>
                  <td className="r">
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="lo-link-chip shape"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Open ↗
                      </a>
                    ) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}
