import type { DocumentHealthSummary } from "@/lib/documents/load-document-health";
import type { MlReadiness } from "@/lib/signals/load-ml-readiness";
import { MetricRing } from "@/components/executive/MetricRing";

export function ExecutiveMetricsPanel({
  health,
  readiness,
}: {
  health: DocumentHealthSummary;
  readiness: MlReadiness;
}) {
  const assetPct =
    health.totalRequired > 0
      ? Math.round((health.totalProvided / health.totalRequired) * 100)
      : 0;

  return (
    <section className="exec-section">
      <div className="exec-section-head">
        <h2 className="exec-section-title">
          <span className="icon" aria-hidden>📄</span>
          Document Health &amp; Model Readiness
        </h2>
        <span className="exec-pill-ai">✦ Streaming</span>
      </div>
      <div className="exec-metric-grid">
        <div className="exec-metric-tile">
          <MetricRing pct={health.completionPct} color="var(--color-green)" />
          <div>
            <div className="font-semibold text-[13.5px]">Doc completeness</div>
            <div className="text-xs" style={{ color: "var(--ink-500)" }}>
              {health.loansTracked} loans tracked
            </div>
          </div>
        </div>
        <div className="exec-metric-tile">
          <MetricRing
            pct={assetPct}
            color={assetPct >= 70 ? "var(--color-green)" : "var(--color-amber)"}
          />
          <div>
            <div className="font-semibold text-[13.5px]">Docs provided</div>
            <div className="text-xs" style={{ color: "var(--ink-500)" }}>
              {health.totalProvided} / {health.totalRequired} required
            </div>
          </div>
        </div>
        <div className="exec-metric-tile">
          <MetricRing pct={readiness.progressPct} color="var(--gold-500)" />
          <div>
            <div className="font-semibold text-[13.5px]">Tier model</div>
            <div className="text-xs" style={{ color: "var(--ink-500)" }}>
              {readiness.daysOfData}d of signal data · {readiness.trainingReady ? "ready" : "collecting"}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
