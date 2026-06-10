/**
 * Lead-tier and retention detectors (RED/ORANGE/GREEN intelligence, no scrapers).
 * Book cadence aligns with Quest Rock CEO rules (6/12 mo, skip payment, FHA prep, ARM period).
 */

import { differenceInCalendarDays, differenceInCalendarMonths } from "date-fns";

import {
  FHA_SEASONING_PREP_CENTER_DAYS,
  FHA_SEASONING_PREP_WINDOW_DAYS,
  closeAnchorDate,
  daysSinceFhaSeasoningAnchor,
  daysSinceClose,
  fhaSeasoningAnchorDate,
  isFhaLoan,
  mergeMetaWithSoftTags,
  monthsSinceClose,
  shouldSuppressGenericBookOutreach,
  skipPaymentScheduledDate,
} from "./book-outreach-policy";
import { classifyLoanTier } from "./tier-classifier";
import type { DealSignal, SignalLoanRow, SignalPriority } from "./types";
import { SIGNAL_CATEGORY_BY_TYPE } from "./types";
import { isFundedBackBookLoan } from "./refi";
import type { DetectorContext } from "./stall";

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
    meta: mergeMetaWithSoftTags(loan, meta),
  };
}

/** Lead aged 3+ days with no last_contacted_at. */
export function detectNeverContacted(loan: SignalLoanRow, ctx: DetectorContext): DealSignal | null {
  if (loan.do_not_contact === true) return null;
  if (loan.last_contacted_at) return null;
  if (classifyLoanTier(loan) !== "RED") return null;
  const anchor = loan.lead_created_at ? new Date(loan.lead_created_at) : null;
  if (!anchor || Number.isNaN(anchor.getTime())) return null;
  const days = differenceInCalendarDays(ctx.now, anchor);
  if (days < 3) return null;
  return base(
    loan,
    "never_contacted",
    days >= 21 ? 4 : 3,
    `No contact logged — lead is ${days}d old`,
    { daysSinceLead: days },
    ctx.now,
  );
}

/** RED tier early funnel emphasis. */
export function detectPreSignature(loan: SignalLoanRow, ctx: DetectorContext): DealSignal | null {
  if (loan.do_not_contact === true) return null;
  if (classifyLoanTier(loan) !== "RED") return null;
  const stage = loan.current_stage ?? "";
  if (!["lead", "application", "verification", "esign_out", ""].includes(stage)) return null;
  return base(
    loan,
    "pre_signature",
    2,
    "Pre-signature funnel — prioritize outreach or disqualify",
    { stage: stage || null, status_raw: loan.status_raw },
    ctx.now,
  );
}

/** Package / e-sign stage but not advancing toward close. */
export function detectPackagedNotClosed(loan: SignalLoanRow, ctx: DetectorContext): DealSignal | null {
  if (loan.closed_at || loan.current_stage === "funded") return null;
  const raw = loan.status_raw ?? "";
  const packaged = new Set([
    "Package Out",
    "Package Back",
    "Package Signed Not Piped",
    "Pitched - Prep Package Out",
    "Contract Received",
  ]);
  if (!packaged.has(raw) && loan.current_stage !== "esign_out") return null;

  const anchor = loan.lead_created_at ? new Date(loan.lead_created_at) : ctx.latestStageEvent.get(loan.id)?.entered_at
    ? new Date(ctx.latestStageEvent.get(loan.id)!.entered_at)
    : null;
  if (!anchor || Number.isNaN(anchor.getTime())) return null;
  const days = differenceInCalendarDays(ctx.now, anchor);
  if (days < 14) return null;

  return base(
    loan,
    "packaged_not_closed",
    days >= 45 ? 4 : 3,
    `Packaged / e-sign stage ${days}d — still not closed`,
    { daysPackaged: days, status_raw: raw },
    ctx.now,
  );
}

/** CTC longer than stall detector (45d+) — label as expired window. */
export function detectCtcExpired(loan: SignalLoanRow, ctx: DetectorContext): DealSignal | null {
  if (loan.current_stage !== "clear_to_close") return null;
  if (loan.closed_at) return null;
  const anchor = ctx.latestStageEvent.get(loan.id)?.entered_at ?? loan.ctc_at;
  if (!anchor) return null;
  const daysStale = differenceInCalendarDays(ctx.now, new Date(anchor));
  if (daysStale < 45) return null;
  return base(
    loan,
    "ctc_expired",
    5,
    `CTC stage ${daysStale}d — expired / rescue`,
    { daysStale },
    ctx.now,
  );
}

/** Appraisal ordered but not received, 30+ days. */
export function detectAppraisalOrderedStalled(
  loan: SignalLoanRow,
  ctx: DetectorContext,
): DealSignal | null {
  if (!loan.appraisal_ordered_at) return null;
  if (loan.appraisal_received_at) return null;
  if (loan.closed_at || loan.current_stage === "funded") return null;
  const ordered = new Date(loan.appraisal_ordered_at);
  if (Number.isNaN(ordered.getTime())) return null;
  const days = differenceInCalendarDays(ctx.now, ordered);
  if (days < 30) return null;
  return base(
    loan,
    "appraisal_ordered_stalled",
    days >= 60 ? 5 : 4,
    `Appraisal ordered ${days}d ago, not received`,
    { daysSinceOrdered: days },
    ctx.now,
  );
}

/** Funded book ~6 months — relationship check-in (CEO cadence). */
export function detectBookCheckin6m(loan: SignalLoanRow, ctx: DetectorContext): DealSignal | null {
  if (!isFundedBackBookLoan(loan)) return null;
  if (loan.do_not_contact === true) return null;
  if (shouldSuppressGenericBookOutreach(loan, ctx.now)) return null;
  const mos = monthsSinceClose(loan, ctx.now);
  if (mos == null || mos < 5 || mos > 7) return null;
  const closeRaw = loan.closing_date ?? loan.funded_at ?? loan.closed_at;
  return base(
    loan,
    "book_checkin_6m",
    3,
    `~6 months since close — book check-in`,
    { closingDate: closeRaw, monthsSinceClose: mos, checkInKind: "6m" },
    ctx.now,
  );
}

/** Funded book ~12 months — relationship check-in. */
export function detectBookCheckin12m(loan: SignalLoanRow, ctx: DetectorContext): DealSignal | null {
  if (!isFundedBackBookLoan(loan)) return null;
  if (loan.do_not_contact === true) return null;
  if (shouldSuppressGenericBookOutreach(loan, ctx.now)) return null;
  const mos = monthsSinceClose(loan, ctx.now);
  if (mos == null || mos < 11 || mos > 13) return null;
  const closeRaw = loan.closing_date ?? loan.funded_at ?? loan.closed_at;
  return base(
    loan,
    "book_checkin_12m",
    4,
    `~12 months since close — book check-in`,
    { closingDate: closeRaw, monthsSinceClose: mos, checkInKind: "12m" },
    ctx.now,
  );
}

/**
 * Month-1 skip payment / referral: target first day of month after closing month,
 * within ±7 days of that date; only while still in first ~2 months after close.
 */
export function detectPostCloseSkipPaymentDue(loan: SignalLoanRow, ctx: DetectorContext): DealSignal | null {
  if (!isFundedBackBookLoan(loan)) return null;
  if (loan.do_not_contact === true) return null;
  const close = closeAnchorDate(loan);
  if (!close) return null;
  const mos = monthsSinceClose(loan, ctx.now);
  if (mos == null || mos >= 2) return null;
  const scheduled = skipPaymentScheduledDate(close);
  const daysFrom = differenceInCalendarDays(ctx.now, scheduled);
  if (daysFrom < -7 || daysFrom > 14) return null;
  return base(
    loan,
    "post_close_skip_payment_due",
    4,
    `Skip payment / referral call — due near ${scheduled.toISOString().slice(0, 10)}`,
    {
      scheduledCallDate: scheduled.toISOString().slice(0, 10),
      daysFromScheduled: daysFrom,
    },
    ctx.now,
  );
}

/** First payment date ±3 days — payment logistics touchpoint. */
export function detectFirstPaymentTouch(loan: SignalLoanRow, ctx: DetectorContext): DealSignal | null {
  if (!isFundedBackBookLoan(loan)) return null;
  if (loan.do_not_contact === true) return null;
  const raw = loan.first_payment_date;
  if (!raw) return null;
  const fp = new Date(raw);
  if (Number.isNaN(fp.getTime())) return null;
  const days = Math.abs(differenceInCalendarDays(fp, ctx.now));
  if (days > 3) return null;
  return base(
    loan,
    "first_payment_touch",
    4,
    `First payment date ${raw} — check-in on how to pay / questions`,
    { firstPaymentDate: raw, daysFromFirstPayment: differenceInCalendarDays(ctx.now, fp) },
    ctx.now,
  );
}

/** FHA ~180d prep call (not a refi close yet). */
export function detectFhaSeasoningPrep(loan: SignalLoanRow, ctx: DetectorContext): DealSignal | null {
  if (!isFundedBackBookLoan(loan)) return null;
  if (!isFhaLoan(loan)) return null;
  if (loan.do_not_contact === true) return null;
  const days = daysSinceFhaSeasoningAnchor(loan, ctx.now);
  if (days == null) return null;
  const lo = FHA_SEASONING_PREP_CENTER_DAYS - FHA_SEASONING_PREP_WINDOW_DAYS;
  const hi = FHA_SEASONING_PREP_CENTER_DAYS + FHA_SEASONING_PREP_WINDOW_DAYS;
  if (days < lo || days > hi) return null;
  return base(
    loan,
    "fha_seasoning_prep",
    3,
    `FHA ~180d — start refi conversation (210d seasoning before close)`,
    {
      daysSinceNoteOrClose: days,
      anchor: fhaSeasoningAnchorDate(loan)?.toISOString().slice(0, 10) ?? null,
    },
    ctx.now,
  );
}

/** ARM: check-in aligned to fixed period (months from close to first reset). */
export function detectArmBookCheckinDue(loan: SignalLoanRow, ctx: DetectorContext): DealSignal | null {
  if (!isFundedBackBookLoan(loan)) return null;
  if (loan.do_not_contact === true) return null;
  if (shouldSuppressGenericBookOutreach(loan, ctx.now)) return null;
  const close = closeAnchorDate(loan);
  if (!close || !loan.arm_first_reset_date) return null;
  const reset = new Date(loan.arm_first_reset_date);
  if (Number.isNaN(reset.getTime())) return null;
  const periodMonths = differenceInCalendarMonths(reset, close);
  if (periodMonths < 6) return null;
  const mos = monthsSinceClose(loan, ctx.now);
  if (mos == null) return null;
  if (mos < periodMonths - 1 || mos > periodMonths + 1) return null;
  return base(
    loan,
    "arm_book_checkin_due",
    3,
    `ARM ~${periodMonths}mo fixed period — book check-in (first reset ${loan.arm_first_reset_date})`,
    {
      armFixedPeriodMonths: periodMonths,
      armFirstResetDate: loan.arm_first_reset_date,
    },
    ctx.now,
  );
}

/** ORANGE tier in CTC/closing with recent stage movement — actively working toward close. */
export function detectOrangePipelineHot(loan: SignalLoanRow, ctx: DetectorContext): DealSignal | null {
  if (loan.do_not_contact === true) return null;
  if (classifyLoanTier(loan) !== "ORANGE") return null;
  const stage = loan.current_stage ?? "";
  if (stage !== "clear_to_close" && stage !== "closing") return null;
  let priority: SignalPriority = 3;
  const ev = ctx.latestStageEvent.get(loan.id)?.entered_at;
  if (ev) {
    const days = differenceInCalendarDays(ctx.now, new Date(ev));
    if (days <= 21) priority = 4;
  }
  return base(
    loan,
    "orange_pipeline_hot",
    priority,
    "Active pipeline — CTC/closing with recent activity",
    { stage, status_raw: loan.status_raw },
    ctx.now,
  );
}

/** EPO date in 30–60 days; one-time style signal (DB flag suppresses repeat). */
export function detectEpoWindowOpening(loan: SignalLoanRow, ctx: DetectorContext): DealSignal | null {
  if (!loan.epo_date) return null;
  if (loan.epo_window_activated === true) return null;
  if (loan.do_not_contact === true) return null;

  const epo = new Date(loan.epo_date);
  if (Number.isNaN(epo.getTime())) return null;
  const daysUntil = differenceInCalendarDays(epo, ctx.now);
  if (daysUntil < 30 || daysUntil > 60) return null;

  return base(
    loan,
    "epo_window_opening",
    4,
    `EPO window opening in ~${daysUntil}d`,
    { epoDate: loan.epo_date, daysUntil },
    ctx.now,
  );
}

export const LEAD_TIER_DETECTORS = [
  detectNeverContacted,
  detectPreSignature,
  detectPackagedNotClosed,
  detectCtcExpired,
  detectAppraisalOrderedStalled,
  detectBookCheckin6m,
  detectBookCheckin12m,
  detectPostCloseSkipPaymentDue,
  detectFirstPaymentTouch,
  detectFhaSeasoningPrep,
  detectArmBookCheckinDue,
  detectOrangePipelineHot,
  detectEpoWindowOpening,
] as const;
