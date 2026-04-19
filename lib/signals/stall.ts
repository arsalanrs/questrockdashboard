/**
 * Phase 1 stall detectors — signals that can be computed against the current
 * public.loans schema without any new columns.
 *
 * Each detector is a pure function `(loan, ctx) => DealSignal | null`.
 * `ctx` carries derived helpers (latest stage-event, open condition count,
 * fixed clock) so detectors stay simple and testable.
 */

import { differenceInHours, differenceInCalendarDays } from "date-fns";
import type {
  DealSignal,
  SignalLoanRow,
  SignalStageEvent,
  SignalCondition,
  SignalPriority,
} from "./types";
import { SIGNAL_CATEGORY_BY_TYPE } from "./types";

export type DetectorContext = {
  now: Date;
  latestStageEvent: Map<string, SignalStageEvent>;
  latestEventByLoanStage: Map<string, SignalStageEvent>;
  openConditionsByLoan: Map<string, number>;
};

function dedupe(loanId: string, type: string) {
  return `${loanId}:${type}`;
}

function base(
  loan: SignalLoanRow,
  signalType: DealSignal["signalType"],
  priority: SignalPriority,
  reason: string,
  meta: Record<string, unknown>,
  now: Date,
): DealSignal {
  return {
    loanId: loan.id,
    signalType,
    category: SIGNAL_CATEGORY_BY_TYPE[signalType],
    priority,
    reason,
    loUserId: loan.assigned_loan_officer_user_id ?? null,
    loName: loan.assigned_loan_officer_name ?? null,
    computedAt: now.toISOString(),
    dedupeKey: dedupe(loan.id, signalType),
    meta,
  };
}

/** Appraisal ordered AND still not closed AND stage is not funded/closed. */
export function detectPipedNeverClosed(
  loan: SignalLoanRow,
  ctx: DetectorContext,
): DealSignal | null {
  if (!loan.appraisal_ordered_at) return null;
  if (loan.closed_at) return null;
  if (loan.current_stage === "funded") return null;
  // Must be in active pipeline (not already closed/dead)
  const dead = (loan.status_raw ?? "").toLowerCase();
  if (dead.startsWith("denied") || dead.startsWith("withdrawn") || dead === "no sale") {
    return null;
  }

  const orderedAt = new Date(loan.appraisal_ordered_at);
  if (Number.isNaN(orderedAt.getTime())) return null;
  const daysSinceAppraisal = differenceInCalendarDays(ctx.now, orderedAt);
  if (daysSinceAppraisal < 14) return null; // give it 2 weeks before flagging

  const priority: SignalPriority = daysSinceAppraisal >= 60 ? 5 : daysSinceAppraisal >= 30 ? 4 : 3;
  return base(
    loan,
    "piped_never_closed",
    priority,
    `Appraisal ordered ${daysSinceAppraisal}d ago, still not closed`,
    { daysSinceAppraisal },
    ctx.now,
  );
}

/** Application-phase loan with no stage event in > 30 days. */
export function detectAppNoMovement(
  loan: SignalLoanRow,
  ctx: DetectorContext,
): DealSignal | null {
  const STAGES = new Set([
    "application",
    "registered",
    "processing",
    "submission",
    "underwriting",
  ]);
  if (!loan.current_stage || !STAGES.has(loan.current_stage)) return null;
  if (loan.closed_at) return null;

  const lastEvent = ctx.latestStageEvent.get(loan.id);
  const anchor = lastEvent ? new Date(lastEvent.entered_at) : loan.lead_created_at ? new Date(loan.lead_created_at) : null;
  if (!anchor || Number.isNaN(anchor.getTime())) return null;
  const daysStale = differenceInCalendarDays(ctx.now, anchor);
  if (daysStale < 30) return null;

  const priority: SignalPriority = daysStale >= 90 ? 5 : daysStale >= 60 ? 4 : 3;
  return base(
    loan,
    "app_no_movement",
    priority,
    `${loan.current_stage} with no movement ${daysStale}d`,
    { daysStale, stage: loan.current_stage },
    ctx.now,
  );
}

/** status_raw contains "approved" AND not closed AND stale > 30d. */
export function detectApprovedNeverFunded(
  loan: SignalLoanRow,
  ctx: DetectorContext,
): DealSignal | null {
  const status = (loan.status_raw ?? "").toLowerCase();
  if (!status.includes("approved")) return null;
  if (status.startsWith("denied")) return null;
  if (loan.closed_at) return null;
  if (loan.current_stage === "funded") return null;

  const lastEvent = ctx.latestStageEvent.get(loan.id);
  const anchor = lastEvent ? new Date(lastEvent.entered_at) : loan.lead_created_at ? new Date(loan.lead_created_at) : null;
  if (!anchor || Number.isNaN(anchor.getTime())) return null;
  const daysStale = differenceInCalendarDays(ctx.now, anchor);
  if (daysStale < 30) return null;

  return base(
    loan,
    "approved_never_funded",
    daysStale >= 120 ? 5 : 4,
    `Approved ${daysStale}d ago, never funded — AI can surface notes`,
    { daysStale },
    ctx.now,
  );
}

/** current_stage=clear_to_close AND last event > 7 days (should fund quickly after CTC). */
export function detectCtcStall(
  loan: SignalLoanRow,
  ctx: DetectorContext,
): DealSignal | null {
  if (loan.current_stage !== "clear_to_close") return null;
  if (loan.closed_at) return null;

  const anchor = ctx.latestStageEvent.get(loan.id)?.entered_at ?? loan.ctc_at;
  if (!anchor) return null;
  const daysStale = differenceInCalendarDays(ctx.now, new Date(anchor));
  if (daysStale < 7) return null;

  const priority: SignalPriority = daysStale >= 21 ? 5 : daysStale >= 14 ? 4 : 3;
  return base(
    loan,
    "ctc_stall",
    priority,
    `Clear-to-close ${daysStale}d — should have funded, didn't`,
    { daysStale },
    ctx.now,
  );
}

/** esign_out stage AND esign_requested > 3d AND esign_returned is null. */
export function detectEsignStuck(
  loan: SignalLoanRow,
  ctx: DetectorContext,
): DealSignal | null {
  if (loan.current_stage !== "esign_out") return null;
  if (loan.esign_returned_at) return null;

  const anchor = loan.esign_requested_at
    ? new Date(loan.esign_requested_at)
    : ctx.latestEventByLoanStage.get(`${loan.id}:esign_out`)?.entered_at
      ? new Date(ctx.latestEventByLoanStage.get(`${loan.id}:esign_out`)!.entered_at)
      : null;
  if (!anchor || Number.isNaN(anchor.getTime())) return null;

  const hoursStuck = differenceInHours(ctx.now, anchor);
  if (hoursStuck < 72) return null; // 3 days

  const priority: SignalPriority = hoursStuck >= 168 ? 5 : hoursStuck >= 96 ? 4 : 3;
  const daysStuck = Math.floor(hoursStuck / 24);
  return base(
    loan,
    "esign_stuck",
    priority,
    `eSign out ${daysStuck}d, no signed package`,
    { daysStuck, hoursStuck },
    ctx.now,
  );
}

export const STALL_DETECTORS = [
  detectPipedNeverClosed,
  detectAppNoMovement,
  detectApprovedNeverFunded,
  detectCtcStall,
  detectEsignStuck,
] as const;

/** Helper to precompute detector context from raw arrays. */
export function buildDetectorContext(
  events: SignalStageEvent[],
  conditions: SignalCondition[],
  now: Date,
): DetectorContext {
  const latestStageEvent = new Map<string, SignalStageEvent>();
  const latestEventByLoanStage = new Map<string, SignalStageEvent>();

  for (const ev of events) {
    const t = new Date(ev.entered_at).getTime();
    if (Number.isNaN(t)) continue;

    const existing = latestStageEvent.get(ev.loan_id);
    if (!existing || new Date(existing.entered_at).getTime() < t) {
      latestStageEvent.set(ev.loan_id, ev);
    }
    const key = `${ev.loan_id}:${ev.stage}`;
    const existing2 = latestEventByLoanStage.get(key);
    if (!existing2 || new Date(existing2.entered_at).getTime() < t) {
      latestEventByLoanStage.set(key, ev);
    }
  }

  const openConditionsByLoan = new Map<string, number>();
  for (const c of conditions) {
    if (c.status === "open") {
      openConditionsByLoan.set(c.loan_id, (openConditionsByLoan.get(c.loan_id) ?? 0) + 1);
    }
  }

  return { now, latestStageEvent, latestEventByLoanStage, openConditionsByLoan };
}
