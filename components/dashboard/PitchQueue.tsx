"use client";

import { useMemo, useState, useCallback } from "react";
import { cn } from "@/lib/cn";

const SHAPE_BASE = "https://secure.setshape.com/prospects/";
const LENDING_PAD_URL = "https://prod.lendingpad.com/questrock-llc/login";
const TEAMS_URL = "https://teams.microsoft.com";

export type PitchQueueLoan = {
  id: string;
  shape_record_id: number | null;
  borrower_first_name: string | null;
  borrower_last_name: string | null;
  status_raw: string | null;
  loan_type: string | null;
  loan_amount_cents: number | null;
  lead_created_at: string | null;
};

function borrowerName(l: PitchQueueLoan) {
  return [l.borrower_first_name, l.borrower_last_name].filter(Boolean).join(" ") || "—";
}

function daysAgo(dateStr: string | null) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function fmt$(cents: number | null) {
  if (!cents) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

export function PitchQueue({ loans }: { loans: PitchQueueLoan[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const byStatus = useMemo(() => {
    const m = new Map<string, PitchQueueLoan[]>();
    for (const l of loans) {
      const s = l.status_raw ?? "(no status)";
      if (!m.has(s)) m.set(s, []);
      m.get(s)!.push(l);
    }
    return Array.from(m.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [loans]);

  const panelLoans = useMemo(
    () => (selected ? loans.filter((l) => (l.status_raw ?? "(no status)") === selected) : []),
    [selected, loans],
  );

  const openPanel = useCallback((status: string) => {
    setSelected(status);
    setPanelOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setSelected(null);
  }, []);

  if (loans.length === 0) return null;

  return (
    <>
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Pitch Queue</h3>
            <p className="text-xs text-mutedForeground">
              Leads ready to be pitched — pre-application completed through prep package out.
            </p>
          </div>
          <span className="text-xl font-bold tabular-nums">{loans.length}</span>
        </div>

        <div className="flex flex-wrap gap-2">
          {byStatus.map(([status, statusLoans]) => (
            <button
              key={status}
              onClick={() => openPanel(status)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                selected === status
                  ? "border-foreground bg-foreground/5"
                  : "border-border bg-card hover:border-foreground/30",
              )}
            >
              {status}
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">{statusLoans.length}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Side panel */}
      <div
        className={cn(
          "fixed left-0 top-0 z-50 h-full w-full max-w-xl border-r border-border bg-card shadow-xl transition-transform duration-200 ease-out",
          panelOpen ? "translate-x-0" : "-translate-x-full",
        )}
        aria-hidden={!panelOpen}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Pitch Queue — {selected}</h2>
            <button type="button" onClick={closePanel} className="rounded p-1 hover:bg-muted">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3">
            <ul className="space-y-2">
              {panelLoans.map((l) => (
                <li key={l.id} className="rounded-lg border border-border px-3 py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{borrowerName(l)}</span>
                    <span className="text-xs text-mutedForeground">{l.loan_type ?? "—"}</span>
                  </div>
                  <div className="mt-1 flex gap-4 text-xs text-mutedForeground">
                    <span>{fmt$(l.loan_amount_cents)}</span>
                    {l.lead_created_at && <span>{daysAgo(l.lead_created_at)}d ago</span>}
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {l.shape_record_id && (
                      <a href={`${SHAPE_BASE}${l.shape_record_id}/edit`} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted transition-colors">
                        Open in Shape
                      </a>
                    )}
                    <a href={LENDING_PAD_URL} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted transition-colors">
                      LendingPad
                    </a>
                    <a href={TEAMS_URL} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted transition-colors">
                      Teams
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      {panelOpen && (
        <button type="button" className="fixed inset-0 z-40 bg-black/30" onClick={closePanel} aria-label="Close panel" />
      )}
    </>
  );
}
