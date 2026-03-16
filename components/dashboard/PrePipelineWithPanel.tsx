"use client";

import { useCallback, useMemo, useState } from "react";
import { cn } from "@/lib/cn";

export type PrePipelineLoan = {
  id: string;
  shape_record_id: number | null;
  borrower_first_name: string | null;
  borrower_last_name: string | null;
  current_stage: string | null;
  status_raw: string | null;
  loan_type: string | null;
  record_type: string | null;
  open_conditions_count: number;
  days_in_stage: number | null;
  sla_exceeded: boolean;
};

type Props = {
  loans: PrePipelineLoan[];
  stageLabels: Record<string, string>;
};

function stageDisplayKey(stage: string | null): string {
  return stage ?? "no_stage";
}

export function PrePipelineWithPanel({ loans, stageLabels }: Props) {
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const byStage = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of loans) {
      const key = stageDisplayKey(l.current_stage);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [loans]);

  const stageEntries = useMemo(
    () =>
      Array.from(byStage.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([stage, count]) => ({
          stage,
          count,
          label: stageLabels[stage] ?? stage,
        })),
    [byStage, stageLabels]
  );

  const loansInStage = useMemo(() => {
    if (!selectedStage) return [];
    return loans.filter((l) => stageDisplayKey(l.current_stage) === selectedStage);
  }, [loans, selectedStage]);

  const openPanel = useCallback((stage: string) => {
    setSelectedStage(stage);
    setPanelOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setSelectedStage(null);
  }, []);

  const selectedLabel = selectedStage ? (stageLabels[selectedStage] ?? selectedStage) : "";

  if (loans.length === 0) return null;

  return (
    <>
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Pre-Pipeline</div>
            <p className="mt-0.5 text-xs text-mutedForeground">
              Files not yet in a pipeline stage — leads, applications, and pre-approval files. Click a stage to see files.
            </p>
          </div>
          <div className="text-2xl font-bold">{loans.length}</div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {stageEntries.map(({ stage, count, label }) => (
            <button
              key={stage}
              type="button"
              onClick={() => openPanel(stage)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs transition-colors",
                "hover:bg-muted/80 hover:border-primary/30",
                selectedStage === stage && "border-primary bg-primary/10"
              )}
            >
              <span className="font-medium">{label}</span>
              <span className="text-mutedForeground">{count}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Left side panel */}
      <div
        className={cn(
          "fixed left-0 top-0 z-50 h-full w-full max-w-xl border-r border-border bg-card shadow-xl transition-transform duration-200 ease-out",
          panelOpen ? "translate-x-0" : "-translate-x-full"
        )}
        aria-hidden={!panelOpen}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">
              Pre-Pipeline — {selectedLabel}
            </h2>
            <button
              type="button"
              onClick={closePanel}
              className="rounded p-2 text-mutedForeground hover:bg-muted hover:text-foreground"
              aria-label="Close panel"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3">
            <ul className="space-y-2">
              {loansInStage.map((l) => (
                <li
                  key={l.id}
                  className={cn(
                    "rounded-lg border px-3 py-2.5 text-sm",
                    l.sla_exceeded ? "border-amber-500/50 bg-amber-500/5" : "border-border bg-muted/30"
                  )}
                >
                  <div className="font-medium">
                    {[l.borrower_first_name, l.borrower_last_name].filter(Boolean).join(" ") || "—"}
                  </div>
                  <div className="mt-1.5 space-y-1 text-xs text-mutedForeground">
                    {l.status_raw ? (
                      <div>
                        <span className="font-medium text-foreground/80">Status: </span>
                        {l.status_raw}
                      </div>
                    ) : null}
                    {l.open_conditions_count > 0 ? (
                      <div>
                        <span className="font-medium text-foreground/80">Open conditions: </span>
                        {l.open_conditions_count}
                      </div>
                    ) : null}
                    {l.days_in_stage != null ? (
                      <div>
                        <span className="font-medium text-foreground/80">Days in stage: </span>
                        {l.days_in_stage}
                        {l.sla_exceeded ? " (overdue)" : ""}
                      </div>
                    ) : null}
                    <div className="flex flex-wrap gap-x-2 gap-y-0 pt-0.5">
                      {l.loan_type ? <span>{l.loan_type}</span> : null}
                      {l.record_type ? <span>{l.record_type}</span> : null}
                      {l.shape_record_id ? <span className="font-mono">#{l.shape_record_id}</span> : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {loansInStage.length === 0 && (
              <p className="text-sm text-mutedForeground">No files in this stage.</p>
            )}
          </div>
        </div>
      </div>

      {/* Backdrop when panel open */}
      {panelOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/30"
          onClick={closePanel}
          aria-label="Close panel"
        />
      )}
    </>
  );
}
