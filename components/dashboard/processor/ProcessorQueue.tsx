"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/Badge";
import { shapeLeadUrl } from "@/lib/shape-link";

type SlaStatus = "On Track" | "At Risk" | "Exceeded";

export type ProcessorLoanRow = {
  id: string;
  shape_record_id: number | null;
  borrower_first_name: string | null;
  borrower_last_name: string | null;
  current_stage: string | null;
  loan_type: string | null;
  loan_amount_cents: number | null;
  is_restructure_hold: boolean;
  assigned_loan_officer_name: string | null;
  hours: number | null;
  slaStatus: SlaStatus;
  queue: string;
  openConditions: number;
};

type SummaryDef = {
  id: string;
  label: string;
  stages: string[];
  useRestructure?: boolean;
  tone: string;
  icon: string;
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

const STAGE_BADGE: Record<string, "red" | "yellow" | "green" | "default"> = {
  conditions: "red",
  approval_conditions: "red",
  underwriting: "red",
  clear_to_close: "yellow",
  processing: "default",
  submission: "default",
  esign_out: "green",
};

const TILE_DEFS: SummaryDef[] = [
  { id: "esign", label: "New from eSign", stages: ["esign_out"], tone: "t1", icon: "✉" },
  { id: "processing", label: "In Processing", stages: ["processing", "submission"], tone: "t2", icon: "📄" },
  { id: "uw", label: "Underwriting", stages: ["underwriting"], tone: "t3", icon: "🏷" },
  { id: "conditions", label: "Conditions", stages: ["conditions", "approval_conditions"], tone: "t4", icon: "☑" },
  { id: "prectc", label: "Pre-CTC", stages: ["clear_to_close"], tone: "t5", icon: "🚩" },
  { id: "restructure", label: "Restructure Hold", stages: [], useRestructure: true, tone: "t6", icon: "⏸" },
];

function borrower(l: ProcessorLoanRow) {
  return [l.borrower_first_name, l.borrower_last_name].filter(Boolean).join(" ") || "—";
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function fmtLoanSub(l: ProcessorLoanRow): string {
  const type = l.loan_type ?? "Loan";
  if (l.loan_amount_cents == null) return type;
  const dollars = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(l.loan_amount_cents / 100);
  return `${type} · ${dollars}`;
}

function avatarFor(sla: SlaStatus): { bg: string; color: string } {
  if (sla === "Exceeded") return { bg: "#FCEEEC", color: "#A33B2E" };
  if (sla === "At Risk") return { bg: "#FCF3E3", color: "#96631A" };
  return { bg: "#EAF1F7", color: "#244E76" };
}

function hrsClass(sla: SlaStatus): string {
  if (sla === "Exceeded") return "danger";
  if (sla === "At Risk") return "warn";
  return "ok";
}

function matchesTile(row: ProcessorLoanRow, tile: SummaryDef): boolean {
  if (tile.useRestructure) return row.is_restructure_hold;
  return !row.is_restructure_hold && tile.stages.includes(row.current_stage ?? "");
}

type ChecklistItem = {
  id: string;
  title: string;
  status: string;
};

function GamePlanChecklist({ loanId }: { loanId: string }) {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/loans/${loanId}/checklist`)
      .then((r) => r.json())
      .then((j) => setItems(j.checklist ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [loanId]);

  if (loading) return <p className="lo-muted text-sm">Loading game plan…</p>;
  if (items.length === 0) {
    return <p className="lo-muted text-sm">No checklist items yet for this file.</p>;
  }

  return (
    <div>
      {items.slice(0, 12).map((item) => {
        const done = item.status === "received" || item.status === "waived";
        return (
          <div key={item.id} className={cn("proc-check-row", done && "done")}>
            <div className="proc-check-icon">{done ? "✓" : ""}</div>
            <div className="proc-check-label">{item.title}</div>
            {!done && item.status === "pending" && (
              <div className="text-[11px] font-semibold" style={{ color: "var(--color-red)" }}>Pending</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

type Props = {
  loans: ProcessorLoanRow[];
  processorName: string;
};

export function ProcessorQueue({ loans, processorName }: Props) {
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<ProcessorLoanRow | null>(null);
  const [slideOpen, setSlideOpen] = useState(false);

  const filtered = useMemo(() => {
    if (!activeFilter) return loans;
    const tile = TILE_DEFS.find((t) => t.id === activeFilter);
    return tile ? loans.filter((r) => matchesTile(r, tile)) : loans;
  }, [loans, activeFilter]);

  function openSlide(row: ProcessorLoanRow) {
    setSelected(row);
    setSlideOpen(true);
  }

  function closeSlide() {
    setSlideOpen(false);
    setSelected(null);
  }


  return (
    <>
      <div className="ops-page-head">
        <div>
          <div className="ops-eyebrow">
            <span className="ops-eyebrow-pulse" aria-hidden />
            {loans.length} files in queue
          </div>
          <h1 className="ops-page-title">Processor Queue</h1>
          <p className="ops-page-sub">{processorName} · sorted worst-first by hours in stage</p>
        </div>
      </div>

      <div className="ops-stat-grid">
        {TILE_DEFS.map((tile) => {
          const count = loans.filter((r) => matchesTile(r, tile)).length;
          const active = activeFilter === tile.id;
          return (
            <button
              key={tile.id}
              type="button"
              className={cn("ops-stat-tile", tile.tone, active && "active")}
              onClick={() => setActiveFilter(activeFilter === tile.id ? null : tile.id)}
            >
              <div className="icon" aria-hidden>{tile.icon}</div>
              <p className="n">{count}</p>
              <p className="l">{tile.label}</p>
            </button>
          );
        })}
      </div>

      <section className="ops-section">
        <div className="ops-section-head">
          <h2 className="ops-section-title">
            <span className="icon" aria-hidden>☰</span>
            Sortable Queue
          </h2>
          <span className="ops-section-meta">
            <span className="ops-sort-note">↓ Worst SLA first</span>
          </span>
        </div>
        <table className="dt">
          <thead>
            <tr>
              <th>Borrower</th>
              <th>LO</th>
              <th>Stage</th>
              <th>Queue</th>
              <th className="r">Hrs in stage</th>
              <th>Conditions</th>
              <th>SLA</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="lo-muted px-6 py-8 text-center text-sm">
                  No files in this queue.
                </td>
              </tr>
            )}
            {filtered.map((row) => {
              const name = borrower(row);
              const av = avatarFor(row.slaStatus);
              const stageKey = row.current_stage ?? "";
              const badgeVariant = STAGE_BADGE[stageKey] ?? "default";
              const isSelected = selected?.id === row.id;
              return (
                <tr
                  key={row.id}
                  className={cn(
                    row.slaStatus === "Exceeded" && "row-critical",
                    isSelected && slideOpen && "selected",
                  )}
                  onClick={() => openSlide(row)}
                >
                  <td>
                    <div className="ops-name-cell">
                      <div className="ops-avatar" style={{ background: av.bg, color: av.color }}>
                        {initials(name)}
                      </div>
                      <div>
                        <div className="ops-name-main">{name}</div>
                        <div className="ops-name-sub">{fmtLoanSub(row)}</div>
                      </div>
                    </div>
                  </td>
                  <td className="lo-muted text-[12px]">{row.assigned_loan_officer_name ?? "—"}</td>
                  <td>
                    <Badge variant={badgeVariant}>
                      {STAGE_LABEL[stageKey] ?? stageKey.replace(/_/g, " ")}
                    </Badge>
                  </td>
                  <td className="lo-muted text-[12px]">{row.queue}</td>
                  <td className={cn("r ops-hrs", hrsClass(row.slaStatus))}>
                    {row.hours != null ? `${row.hours}h` : "—"}
                  </td>
                  <td>
                    <span className="ops-cond-count">☑ {row.openConditions} open</span>
                  </td>
                  <td>
                    <Badge variant={row.slaStatus === "Exceeded" ? "red" : row.slaStatus === "At Risk" ? "yellow" : "green"}>
                      {row.slaStatus === "On Track" ? "On track" : row.slaStatus}
                    </Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <div className={cn("proc-overlay", slideOpen && "open")} onClick={closeSlide} aria-hidden />
      <div className={cn("proc-slideover", slideOpen && "open")} role="dialog" aria-modal="true">
        {!selected ? (
          <div className="proc-so-empty">
            <span style={{ fontSize: 38, opacity: 0.5 }}>☝</span>
            <div>Click a row to view its Game Plan</div>
          </div>
        ) : (
          <>
            <div className="proc-so-head">
              <button type="button" className="proc-so-close" onClick={closeSlide} aria-label="Close">
                ✕
              </button>
              {(() => {
                const av = avatarFor(selected.slaStatus);
                const name = borrower(selected);
                const shapeUrl = shapeLeadUrl(selected.shape_record_id);
                return (
                  <>
                    <div className="proc-so-avatar" style={{ background: av.bg, color: av.color }}>
                      {initials(name)}
                    </div>
                    <p className="proc-so-name">{name}</p>
                    <p className="proc-so-meta">{fmtLoanSub(selected)}</p>
                    <p className="proc-so-meta">LO: {selected.assigned_loan_officer_name ?? "—"}</p>
                    {shapeUrl ? (
                      <a href={shapeUrl} target="_blank" rel="noopener noreferrer" className="proc-so-shape">
                        Open in Shape ↗
                      </a>
                    ) : null}
                  </>
                );
              })()}
            </div>
            <div className="proc-so-body">
              <div className="proc-so-stat-row">
                <div className="proc-so-stat">
                  <div className="l">Stage</div>
                  <div className="v" style={{ fontSize: 14 }}>
                    {STAGE_LABEL[selected.current_stage ?? ""] ?? selected.current_stage ?? "—"}
                  </div>
                </div>
                <div className="proc-so-stat">
                  <div className="l">Hours in stage</div>
                  <div className="v">{selected.hours != null ? `${selected.hours}h` : "—"}</div>
                </div>
                <div className="proc-so-stat">
                  <div className="l">SLA</div>
                  <div
                    className="v"
                    style={{
                      fontSize: 13,
                      color:
                        selected.slaStatus === "Exceeded"
                          ? "var(--red-700)"
                          : selected.slaStatus === "At Risk"
                            ? "var(--amber-700)"
                            : "var(--emerald-600)",
                    }}
                  >
                    {selected.slaStatus}
                  </div>
                </div>
                <div className="proc-so-stat">
                  <div className="l">Open conditions</div>
                  <div className="v">{selected.openConditions}</div>
                </div>
              </div>
              <p className="proc-checklist-title">Game Plan</p>
              <GamePlanChecklist loanId={selected.id} />
            </div>
          </>
        )}
      </div>
    </>
  );
}
