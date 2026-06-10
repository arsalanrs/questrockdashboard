/**
 * Deal-detection signal types.
 *
 * A DealSignal is a detected opportunity on a loan (stall, refi, cash-out, etc.)
 * produced by the signal engine. Signals are consumed by the Executive
 * Opportunities panel, the exec AI chat, and the morning digest cron.
 *
 * This library is framework-agnostic: pure functions over loan rows.
 * Supabase writes/reads happen in callers.
 */

export type SignalCategory = "stall" | "refi" | "portfolio" | "life_event" | "lead_tier";

/**
 * Stable string identifiers. New detectors append here — do NOT rename
 * existing values (they're persisted in deal_signals.signal_type).
 */
export type SignalType =
  // Stall (Phase 1)
  | "piped_never_closed"
  | "app_no_movement"
  | "approved_never_funded"
  | "ctc_stall"
  | "esign_stuck"
  // Refi radar (Phase 3)
  | "rate_above_market"
  | "cash_out_candidate"
  | "fha_to_conventional"
  | "va_irrrl"
  | "arm_reset_window"
  | "credit_score_improved"
  // Lead tier / re-engagement (Supabase-only)
  | "never_contacted"
  | "pre_signature"
  | "packaged_not_closed"
  | "ctc_expired"
  | "appraisal_ordered_stalled"
  /** @deprecated Prefer book_checkin_6m / book_checkin_12m; kept for legacy DB rows. */
  | "closing_8month_due"
  | "epo_window_opening"
  | "book_checkin_6m"
  | "book_checkin_12m"
  | "post_close_skip_payment_due"
  | "first_payment_touch"
  | "fha_seasoning_prep"
  | "arm_book_checkin_due"
  | "orange_pipeline_hot";

export type SignalPriority = 1 | 2 | 3 | 4 | 5; // 5 = urgent, 1 = nice-to-have

export type DealSignal = {
  loanId: string;
  signalType: SignalType;
  category: SignalCategory;
  priority: SignalPriority;
  reason: string;
  loUserId: string | null;
  loName: string | null;
  computedAt: string; // ISO
  /** Stable key to dedupe identical signals across runs. */
  dedupeKey: string;
  /** Optional metadata the UI / playbook can use (days stalled, rate delta, etc.) */
  meta?: Record<string, unknown>;
};

export type SignalLoanRow = {
  id: string;
  current_stage: string | null;
  status_raw: string | null;
  loan_amount_cents: number | null;
  appraisal_ordered_at: string | null;
  closed_at: string | null;
  closing_date: string | null;
  esign_returned_at: string | null;
  esign_requested_at: string | null;
  application_completed_at: string | null;
  submitted_to_processing_at: string | null;
  submitted_to_uw_at: string | null;
  ctc_at: string | null;
  lead_created_at: string | null;
  assigned_loan_officer_user_id: string | null;
  assigned_loan_officer_name: string | null;
  borrower_first_name: string | null;
  borrower_last_name: string | null;
  loan_type: string | null;
  loan_purpose: string | null;
  shape_record_id: number | null;
  lendingpad_loan_uuid: string | null;
  is_restructure_hold: boolean | null;
  // Phase 2 underwriting fields (nullable)
  note_rate_bps: number | null;
  original_rate_bps: number | null;
  property_value_cents: number | null;
  current_loan_balance_cents: number | null;
  ltv_bps: number | null;
  cltv_bps: number | null;
  dti_bps: number | null;
  credit_score_mid: number | null;
  is_veteran: boolean | null;
  arm_first_reset_date: string | null;
  arm_index: string | null;
  arm_margin_bps: number | null;
  do_not_contact: boolean | null;
  last_contacted_at: string | null;
  funded_at: string | null;
  loan_age_months: number | null;
  /** Tier + lifecycle (Phase lead-tier migration). */
  lead_tier: string | null;
  epo_date: string | null;
  epo_window_activated: boolean | null;
  reengagement_8month_completed_at: string | null;
  appraisal_received_at: string | null;
  first_payment_date: string | null;
  note_date: string | null;
};

export type MarketRate = {
  loan_type: string;
  term_years: number;
  rate_bps: number;
  quote_date: string;
};

export type SignalStageEvent = {
  loan_id: string;
  stage: string;
  entered_at: string;
};

export type SignalCondition = {
  loan_id: string;
  status: string;
};

export type SignalEngineInput = {
  loans: SignalLoanRow[];
  events: SignalStageEvent[];
  conditions: SignalCondition[];
  marketRates?: MarketRate[];
  /** Pass a fixed clock in tests; defaults to new Date() in production. */
  now?: Date;
};

export const SIGNAL_CATEGORY_BY_TYPE: Record<SignalType, SignalCategory> = {
  piped_never_closed: "stall",
  app_no_movement: "stall",
  approved_never_funded: "stall",
  ctc_stall: "stall",
  esign_stuck: "stall",
  rate_above_market: "refi",
  cash_out_candidate: "refi",
  fha_to_conventional: "refi",
  va_irrrl: "refi",
  arm_reset_window: "refi",
  credit_score_improved: "life_event",
  never_contacted: "lead_tier",
  pre_signature: "lead_tier",
  packaged_not_closed: "lead_tier",
  ctc_expired: "lead_tier",
  appraisal_ordered_stalled: "lead_tier",
  closing_8month_due: "lead_tier",
  epo_window_opening: "lead_tier",
  book_checkin_6m: "lead_tier",
  book_checkin_12m: "lead_tier",
  post_close_skip_payment_due: "lead_tier",
  first_payment_touch: "lead_tier",
  fha_seasoning_prep: "lead_tier",
  arm_book_checkin_due: "lead_tier",
  orange_pipeline_hot: "lead_tier",
};

export const SIGNAL_LABEL: Record<SignalType, string> = {
  piped_never_closed: "Piped but never closed",
  app_no_movement: "Application has no movement",
  approved_never_funded: "Approved but never funded",
  ctc_stall: "Clear-to-close stall",
  esign_stuck: "eSign stuck",
  rate_above_market: "Rate above market",
  cash_out_candidate: "Cash-out candidate",
  fha_to_conventional: "FHA to Conventional",
  va_irrrl: "VA IRRRL eligible",
  arm_reset_window: "ARM adjustment approaching",
  credit_score_improved: "Credit score improved",
  never_contacted: "Never contacted",
  pre_signature: "Pre-signature lead",
  packaged_not_closed: "Packaged — not closed",
  ctc_expired: "CTC aging / expired window",
  appraisal_ordered_stalled: "Appraisal ordered — stalled",
  closing_8month_due: "8-month closing check-in due",
  epo_window_opening: "EPO window opening",
  book_checkin_6m: "6-month book check-in",
  book_checkin_12m: "12-month book check-in",
  post_close_skip_payment_due: "Post-close skip payment / referral call",
  first_payment_touch: "First payment date touchpoint",
  fha_seasoning_prep: "FHA seasoning prep (~180d)",
  arm_book_checkin_due: "ARM fixed-period check-in",
  orange_pipeline_hot: "Active pipeline (closing window)",
};
