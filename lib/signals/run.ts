/**
 * Signal-engine orchestrator.
 *
 * `computeSignalsForLoans` runs every detector over the input set and returns
 * a priority-ranked list of DealSignal objects. The function is pure — it does
 * not touch the DB. Callers (the admin sync job / the executive page loader /
 * the signals-dry-run script) are responsible for fetching loans + events +
 * conditions and persisting / rendering the output.
 */

import type {
  DealSignal,
  SignalEngineInput,
  SignalLoanRow,
} from "./types";
import { buildDetectorContext, STALL_DETECTORS, type DetectorContext } from "./stall";
import { buildRefiContext, REFI_DETECTORS, type RefiContext } from "./refi";

export type SignalDetector = (loan: SignalLoanRow, ctx: DetectorContext) => DealSignal | null;
export type RefiDetector = (loan: SignalLoanRow, ctx: RefiContext) => DealSignal | null;

export function computeSignalsForLoans(input: SignalEngineInput): DealSignal[] {
  const now = input.now ?? new Date();
  const stallCtx = buildDetectorContext(input.events ?? [], input.conditions ?? [], now);
  const refiCtx = buildRefiContext(input.marketRates ?? [], now);
  const out: DealSignal[] = [];

  for (const loan of input.loans) {
    for (const detector of STALL_DETECTORS) {
      const sig = detector(loan, stallCtx);
      if (sig) out.push(sig);
    }
    for (const detector of REFI_DETECTORS) {
      const sig = detector(loan, refiCtx);
      if (sig) out.push(sig);
    }
  }

  return rankSignals(out);
}

/** Higher priority first; within priority, newer stall first. */
export function rankSignals(signals: DealSignal[]): DealSignal[] {
  return [...signals].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    // tiebreak: larger loan first if available
    const amA = (a.meta?.loanAmountCents as number | undefined) ?? 0;
    const amB = (b.meta?.loanAmountCents as number | undefined) ?? 0;
    if (amA !== amB) return amB - amA;
    return a.dedupeKey.localeCompare(b.dedupeKey);
  });
}

/** Count signals grouped by LO — useful for the exec "Per-LO deal scoring" card. */
export function groupSignalsByLO(signals: DealSignal[]) {
  const map = new Map<string, { loUserId: string | null; loName: string; count: number; byType: Record<string, number> }>();
  for (const s of signals) {
    const key = s.loUserId ?? s.loName ?? "unassigned";
    const label = s.loName ?? "Unassigned";
    const existing = map.get(key) ?? { loUserId: s.loUserId, loName: label, count: 0, byType: {} };
    existing.count += 1;
    existing.byType[s.signalType] = (existing.byType[s.signalType] ?? 0) + 1;
    map.set(key, existing);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/** Group by signal type — used for the Opportunity list cards. */
export function groupSignalsByType(signals: DealSignal[]) {
  const map = new Map<string, DealSignal[]>();
  for (const s of signals) {
    const arr = map.get(s.signalType) ?? [];
    arr.push(s);
    map.set(s.signalType, arr);
  }
  return map;
}
