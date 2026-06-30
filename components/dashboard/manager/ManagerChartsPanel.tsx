"use client";

import { DashboardBarChart, type BarChartItem } from "@/components/charts/BarChart";
import { FunnelBar, type FunnelStage } from "@/components/charts/FunnelBar";

type Props = {
  funnelStages: FunnelStage[];
  slaHealth: BarChartItem[];
  leadSources: BarChartItem[];
  /** Single “Pipeline Health” section with 3 charts (manager mockup layout). */
  unified?: boolean;
};

export function ManagerChartsPanel({ funnelStages, slaHealth, leadSources, unified = false }: Props) {
  const showFunnel = funnelStages.some((s) => s.count > 0);
  const showSla = slaHealth.length > 0;
  const showSources = leadSources.length > 0;

  if (!showFunnel && !showSla && !showSources) return null;

  const charts = (
    <>
      {showFunnel && (
        <div className="mgr-chart-card">
          <div className="mgr-chart-title">
            Pipeline Funnel
            <span className="mgr-chart-tag">by stage</span>
          </div>
          <FunnelBar stages={funnelStages} height={190} />
        </div>
      )}
      {showSla && (
        <div className="mgr-chart-card">
          <div className="mgr-chart-title">
            Stage SLA Health
            <span className="mgr-chart-tag">% on time</span>
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
            height={190}
          />
        </div>
      )}
      {showSources && (
        <div className="mgr-chart-card">
          <div className="mgr-chart-title">
            Lead Sources
            <span className="mgr-chart-tag">last 90 days</span>
          </div>
          <DashboardBarChart
            data={leadSources.map((s) => ({ ...s, color: "var(--gold-500)" }))}
            height={190}
          />
        </div>
      )}
    </>
  );

  if (unified) {
    return (
      <section className="mgr-section">
        <div className="mgr-section-head">
          <h2 className="mgr-section-title">Pipeline Health</h2>
          <span className="mgr-section-meta">Funnel · SLA status · lead sources</span>
        </div>
        <div className="mgr-charts-grid">{charts}</div>
      </section>
    );
  }

  return <>{charts}</>;
}
