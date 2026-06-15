/**
 * Intraday SLA Rules — time-of-day aware enforcement.
 *
 * Four rules evaluated against Eastern time clock:
 *   1. unassigned_15min  — lead >15 min old with no assigned LO (most urgent)
 *   2. zero_touch_eod    — lead created today, zero touches, after 4 PM ET
 *   3. no_first_touch_2h — lead created today, >2h old, zero touches
 *   4. no_second_touch_2pm — lead created today, only 1 touch, after 2 PM ET
 *
 * These supplement the elapsed-time rules in compute.ts.
 * The cron/15min route calls evaluateIntradayRules() for every new lead
 * and fans out executive_notifications on breach.
 */

export type IntradayBreachType =
  | "unassigned_15min"       // lead > 15 min old, no assigned_loan_officer_user_id
  | "zero_touch_eod"         // lead created today, zero touches, now past 4 PM ET
  | "no_first_touch_2h"      // lead > 2h old, zero activity
  | "no_second_touch_2pm";   // lead created today, only 1 touch, now past 2 PM ET

export type IntradayLoanInput = {
  loan_id: string;
  borrower_name: string | null;
  lo_name: string | null;
  lead_created_at: string | null;
  /** Supabase user ID of the assigned LO; null means unassigned. */
  assigned_loan_officer_user_id: string | null;
  /** Count of touch log entries for today (from lead_touch_log.touch_count). */
  touches_today: number;
};

export const INTRADAY_BREACH_LABELS: Record<IntradayBreachType, string> = {
  unassigned_15min: "Unassigned > 15 min",
  zero_touch_eod: "Zero touches — end of day",
  no_first_touch_2h: "No first touch in 2h",
  no_second_touch_2pm: "No 2nd touch by 2 PM",
};

/** Convert a UTC Date to Eastern Time date/hour. */
function easternHour(date: Date): number {
  const str = date.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false });
  return parseInt(str, 10);
}

function isSameEasternDay(a: Date, b: Date): boolean {
  const opts: Intl.DateTimeFormatOptions = { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" };
  return a.toLocaleDateString("en-US", opts) === b.toLocaleDateString("en-US", opts);
}

/**
 * Evaluate all intraday rules for a single loan.
 * Returns the most severe breach type, or null if all rules pass.
 * Call with `now = new Date()` in production.
 */
export function evaluateIntradayRules(
  loan: IntradayLoanInput,
  now: Date = new Date(),
): IntradayBreachType | null {
  if (!loan.lead_created_at) return null;

  const created = new Date(loan.lead_created_at);
  const minutesSinceCreated = (now.getTime() - created.getTime()) / (1000 * 60);
  const hoursSinceCreated = minutesSinceCreated / 60;
  const nowEtHour = easternHour(now);
  const createdToday = isSameEasternDay(created, now);

  // Rule 1 — unassigned > 15 min (applies to any lead, not just today's)
  if (!loan.assigned_loan_officer_user_id && minutesSinceCreated > 15) {
    return "unassigned_15min";
  }

  // Rules 2-4 only apply to leads created today
  if (!createdToday) return null;

  // Rule 2 — zero touches, past 4 PM ET (most critical intraday state)
  if (nowEtHour >= 16 && loan.touches_today === 0) {
    return "zero_touch_eod";
  }

  // Rule 3 — no first touch in 2+ hours
  if (hoursSinceCreated > 2 && loan.touches_today === 0) {
    return "no_first_touch_2h";
  }

  // Rule 4 — only 1 touch and it's past 2 PM ET
  if (nowEtHour >= 14 && loan.touches_today === 1) {
    return "no_second_touch_2pm";
  }

  return null;
}
