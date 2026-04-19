/**
 * Phase 5 outcome labeler.
 *
 * We don't have training data yet — this module populates the training set.
 * Every run scans existing deal_signals (active + dismissed) and decides
 * whether the signal has reached a terminal "outcome" we can learn from.
 *
 * Outcome kinds (write-once, immutable):
 *   closed_within_window   — loan reached funded within OUTCOME_WINDOW_DAYS after signal
 *   dismissed_by_exec      — exec marked dismissed_at on deal_signals
 *   loan_withdrawn_denied  — loan status became denied/withdrawn post-signal
 *   stale_no_movement      — signal > OUTCOME_WINDOW_DAYS old, still open, no movement
 *   resolved_other         — signal auto-dismissed (not by exec) without a close
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** How many days after a signal fires do we look for a win/loss? */
export const OUTCOME_WINDOW_DAYS = 45;

export type OutcomeKind =
  | "closed_within_window"
  | "dismissed_by_exec"
  | "loan_withdrawn_denied"
  | "stale_no_movement"
  | "resolved_other";

type RawSignal = {
  id: string;
  loan_id: string;
  signal_type: string;
  priority: number;
  computed_at: string;
  dismissed_at: string | null;
  dismissed_by: string | null;
};

type RawLoan = {
  id: string;
  current_stage: string | null;
  status_raw: string | null;
  funded_at: string | null;
  closed_at: string | null;
};

export type OutcomeComputation = {
  outcome_kind: OutcomeKind;
  outcome_at: string;
  days_from_signal: number | null;
  loan_stage_at_outcome: string | null;
};

/** Pure function: decide the outcome (if terminal) for a single signal+loan pair. */
export function computeOutcome(
  signal: RawSignal,
  loan: RawLoan,
  now: Date
): OutcomeComputation | null {
  const signalTime = new Date(signal.computed_at).getTime();
  if (Number.isNaN(signalTime)) return null;

  const windowEndMs = signalTime + OUTCOME_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  const fundedAt = loan.funded_at ?? loan.closed_at;
  if (fundedAt) {
    const fundedMs = new Date(fundedAt).getTime();
    if (Number.isFinite(fundedMs) && fundedMs >= signalTime && fundedMs <= windowEndMs) {
      return {
        outcome_kind: "closed_within_window",
        outcome_at: new Date(fundedMs).toISOString(),
        days_from_signal: Math.round((fundedMs - signalTime) / (24 * 60 * 60 * 1000)),
        loan_stage_at_outcome: loan.current_stage,
      };
    }
  }

  const status = (loan.status_raw ?? "").toLowerCase();
  if (status.startsWith("withdrawn") || status.startsWith("denied")) {
    return {
      outcome_kind: "loan_withdrawn_denied",
      outcome_at: now.toISOString(),
      days_from_signal: Math.round((now.getTime() - signalTime) / (24 * 60 * 60 * 1000)),
      loan_stage_at_outcome: loan.current_stage,
    };
  }

  if (signal.dismissed_at) {
    if (signal.dismissed_by) {
      return {
        outcome_kind: "dismissed_by_exec",
        outcome_at: signal.dismissed_at,
        days_from_signal: Math.round(
          (new Date(signal.dismissed_at).getTime() - signalTime) / (24 * 60 * 60 * 1000)
        ),
        loan_stage_at_outcome: loan.current_stage,
      };
    }
    return {
      outcome_kind: "resolved_other",
      outcome_at: signal.dismissed_at,
      days_from_signal: Math.round(
        (new Date(signal.dismissed_at).getTime() - signalTime) / (24 * 60 * 60 * 1000)
      ),
      loan_stage_at_outcome: loan.current_stage,
    };
  }

  if (now.getTime() > windowEndMs) {
    return {
      outcome_kind: "stale_no_movement",
      outcome_at: new Date(windowEndMs).toISOString(),
      days_from_signal: OUTCOME_WINDOW_DAYS,
      loan_stage_at_outcome: loan.current_stage,
    };
  }

  return null; // not yet terminal
}

/**
 * Scan deal_signals without a recorded outcome, compute outcomes where possible,
 * and insert into signal_outcomes. Returns a summary of what it labeled.
 */
export async function runOutcomeLabeler(
  admin: SupabaseClient,
  now: Date = new Date()
): Promise<{ scanned: number; labeled: number; byKind: Record<OutcomeKind, number> }> {
  const { data: existing, error: exErr } = await admin
    .from("signal_outcomes")
    .select("signal_id");
  if (exErr) throw exErr;
  const alreadyLabeled = new Set((existing ?? []).map((r) => r.signal_id as string));

  const { data: signals, error: sigErr } = await admin
    .from("deal_signals")
    .select("id,loan_id,signal_type,priority,computed_at,dismissed_at,dismissed_by");
  if (sigErr) throw sigErr;
  const candidates = ((signals ?? []) as RawSignal[]).filter((s) => !alreadyLabeled.has(s.id));

  if (candidates.length === 0) {
    return { scanned: 0, labeled: 0, byKind: emptyByKind() };
  }

  const loanIds = Array.from(new Set(candidates.map((s) => s.loan_id)));
  const loanMap = new Map<string, RawLoan>();
  const BATCH = 500;
  for (let i = 0; i < loanIds.length; i += BATCH) {
    const chunk = loanIds.slice(i, i + BATCH);
    const { data, error } = await admin
      .from("loans")
      .select("id,current_stage,status_raw,funded_at,closed_at")
      .in("id", chunk);
    if (error) throw error;
    (data ?? []).forEach((l) => loanMap.set(l.id as string, l as unknown as RawLoan));
  }

  const rows: Array<{
    signal_id: string;
    loan_id: string;
    signal_type: string;
    priority: number;
    outcome_kind: OutcomeKind;
    outcome_at: string;
    days_from_signal: number | null;
    loan_stage_at_outcome: string | null;
  }> = [];
  const byKind = emptyByKind();

  for (const s of candidates) {
    const loan = loanMap.get(s.loan_id);
    if (!loan) continue;
    const o = computeOutcome(s, loan, now);
    if (!o) continue;
    rows.push({
      signal_id: s.id,
      loan_id: s.loan_id,
      signal_type: s.signal_type,
      priority: s.priority,
      outcome_kind: o.outcome_kind,
      outcome_at: o.outcome_at,
      days_from_signal: o.days_from_signal,
      loan_stage_at_outcome: o.loan_stage_at_outcome,
    });
    byKind[o.outcome_kind] += 1;
  }

  if (rows.length === 0) {
    return { scanned: candidates.length, labeled: 0, byKind };
  }

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await admin.from("signal_outcomes").insert(chunk);
    if (error) throw error;
  }

  return { scanned: candidates.length, labeled: rows.length, byKind };
}

function emptyByKind(): Record<OutcomeKind, number> {
  return {
    closed_within_window: 0,
    dismissed_by_exec: 0,
    loan_withdrawn_denied: 0,
    stale_no_movement: 0,
    resolved_other: 0,
  };
}
