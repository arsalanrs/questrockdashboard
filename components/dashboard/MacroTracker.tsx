"use client";

import { cn } from "@/lib/cn";

type MacroStep = {
  label: string;
  count: number;
  volume: number;
};

function fmt$(cents: number) {
  if (!cents) return "$0";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

export function MacroTracker({ steps }: { steps: MacroStep[] }) {
  const total = steps.reduce((s, st) => s + st.count, 0);

  return (
    <div className="flex items-stretch gap-0 overflow-x-auto pb-1">
      {steps.map((step, i) => (
        <div key={step.label} className="contents">
          <div
            className={cn(
              "flex min-w-[140px] flex-1 flex-col items-center justify-center rounded-lg border px-3 py-3 text-center transition-all duration-200",
              step.count > 0
                ? "border-[#E8FF00]/30"
                : "border-border/50",
            )}
            style={
              step.count > 0
                ? { background: "rgba(232,255,0,0.06)", border: "1px solid rgba(232,255,0,0.20)", backdropFilter: "blur(12px)" }
                : { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", backdropFilter: "blur(12px)" }
            }
          >
            <div className="text-[10px] font-bold uppercase tracking-widest text-mutedForeground">{step.label}</div>
            <div
              className="mt-1 text-2xl font-bold tabular-nums"
              style={step.count > 0 ? { color: "#E8FF00" } : undefined}
            >{step.count}</div>
            <div className="mt-0.5 text-[11px] text-mutedForeground tabular-nums">{fmt$(step.volume)}</div>
          </div>
          {i < steps.length - 1 && (
            <div className="flex items-center px-1">
              <svg className="h-5 w-5 shrink-0 text-mutedForeground/50" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
              </svg>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
