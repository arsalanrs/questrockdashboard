"use client";

import { SparkLine } from "@/components/charts/SparkLine";

type KpiItem = {
  key: string;
  label: string;
  value: string;
  tone: "c-green" | "c-gold" | "c-red" | "c-blue";
  icon: string;
  trend?: { dir: "up" | "down"; text: string };
  spark: number[];
  sparkColor: string;
};

export function ExecKpiStrip({ items }: { items: KpiItem[] }) {
  return (
    <div className="exec-kpi-row">
      {items.map((k) => (
        <div key={k.key} className={`exec-kpi-card ${k.tone}`}>
          <div className="exec-kpi-top">
            <div className="exec-kpi-icon" aria-hidden>{k.icon}</div>
            {k.trend && (
              <div className={`exec-kpi-trend ${k.trend.dir}`}>
                {k.trend.dir === "up" ? "↗" : "↘"} {k.trend.text}
              </div>
            )}
          </div>
          <p className="exec-kpi-label">{k.label}</p>
          <p className="exec-kpi-value">{k.value}</p>
          <div className="exec-kpi-spark">
            <SparkLine data={k.spark} color={k.sparkColor} height={30} />
          </div>
        </div>
      ))}
    </div>
  );
}
