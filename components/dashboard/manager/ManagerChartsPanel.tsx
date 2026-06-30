"use client";

import { DashboardBarChart, type BarChartItem } from "@/components/charts/BarChart";
import { FunnelBar, type FunnelStage } from "@/components/charts/FunnelBar";

type Props = {
  funnelStages: FunnelStage[];
  slaHealth: BarChartItem[];
  leadSources: BarChartItem[];
};

export function ManagerChartsPanel({ funnelStages, slaHealth, leadSources }: Props) {
  return (
    <>
      {funnelStages.some((s) => s.count > 0) && (
        <div className="dash-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="dash-card-title">Pipeline Funnel</span>
            <span className="lo-muted text-[11px]">Active loans by stage</span>
          </div>
          <FunnelBar stages={funnelStages} height={180} />
        </div>
      )}

      {slaHealth.length > 0 && (
        <div className="dash-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="dash-card-title">Stage SLA Health</span>
            <span className="lo-muted text-[11px]">% on time</span>
          </div>
          <DashboardBarChart
            data={slaHealth.map((s) => ({
              ...s,
              color:
                (s.value as number) >= 80
                  ? "var(--color-green)"
                  : (s.value as number) >= 60
                    ? "var(--color-amber)"
                    : "var(--color-red)",
            }))}
            height={Math.max(120, slaHealth.length * 36)}
          />
        </div>
      )}

      {leadSources.length > 0 && (
        <div className="dash-card p-4">
          <div className="mb-2">
            <span className="dash-card-title">Lead Sources</span>
          </div>
          <DashboardBarChart data={leadSources} height={Math.max(160, leadSources.length * 28)} />
        </div>
      )}
    </>
  );
}
