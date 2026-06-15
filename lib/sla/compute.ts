/**
 * SLA Engine — pure TypeScript, no DB dependency.
 *
 * Mirrors the 5 SLA rules in the v_lead_sla_status SQL view so the
 * 15-min cron can evaluate loans in-memory before deciding which ones
 * need breach notifications.
 *
 * Rules (most severe wins):
 *   1. RED   — new lead (lead/application) untouched > 24h
 *   2. RED   — Signed / Package Out with no appraisal payment
 *   3. RED   — active pipeline stage, no activity > 48h
 *   4. YELLOW — new lead 8–24h without a touch today
 *   5. YELLOW — Pitched and Waiting > 24h without activity
 *   5b.YELLOW — mid-pipeline stage, no activity 24–48h
 */

export type SlaColor = "green" | "yellow" | "red";

export type SlaBreachType =
  | "untouched_24h"
  | "appraisal_missing"
  | "pipeline_stalled_48h"
  | "not_touched_today"
  | "pitched_waiting_stalled"
  | "pipeline_stalled_24h"
  | "no_first_touch_2h"
  | "zero_touch_eod"
  | null;

export type SlaResult = {
  color: SlaColor;
  breachType: SlaBreachType;
  /** Hours since last activity (or since lead_created_at if no activity). */
  hoursAtRisk: number;
};

export type SlaLoanInput = {
  current_stage: string | null;
  status_raw: string | null;
  lead_created_at: string | null;
  appraisal_payment_collected_at: string | null;
  /** ISO string of the most recent shape_activity_log entry for this loan; null if never synced. */
  last_activity_at: string | null;
  /** Whether there is a lead_touch_log row for today. */
  touched_today: boolean;
};

const RED_STAGES = new Set([
  "verification",
  "esign_out",
  "registered",
  "processing",
  "submission",
  "underwriting",
  "conditions",
  "approval_conditions",
]);

const YELLOW_STAGES = new Set(["verification", "esign_out", "registered", "processing"]);

const NEW_LEAD_STAGES = new Set(["lead", "application"]);

const SIGNED_STATUSES = new Set(["Signed", "Package Out", "Signed Not Piped"]);

function hoursSince(isoDate: string | null, now: Date): number {
  if (!isoDate) return Infinity;
  const ms = now.getTime() - new Date(isoDate).getTime();
  return ms / (1000 * 60 * 60);
}

export function computeLoanSla(loan: SlaLoanInput, now: Date = new Date()): SlaResult {
  const stage = loan.current_stage ?? "";
  const status = loan.status_raw ?? "";

  const hoursCreated = hoursSince(loan.lead_created_at, now);
  const hoursActivity = hoursSince(loan.last_activity_at ?? loan.lead_created_at, now);
  const hoursAtRisk = Math.round(hoursActivity);

  // ── RULE 1 (red): new lead untouched > 24h ───────────────────────────────
  if (NEW_LEAD_STAGES.has(stage) && hoursCreated > 24 && !loan.touched_today) {
    return { color: "red", breachType: "untouched_24h", hoursAtRisk };
  }

  // ── RULE 2 (red): signed / package out, no appraisal payment ────────────
  if (SIGNED_STATUSES.has(status) && !loan.appraisal_payment_collected_at) {
    return { color: "red", breachType: "appraisal_missing", hoursAtRisk };
  }

  // ── RULE 3 (red): active pipeline, no activity > 48h ────────────────────
  if (RED_STAGES.has(stage) && hoursActivity > 48) {
    return { color: "red", breachType: "pipeline_stalled_48h", hoursAtRisk };
  }

  // ── RULE 4 (yellow): new lead 8–24h without touch today ─────────────────
  if (NEW_LEAD_STAGES.has(stage) && hoursCreated > 8 && hoursCreated <= 24 && !loan.touched_today) {
    return { color: "yellow", breachType: "not_touched_today", hoursAtRisk };
  }

  // ── RULE 5 (yellow): Pitched and Waiting > 24h ───────────────────────────
  if (status === "Pitched and Waiting" && hoursActivity > 24) {
    return { color: "yellow", breachType: "pitched_waiting_stalled", hoursAtRisk };
  }

  // ── RULE 5b (yellow): mid-pipeline, 24–48h no activity ───────────────────
  if (YELLOW_STAGES.has(stage) && hoursActivity > 24 && hoursActivity <= 48) {
    return { color: "yellow", breachType: "pipeline_stalled_24h", hoursAtRisk };
  }

  return { color: "green", breachType: null, hoursAtRisk };
}

/** Human-readable label for a breach type. */
export const SLA_BREACH_LABELS: Record<Exclude<SlaBreachType, null>, string> = {
  untouched_24h: "Untouched > 24h",
  appraisal_missing: "Appraisal payment missing",
  pipeline_stalled_48h: "No activity > 48h",
  not_touched_today: "Not touched today",
  pitched_waiting_stalled: "Pitched and Waiting > 24h",
  pipeline_stalled_24h: "No activity > 24h",
  no_first_touch_2h: "No first touch in 2h",
  zero_touch_eod: "Zero touches — end of day",
};
