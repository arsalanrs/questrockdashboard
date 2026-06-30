"use client";

import Link from "next/link";
import { DashboardBarChart, type BarChartItem } from "@/components/charts/BarChart";

type LoRow = {
  loName: string;
  loUserId: string | null;
  touchPct: number;
  touched: number;
  total: number;
};

type Props = {
  loRows: LoRow[];
  slaSnapshot: BarChartItem[];
  showSla?: boolean;
  showLo?: boolean;
};

export function MonitorInsightsPanel({ loRows, slaSnapshot, showSla = true, showLo = true }: Props) {
  const showSlaChart = showSla && slaSnapshot.some((s) => s.value > 0);
  const showLoGrid = showLo && loRows.length > 0;
  if (!showSlaChart && !showLoGrid) return null;

  return (
    <div className={`grid gap-3${showSlaChart && showLoGrid ? " lg:grid-cols-2" : ""}`}>
      {showSlaChart && (
        <div className="dash-card p-4">
          <div className="mb-2">
            <span className="dash-card-title">SLA Snapshot</span>
          </div>
          <DashboardBarChart data={slaSnapshot} layout="vertical" height={140} />
        </div>
      )}
      {showLoGrid && (
        <div className="dash-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="dash-card-title">LO Accountability</span>
            <span className="lo-muted text-[11px]">Click to open pipeline</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {loRows.slice(0, 8).map((lo) => {
              const href = lo.loUserId
                ? `/dashboard/manager?lo=${encodeURIComponent(lo.loUserId)}`
                : `/dashboard/manager?lo=${encodeURIComponent(lo.loName)}`;
              const clr =
                lo.total === 0 ? "var(--lo-muted)" : lo.touchPct >= 60 ? "var(--color-green)" : lo.touchPct >= 30 ? "var(--color-amber)" : "var(--color-red)";
              return (
                <Link
                  key={lo.loName}
                  href={href}
                  className="lo-card block p-3 transition-colors hover:border-[var(--lo-teal)]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="lo-heading text-[12px] font-semibold leading-tight">{lo.loName}</span>
                    <span className="text-lg font-bold tabular-nums" style={{ color: clr }}>{lo.touchPct}%</span>
                  </div>
                  <div className="mt-2 h-[3px] overflow-hidden rounded-full" style={{ background: "var(--lo-surface-muted)" }}>
                    <div className="h-full rounded-full" style={{ width: `${Math.min(lo.touchPct, 100)}%`, background: clr }} />
                  </div>
                  <p className="lo-muted mt-1 text-[10px]">{lo.touched} touched · {lo.total} new today</p>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
