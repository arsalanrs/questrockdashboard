"use client";

import { cn } from "@/lib/cn";

export type SummaryFocus = "hotLeads" | "greenLeads" | "pipeline" | "alerts" | null;

type Props = {
  hotCount: number;
  greenCount: number;
  pipelineCount: number;
  alertCount: number;
  activeFocus: SummaryFocus;
  onFocus: (focus: SummaryFocus) => void;
};

export function SummaryStrip({ hotCount, greenCount, pipelineCount, alertCount, activeFocus, onFocus }: Props) {
  const tiles: Array<{ key: SummaryFocus; label: string; count: number }> = [
    { key: "hotLeads", label: "Hot Leads", count: hotCount },
    { key: "greenLeads", label: "Green Leads", count: greenCount },
    { key: "pipeline", label: "Pipeline", count: pipelineCount },
    { key: "alerts", label: "SLA Alerts", count: alertCount },
  ];

  return (
    <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {tiles.map((tile) => (
        <button
          key={tile.key}
          type="button"
          onClick={() => onFocus(activeFocus === tile.key ? null : tile.key)}
          className={cn(
            "rounded-xl border px-4 py-4 text-left transition-all hover:-translate-y-0.5",
            activeFocus === tile.key
              ? "border-[#087f7a]/60 shadow-lg"
              : "border-white/10 hover:border-[#087f7a]/40",
          )}
          style={{ background: "rgba(255,255,255,0.03)" }}
        >
          <span className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">{tile.label}</span>
          <strong className="mt-2 block text-3xl font-bold tabular-nums text-foreground">{tile.count}</strong>
        </button>
      ))}
    </section>
  );
}
