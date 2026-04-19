/**
 * Phase 3 refinance / portfolio detectors.
 *
 * These fire on the existing funded book (closed loans) and surface refi
 * opportunities — they do NOT fire on in-flight pipeline (that's Phase 1).
 *
 * Detectors:
 *   rate_above_market    — note rate is ≥ threshold above current market
 *   cash_out_candidate   — meaningful equity + not already cashing out
 *   fha_to_conventional  — FHA loan that now qualifies for Conv (drop MI)
 *   va_irrrl             — VA loan in the 6–36mo IRRRL sweet spot
 *   arm_reset_window     — ARM first-reset within the next 6 months
 *
 * Each detector is a pure function; the orchestrator wires them in.
 */

import { differenceInCalendarDays, differenceInCalendarMonths } from "date-fns";

import type {
  DealSignal,
  MarketRate,
  SignalLoanRow,
  SignalPriority,
} from "./types";
import { SIGNAL_CATEGORY_BY_TYPE } from "./types";

export type RefiContext = {
  now: Date;
  /** Latest market rate keyed by canonical loan_type (UPPER) → 30yr bps. */
  latestRateByLoanType: Map<string, number>;
};

/** Rate-above-market threshold (bps). 50 bps is a standard refi trigger. */
const RATE_ABOVE_MARKET_BPS_THRESHOLD = 50;

/** Minimum equity in cents to count as a cash-out candidate ($75k). */
const CASH_OUT_MIN_EQUITY_CENTS = 75_000_00;

/** FHA->Conv LTV ceiling (bps). 80% LTV eliminates PMI under Conv. */
const FHA_TO_CONV_MAX_LTV_BPS = 8000;

/** FHA->Conv minimum credit score. */
const FHA_TO_CONV_MIN_FICO = 680;

/** VA IRRRL loan-age window in months. */
const VA_IRRRL_MIN_MONTHS = 6;
const VA_IRRRL_MAX_MONTHS = 60;

/** ARM reset warning window in days (~6 months). */
const ARM_RESET_WINDOW_DAYS = 180;

function dedupe(loanId: string, type: string) {
  return `${loanId}:${type}`;
}

function base(
  loan: SignalLoanRow,
  signalType: DealSignal["signalType"],
  priority: SignalPriority,
  reason: string,
  meta: Record<string, unknown>,
  now: Date
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

/**
 * Only fire refi detectors on loans that are actually part of the back book
 * (funded / closed), not on in-flight pipeline. Avoids double-counting with
 * stall signals.
 */
export function isFundedBackBookLoan(loan: SignalLoanRow): boolean {
  if (loan.current_stage === "funded") return true;
  if (loan.closed_at) return true;
  if (loan.funded_at) return true;
  const s = (loan.status_raw ?? "").toLowerCase();
  if (s === "closed" || s === "funded") return true;
  return false;
}

function canonicalLoanType(loan: SignalLoanRow): string | null {
  return loan.loan_type ? loan.loan_type.trim().toUpperCase() : null;
}

function loanAgeMonths(loan: SignalLoanRow, now: Date): number | null {
  if (typeof loan.loan_age_months === "number" && Number.isFinite(loan.loan_age_months)) {
    return loan.loan_age_months;
  }
  const anchor = loan.funded_at ?? loan.closed_at ?? loan.closing_date;
  if (!anchor) return null;
  const d = new Date(anchor);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, differenceInCalendarMonths(now, d));
}

/** Note rate is ≥ threshold above the latest market rate for this loan type. */
export function detectRateAboveMarket(loan: SignalLoanRow, ctx: RefiContext): DealSignal | null {
  if (!isFundedBackBookLoan(loan)) return null;
  if (loan.note_rate_bps == null) return null;
  const lt = canonicalLoanType(loan);
  if (!lt) return null;
  const marketBps = ctx.latestRateByLoanType.get(lt);
  if (marketBps == null) return null;

  const deltaBps = loan.note_rate_bps - marketBps;
  if (deltaBps < RATE_ABOVE_MARKET_BPS_THRESHOLD) return null;
  if (loan.do_not_contact) return null;

  const priority: SignalPriority =
    deltaBps >= 150 ? 5 : deltaBps >= 100 ? 4 : deltaBps >= 75 ? 3 : 2;

  return base(
    loan,
    "rate_above_market",
    priority,
    `Note rate ${(loan.note_rate_bps / 100).toFixed(2)}% is ${(deltaBps / 100).toFixed(2)}% above market (${(marketBps / 100).toFixed(2)}%)`,
    {
      noteRateBps: loan.note_rate_bps,
      marketBps,
      deltaBps,
      loanAmountCents: loan.loan_amount_cents,
    },
    ctx.now
  );
}

/** Meaningful equity (≥ $75k) on a Conv/FHA/VA funded loan → cash-out pitch. */
export function detectCashOutCandidate(loan: SignalLoanRow, ctx: RefiContext): DealSignal | null {
  if (!isFundedBackBookLoan(loan)) return null;
  if (loan.do_not_contact) return null;
  if (loan.property_value_cents == null || loan.current_loan_balance_cents == null) return null;

  const equity = loan.property_value_cents - loan.current_loan_balance_cents;
  if (equity < CASH_OUT_MIN_EQUITY_CENTS) return null;

  // Cash-out refi usually requires LTV ≤ 80% on the new loan → current LTV should be ≤ 75%.
  if (loan.ltv_bps != null && loan.ltv_bps > 7500) return null;
  // Assumes a reasonable FICO if we know it.
  if (loan.credit_score_mid != null && loan.credit_score_mid < 640) return null;

  const priority: SignalPriority =
    equity >= 300_000_00 ? 4 : equity >= 150_000_00 ? 3 : 2;

  return base(
    loan,
    "cash_out_candidate",
    priority,
    `Estimated equity $${Math.round(equity / 100).toLocaleString()} — cash-out refi pitch`,
    {
      equityCents: equity,
      propertyValueCents: loan.property_value_cents,
      currentLoanBalanceCents: loan.current_loan_balance_cents,
      ltvBps: loan.ltv_bps,
      creditScoreMid: loan.credit_score_mid,
      loanAmountCents: loan.loan_amount_cents,
    },
    ctx.now
  );
}

/**
 * FHA borrower who now has ≤ 80% LTV and a FICO ≥ 680 → refinance into Conv
 * and drop mortgage insurance. Large monthly savings with no rate move.
 */
export function detectFhaToConventional(loan: SignalLoanRow, ctx: RefiContext): DealSignal | null {
  if (!isFundedBackBookLoan(loan)) return null;
  if (loan.do_not_contact) return null;
  const lt = canonicalLoanType(loan);
  if (lt !== "FHA") return null;
  if (loan.ltv_bps == null || loan.ltv_bps > FHA_TO_CONV_MAX_LTV_BPS) return null;
  if (loan.credit_score_mid != null && loan.credit_score_mid < FHA_TO_CONV_MIN_FICO) return null;

  const priority: SignalPriority = (loan.credit_score_mid ?? 0) >= 740 ? 4 : 3;

  return base(
    loan,
    "fha_to_conventional",
    priority,
    `FHA at ${(loan.ltv_bps / 100).toFixed(0)}% LTV — qualifies for Conv, drop PMI`,
    {
      ltvBps: loan.ltv_bps,
      creditScoreMid: loan.credit_score_mid,
      loanAmountCents: loan.loan_amount_cents,
    },
    ctx.now
  );
}

/** Funded VA loan, age 6–60 months → IRRRL streamline eligible. */
export function detectVaIrrrl(loan: SignalLoanRow, ctx: RefiContext): DealSignal | null {
  if (!isFundedBackBookLoan(loan)) return null;
  if (loan.do_not_contact) return null;
  const lt = canonicalLoanType(loan);
  if (lt !== "VA") return null;

  // Treat is_veteran=null as "unknown" and allow (loan type VA is sufficient).
  const age = loanAgeMonths(loan, ctx.now);
  if (age == null) return null;
  if (age < VA_IRRRL_MIN_MONTHS || age > VA_IRRRL_MAX_MONTHS) return null;

  // Only interesting if current note rate is meaningfully above market (or unknown market).
  const marketBps = ctx.latestRateByLoanType.get("VA");
  let edgeBps: number | null = null;
  if (loan.note_rate_bps != null && marketBps != null) {
    edgeBps = loan.note_rate_bps - marketBps;
    if (edgeBps < 25) return null;
  }

  const priority: SignalPriority = (edgeBps ?? 0) >= 100 ? 4 : 3;

  return base(
    loan,
    "va_irrrl",
    priority,
    `VA loan ${age}mo old — IRRRL streamline eligible` +
      (edgeBps != null ? ` (${(edgeBps / 100).toFixed(2)}% above market)` : ""),
    {
      loanAgeMonths: age,
      noteRateBps: loan.note_rate_bps,
      marketBps,
      edgeBps,
      loanAmountCents: loan.loan_amount_cents,
    },
    ctx.now
  );
}

/** ARM with its first reset date arriving within the next 6 months. */
export function detectArmResetWindow(loan: SignalLoanRow, ctx: RefiContext): DealSignal | null {
  if (!isFundedBackBookLoan(loan)) return null;
  if (loan.do_not_contact) return null;
  if (!loan.arm_first_reset_date) return null;

  const resetDate = new Date(loan.arm_first_reset_date);
  if (Number.isNaN(resetDate.getTime())) return null;
  const daysUntilReset = differenceInCalendarDays(resetDate, ctx.now);
  if (daysUntilReset < 0) {
    // Already reset — still valuable for 60 days after, then drop off.
    if (daysUntilReset < -60) return null;
  } else if (daysUntilReset > ARM_RESET_WINDOW_DAYS) {
    return null;
  }

  const priority: SignalPriority =
    daysUntilReset <= 30 && daysUntilReset >= -30 ? 5 : daysUntilReset <= 90 ? 4 : 3;

  const label =
    daysUntilReset >= 0
      ? `ARM first reset in ${daysUntilReset}d`
      : `ARM reset ${Math.abs(daysUntilReset)}d ago`;

  return base(
    loan,
    "arm_reset_window",
    priority,
    `${label} — lock into fixed before payment shock`,
    {
      armFirstResetDate: loan.arm_first_reset_date,
      daysUntilReset,
      armIndex: loan.arm_index,
      armMarginBps: loan.arm_margin_bps,
      loanAmountCents: loan.loan_amount_cents,
    },
    ctx.now
  );
}

export const REFI_DETECTORS = [
  detectRateAboveMarket,
  detectCashOutCandidate,
  detectFhaToConventional,
  detectVaIrrrl,
  detectArmResetWindow,
] as const;

export function buildRefiContext(marketRates: MarketRate[], now: Date): RefiContext {
  const latestRateByLoanType = new Map<string, number>();
  const latestDateByLoanType = new Map<string, Date>();
  for (const mr of marketRates) {
    if (mr.term_years !== 30) continue; // only use 30yr benchmark for now
    const lt = mr.loan_type.trim().toUpperCase();
    const d = new Date(mr.quote_date);
    if (Number.isNaN(d.getTime())) continue;
    const prev = latestDateByLoanType.get(lt);
    if (!prev || prev.getTime() < d.getTime()) {
      latestDateByLoanType.set(lt, d);
      latestRateByLoanType.set(lt, mr.rate_bps);
    }
  }
  return { now, latestRateByLoanType };
}
