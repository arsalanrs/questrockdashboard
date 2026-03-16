"use client";

import { useMemo, useState, useCallback } from "react";
import { cn } from "@/lib/cn";
import { MICRO_STAGES, DOC_CHECKLISTS, type MicroStageKey } from "@/lib/loan-status-groups";

const SHAPE_BASE = "https://secure.setshape.com/prospects/";
const LENDING_PAD_URL = "https://prod.lendingpad.com/questrock-llc/login";
const TEAMS_URL = "https://teams.microsoft.com";

export type MicroLoan = {
  id: string;
  shape_record_id: number | null;
  borrower_first_name: string | null;
  borrower_last_name: string | null;
  status_raw: string | null;
  loan_type: string | null;
  loan_amount_cents: number | null;
  lead_created_at: string | null;
  closing_date: string | null;
};

type StageData = {
  key: MicroStageKey;
  label: string;
  turnTime: string;
  count: number;
  volume: number;
  loans: MicroLoan[];
  instructions: string;
  nextAction: string;
};

function borrowerName(l: MicroLoan) {
  return [l.borrower_first_name, l.borrower_last_name].filter(Boolean).join(" ") || "—";
}

function fmt$(cents: number | null) {
  if (!cents) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

export function MicroPipeline({ loansByMicro }: { loansByMicro: Map<MicroStageKey, MicroLoan[]> }) {
  const [expandedStage, setExpandedStage] = useState<MicroStageKey | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelLoan, setPanelLoan] = useState<MicroLoan | null>(null);

  const stageData: StageData[] = useMemo(
    () =>
      MICRO_STAGES.map((s) => {
        const loans = loansByMicro.get(s.key) ?? [];
        return {
          key: s.key,
          label: s.label,
          turnTime: s.turnTime,
          count: loans.length,
          volume: loans.reduce((acc, l) => acc + (l.loan_amount_cents ?? 0), 0),
          loans,
          instructions: s.instructions,
          nextAction: s.nextAction,
        };
      }),
    [loansByMicro],
  );

  const toggleStage = useCallback((key: MicroStageKey) => {
    setExpandedStage((prev) => (prev === key ? null : key));
  }, []);

  const openLoanPanel = useCallback((loan: MicroLoan) => {
    setPanelLoan(loan);
    setPanelOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setPanelLoan(null);
  }, []);

  const expandedData = stageData.find((s) => s.key === expandedStage);
  const docChecklist = expandedStage ? DOC_CHECKLISTS[expandedStage] : null;

  return (
    <>
      <div className="space-y-3">
        {/* chevron row */}
        <div className="flex items-center overflow-x-auto pb-2">
          {stageData.map((s, i) => (
            <div key={s.key} className="contents">
              <button
                onClick={() => toggleStage(s.key)}
                className="flex min-w-[100px] flex-1 flex-col items-center rounded-lg border px-2 py-3 text-center transition-all duration-200"
              style={
                expandedStage === s.key
                  ? { border: "1px solid #E8FF00", background: "rgba(232,255,0,0.07)", backdropFilter: "blur(12px)" }
                  : s.count > 0
                    ? { border: "1px solid rgba(232,255,0,0.20)", background: "rgba(255,255,255,0.03)", backdropFilter: "blur(12px)" }
                    : { border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)", backdropFilter: "blur(12px)" }
              }
              >
                <div className="text-[11px] font-semibold text-foreground">{s.label}</div>
                <div className="mt-1 text-xl font-bold tabular-nums"
                  style={s.count > 0 ? { color: "#E8FF00" } : undefined}>{s.count}</div>
                <div className="mt-0.5 text-[10px] text-mutedForeground tabular-nums">{fmt$(s.volume)}</div>
                <div className="mt-1 text-[10px] leading-tight text-mutedForeground">{s.turnTime}</div>
              </button>
              {i < stageData.length - 1 && (
                <svg className="mx-1 h-5 w-5 shrink-0 text-mutedForeground/40" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
                </svg>
              )}
            </div>
          ))}
        </div>

        {/* expanded detail */}
        {expandedData && (
          <div className="rounded-xl overflow-hidden"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" }}>
            <div className="border-b px-4 py-3"
              style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.07)" }}>
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold" style={{ color: "#E8FF00" }}>{expandedData.label}</h4>
                <span className="text-xs text-mutedForeground">{expandedData.count} loan{expandedData.count !== 1 ? "s" : ""} &middot; {fmt$(expandedData.volume)}</span>
              </div>
              <p className="mt-1 text-xs text-mutedForeground">{expandedData.instructions}</p>
              <p className="mt-1 text-xs font-medium" style={{ color: "rgba(232,255,0,0.7)" }}>Next: {expandedData.nextAction}</p>
            </div>

            {/* doc checklist */}
            {docChecklist && (
              <div className="border-b border-border/40 px-4 py-3">
                <h5 className="text-xs font-semibold text-foreground">{docChecklist.title}</h5>
                <ul className="mt-1.5 space-y-1">
                  {docChecklist.items.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-xs text-mutedForeground">
                      <span className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border border-border/60" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* loans table */}
            {expandedData.loans.length > 0 ? (
              <div className="max-h-[300px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0"
                    style={{ background: "rgba(255,255,255,0.05)" }}>
                    <tr className="text-left text-[11px] uppercase tracking-widest text-mutedForeground">
                      <th className="px-3 py-2">Borrower</th>
                      <th className="px-3 py-2">Shape Status</th>
                      <th className="px-3 py-2">Loan Type</th>
                      <th className="px-3 py-2">Amount</th>
                      <th className="px-3 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {expandedData.loans.map((l) => (
                      <tr key={l.id} className="transition-colors hover:bg-muted/20">
                        <td className="px-3 py-2 font-medium">{borrowerName(l)}</td>
                        <td className="px-3 py-2 text-xs text-mutedForeground">{l.status_raw}</td>
                        <td className="px-3 py-2 text-xs text-mutedForeground">{l.loan_type ?? "—"}</td>
                        <td className="px-3 py-2 tabular-nums">{fmt$(l.loan_amount_cents)}</td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1.5">
                            {l.shape_record_id && (
                              <a href={`${SHAPE_BASE}${l.shape_record_id}/edit`} target="_blank" rel="noopener noreferrer"
                                className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] transition-colors hover:border-[#E8FF00]/40 hover:text-[#E8FF00]">Shape</a>
                            )}
                            <a href={LENDING_PAD_URL} target="_blank" rel="noopener noreferrer"
                              className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] transition-colors hover:border-[#E8FF00]/40 hover:text-[#E8FF00]">LP</a>
                            <a href={TEAMS_URL} target="_blank" rel="noopener noreferrer"
                              className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] transition-colors hover:border-[#E8FF00]/40 hover:text-[#E8FF00]">Teams</a>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-4 py-6 text-center text-sm text-mutedForeground">No loans in this stage.</div>
            )}
          </div>
        )}
      </div>

      {/* Loan detail panel */}
      <div
        className={cn(
          "fixed left-0 top-0 z-50 h-full w-full max-w-xl border-r border-border/50 shadow-2xl transition-transform duration-200 ease-out",
          panelOpen ? "translate-x-0" : "-translate-x-full",
        )}
        style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" }}
        aria-hidden={!panelOpen}
      >
        {panelLoan && (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b px-4 py-3"
              style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.08)" }}>
              <h2 className="text-sm font-semibold" style={{ color: "#E8FF00" }}>{borrowerName(panelLoan)}</h2>
              <button type="button" onClick={closePanel} className="rounded-lg p-1.5 transition-colors hover:bg-muted/50">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 text-sm space-y-3">
              <div className="text-mutedForeground">Status: <span className="font-medium text-foreground">{panelLoan.status_raw}</span></div>
              <div className="text-mutedForeground">Loan Type: <span className="font-medium text-foreground">{panelLoan.loan_type ?? "—"}</span></div>
              <div className="text-mutedForeground">Amount: <span className="font-semibold" style={{ color: "#E8FF00" }}>{fmt$(panelLoan.loan_amount_cents)}</span></div>
              <div className="flex flex-wrap gap-2 pt-2">
                {panelLoan.shape_record_id && (
                  <a href={`${SHAPE_BASE}${panelLoan.shape_record_id}/edit`} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium transition-all hover:border-[#E8FF00]/40 hover:text-[#E8FF00]">
                    Open in Shape
                  </a>
                )}
                <a href={LENDING_PAD_URL} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium transition-all hover:border-[#E8FF00]/40 hover:text-[#E8FF00]">
                  LendingPad
                </a>
                <a href={TEAMS_URL} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium transition-all hover:border-[#E8FF00]/40 hover:text-[#E8FF00]">
                  Teams
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
      {panelOpen && (
        <button type="button" className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={closePanel} aria-label="Close panel" />
      )}
    </>
  );
}
