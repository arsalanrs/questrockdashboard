"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { EscalateButton } from "@/components/monitor/EscalateButton";
import { shapeLeadUrl } from "@/lib/shape-link";

export type SlaListRow = {
  loan_id: string;
  borrower_name: string;
  lo_name: string | null;
  status_raw: string | null;
  current_stage: string | null;
  sla_breach_type: string | null;
  hours_since_last_activity: number;
  shape_record_id: number | null;
};

type Props = {
  redLoans: SlaListRow[];
  yellowLoans: SlaListRow[];
  greenCount: number;
};

function fmtIdle(hours: number): string {
  if (hours >= 24) {
    const d = Math.floor(hours / 24);
    const h = hours % 24;
    return `${d}d ${h}h`;
  }
  return `${hours}h`;
}

function stageBadge(stage: string | null, status: string | null): string {
  const s = status ?? stage?.replace(/_/g, " ") ?? "—";
  if (s.length > 20) return s.slice(0, 18) + "…";
  return s;
}

export function MonitorSlaPanel({ redLoans, yellowLoans, greenCount }: Props) {
  const [filter, setFilter] = useState<"red" | "yellow">("red");

  const total = redLoans.length + yellowLoans.length + greenCount;
  const donutData = [
    { name: "Red", value: redLoans.length, color: "var(--color-red)" },
    { name: "Yellow", value: yellowLoans.length, color: "var(--color-amber)" },
    { name: "Green", value: greenCount, color: "var(--color-green)" },
  ].filter((d) => d.value > 0);

  const rows = filter === "red" ? redLoans : yellowLoans;

  const maxTier = useMemo(
    () => Math.max(redLoans.length, yellowLoans.length, greenCount, 1),
    [redLoans.length, yellowLoans.length, greenCount],
  );

  return (
    <section className="mon-section" style={{ marginBottom: 0 }}>
      <div className="mon-section-head">
        <h2 className="mon-section-title">SLA Snapshot</h2>
        <span className="mon-section-meta">All active loans</span>
      </div>
      <div className="mon-sla-snapshot">
        <div className="mon-sla-ring">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={donutData.length ? donutData : [{ name: "Empty", value: 1, color: "var(--cream-200)" }]}
                dataKey="value"
                innerRadius="72%"
                outerRadius="100%"
                strokeWidth={0}
              >
                {(donutData.length ? donutData : [{ color: "var(--cream-200)" }]).map((entry, i) => (
                  <Cell key={i} fill={entry.color ?? "var(--cream-200)"} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="mon-sla-ring-center">
            <span className="n">{total}</span>
            <span className="l">Total</span>
          </div>
        </div>
        <div className="mon-sla-legend">
          <div className="mon-sla-legend-row">
            <div className="lab">
              <span className="sw" style={{ background: "var(--color-red)" }} />
              Red
            </div>
            <span className="val" style={{ color: "var(--color-red)" }}>
              {redLoans.length}
            </span>
          </div>
          <div className="mon-sla-legend-row">
            <div className="lab">
              <span className="sw" style={{ background: "var(--color-amber)" }} />
              Yellow
            </div>
            <span className="val" style={{ color: "var(--color-amber)" }}>
              {yellowLoans.length}
            </span>
          </div>
          <div className="mon-sla-legend-row">
            <div className="lab">
              <span className="sw" style={{ background: "var(--color-green)" }} />
              Green
            </div>
            <span className="val" style={{ color: "var(--color-green)" }}>
              {greenCount}
            </span>
          </div>
          {/* proportional bars like mockup tier cards */}
          <div className="mt-2 space-y-1.5">
            {[
              { label: "Red", n: redLoans.length, color: "var(--color-red)" },
              { label: "Yellow", n: yellowLoans.length, color: "var(--color-amber)" },
              { label: "Green", n: greenCount, color: "var(--color-green)" },
            ].map((t) => (
              <div key={t.label} className="h-1 overflow-hidden rounded-full" style={{ background: "rgba(0,0,0,0.06)" }}>
                <div className="h-full rounded-full" style={{ width: `${(t.n / maxTier) * 100}%`, background: t.color }} />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mon-chip-row" style={{ paddingTop: 4 }}>
        <button
          type="button"
          className={`mon-chip${filter === "red" ? " active" : ""}`}
          onClick={() => setFilter("red")}
        >
          Red List <span className="count">{redLoans.length}</span>
        </button>
        <button
          type="button"
          className={`mon-chip${filter === "yellow" ? " active" : ""}`}
          onClick={() => setFilter("yellow")}
        >
          Yellow <span className="count">{yellowLoans.length}</span>
        </button>
      </div>
      <table className="dt">
        <thead>
          <tr>
            <th>Borrower</th>
            <th>Stage</th>
            <th>Owner</th>
            <th className="r">Idle</th>
            <th className="r">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="lo-muted px-6 py-8 text-center text-sm">
                No {filter} SLA violations right now.
              </td>
            </tr>
          )}
          {rows.slice(0, 12).map((r) => {
            const url = shapeLeadUrl(r.shape_record_id);
            const critical = filter === "red";
            return (
              <tr key={r.loan_id} className={critical ? "row-critical" : undefined}>
                <td>
                  {url ? (
                    <a href={url} target="_blank" rel="noopener noreferrer" className="mon-name-main hover:underline">
                      {r.borrower_name}
                    </a>
                  ) : (
                    <span className="mon-name-main">{r.borrower_name}</span>
                  )}
                </td>
                <td>
                  <span className={`pill-${filter === "red" ? "red" : "amber"} inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold`}>
                    {stageBadge(r.current_stage, r.status_raw)}
                  </span>
                </td>
                <td className="lo-muted text-[12px]">{r.lo_name ?? "—"}</td>
                <td className={`r ${critical ? "mon-timer" : ""}`} style={!critical ? { color: "var(--color-amber)", fontFamily: "ui-monospace, monospace", fontWeight: 600 } : undefined}>
                  {fmtIdle(r.hours_since_last_activity)}
                </td>
                <td className="r">
                  <div className="flex items-center justify-end gap-2">
                    {url && (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="lo-link-chip shape text-[10px]">
                        Open ↗
                      </a>
                    )}
                    <EscalateButton loanId={r.loan_id} borrowerName={r.borrower_name} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > 12 && (
        <p className="lo-muted px-6 pb-4 text-center text-[11px]">
          Showing 12 of {rows.length} — expand yellow list via chip filter
        </p>
      )}
    </section>
  );
}
