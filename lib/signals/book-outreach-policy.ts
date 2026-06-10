/**
 * Quest Rock CEO book-outreach rules: cadence, FHA seasoning, recent-close suppression.
 * Used by lead-tier detectors, refi detectors, deal finder, and retention digest.
 */

import { differenceInCalendarDays, differenceInCalendarMonths } from "date-fns";

import type { SignalLoanRow } from "./types";

function isFundedBackBookLoanLocal(loan: SignalLoanRow): boolean {
  if (loan.current_stage === "funded") return true;
  if (loan.closed_at) return true;
  if (loan.funded_at) return true;
  const s = (loan.status_raw ?? "").trim().toLowerCase();
  return s === "closed" || s === "funded";
}

/** Suppress generic 6/12mo relationship check-ins for loans closed within this many days. */
export const BOOK_RECENT_CLOSE_SUPPRESS_DAYS = 30;

/** FHA: refi-style outreach suppressed until this many days after anchor (CEO: 210). */
export const FHA_REFINABLE_MIN_DAYS = 210;

/** FHA: optional prep / education call window center (CEO: ~180d). */
export const FHA_SEASONING_PREP_CENTER_DAYS = 180;
export const FHA_SEASONING_PREP_WINDOW_DAYS = 10;

/** Soft rule: flag below this loan amount ($150k). */
export const MIN_LOAN_AMOUNT_CENTS_DEFAULT = 15_000_000;

/** Soft rule: flag FICO at or below this (CEO cited 515). */
export const LOW_FICO_WARN_THRESHOLD = 560;

export function closeAnchorDate(loan: SignalLoanRow): Date | null {
  const raw = loan.closing_date ?? loan.funded_at ?? loan.closed_at;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** FHA seasoning anchor: prefer note date when present, else close/fund (compliance may override). */
export function fhaSeasoningAnchorDate(loan: SignalLoanRow): Date | null {
  const raw = loan.note_date ?? loan.closing_date ?? loan.funded_at ?? loan.closed_at;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function daysSinceClose(loan: SignalLoanRow, now: Date): number | null {
  const d = closeAnchorDate(loan);
  if (!d) return null;
  return differenceInCalendarDays(now, d);
}

export function monthsSinceClose(loan: SignalLoanRow, now: Date): number | null {
  const d = closeAnchorDate(loan);
  if (!d) return null;
  return differenceInCalendarMonths(now, d);
}

export function isFhaLoan(loan: SignalLoanRow): boolean {
  const t = (loan.loan_type ?? "").trim().toUpperCase();
  return t.includes("FHA");
}

/**
 * Generic book relationship check-ins (6/12 mo) — not skip-payment or first-payment touches.
 */
export function shouldSuppressGenericBookOutreach(loan: SignalLoanRow, now: Date): boolean {
  if (!isFundedBackBookLoanLocal(loan)) return true;
  const days = daysSinceClose(loan, now);
  if (days == null) return true;
  return days < BOOK_RECENT_CLOSE_SUPPRESS_DAYS;
}

/** Block refi radar / deal-finder style pitches until FHA is seasoned. */
export function shouldSuppressRefiForFhaSeasoning(loan: SignalLoanRow, now: Date): boolean {
  if (!isFhaLoan(loan)) return false;
  const d = fhaSeasoningAnchorDate(loan);
  if (!d) return false;
  return differenceInCalendarDays(now, d) < FHA_REFINABLE_MIN_DAYS;
}

export function daysSinceFhaSeasoningAnchor(loan: SignalLoanRow, now: Date): number | null {
  const d = fhaSeasoningAnchorDate(loan);
  if (!d) return null;
  return differenceInCalendarDays(now, d);
}

export function softTagsForLoan(loan: SignalLoanRow): string[] {
  const tags: string[] = [];
  const amt = loan.loan_amount_cents;
  if (amt != null && amt < MIN_LOAN_AMOUNT_CENTS_DEFAULT) {
    tags.push("below_min_amount");
  }
  const fico = loan.credit_score_mid;
  if (fico != null && fico <= LOW_FICO_WARN_THRESHOLD) {
    tags.push("low_fico");
  }
  return tags;
}

export function mergeMetaWithSoftTags(
  loan: SignalLoanRow,
  meta: Record<string, unknown>,
): Record<string, unknown> {
  const tags = softTagsForLoan(loan);
  if (tags.length === 0) return meta;
  const existing = meta.questRockTags;
  const merged =
    Array.isArray(existing) ? [...new Set([...tags, ...existing.map(String)])] : tags;
  return { ...meta, questRockTags: merged };
}

/** First calendar day of the month after the closing month (CEO skip-payment scheduling). */
export function skipPaymentScheduledDate(close: Date): Date {
  return new Date(close.getFullYear(), close.getMonth() + 1, 1);
}
