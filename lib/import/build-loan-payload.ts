import type { ShapeKpiCsvRow } from "@/lib/import/shape-kpi";
import { parseLoanAmountCents, parseMaybeTimestamp } from "@/lib/import/shape-kpi";
import { normalizeLendingPadLoanUuid } from "@/lib/lendingpad/parse-response";

const SLOW_TRACK_TYPES = new Set(["Construction", "Fix & Flip", "Rehab"]);

/**
 * Normalize LO name from Shape.
 * Shape sometimes exports names as "Last, First" (CSV ordering).
 * We flip those to "First Last" to avoid duplicate cards in dashboards.
 * "Nikk, Smith" → "Nikk Smith", "Ray, Conway" → "Ray Conway".
 */
export function normalizeLoName(raw: string): string {
  const s = raw.trim();
  if (!s) return s;
  // Only flip if exactly one comma and both sides are non-empty single words/names
  const commaIdx = s.indexOf(",");
  if (commaIdx === -1) return s;
  const before = s.slice(0, commaIdx).trim();
  const after = s.slice(commaIdx + 1).trim();
  if (before && after) return `${after} ${before}`;
  return s;
}

function deriveTrack(loanType: string | null): string | null {
  if (!loanType) return null;
  return SLOW_TRACK_TYPES.has(loanType) ? "slow" : "fast";
}

/** Parses "6.875" | "6.875%" | "687.5" to bps (6875). Returns null on junk. */
function parseRateToBps(raw: string | undefined): number | null {
  if (!raw) return null;
  const s = String(raw).replace(/[%,\s]/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n < 20 ? Math.round(n * 100) : Math.round(n);
}

function parseMoneyCents(raw: string | undefined): number | null {
  if (!raw) return null;
  const s = String(raw).replace(/[$,\s]/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function parseInt0(raw: string | undefined): number | null {
  if (!raw) return null;
  const s = String(raw).replace(/[,\s]/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

function parseBool(raw: string | undefined): boolean | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (["true", "yes", "y", "1"].includes(s)) return true;
  if (["false", "no", "n", "0"].includes(s)) return false;
  return null;
}

function parseMaybeDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const d = new Date(String(raw).trim());
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function trimOrNull(raw: string | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  return s || null;
}

function compactPayload<T extends Record<string, unknown>>(payload: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

function pctToBps(raw: string | undefined): number | null {
  if (!raw) return null;
  const s = String(raw).replace(/[%,\s]/g, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n < 2 ? Math.round(n * 10000) : Math.round(n * 100);
}

export function buildLoanPayloadFromRow(
  r: ShapeKpiCsvRow,
  statusToStage: Map<string, string | null>,
  nameToUserId: Map<string, string>,
  importBatchId: string,
  /** Optional email→userId map built from users.email for fallback LO matching */
  emailToUserId?: Map<string, string>
): Record<string, unknown> | null {
  const shapeRecordId = Number(String(r["recordId"] ?? "").trim());
  if (!Number.isFinite(shapeRecordId)) return null;

  const statusRaw = String(r["Status"] ?? "").trim() || null;
  const currentStage = statusRaw ? (statusToStage.get(statusRaw) ?? null) : null;

  // Normalize "Last, First" → "First Last" — Shape sometimes exports names
  // in CSV Last,First order which creates duplicates in the loans table.
  const loNameRaw = String(r["Loan Officer User Name"] ?? "").trim();
  const loName = normalizeLoName(loNameRaw) || null;
  // Primary match: normalized full name. Fallback: loan_officer_email field.
  const loEmail = trimOrNull(r["Loan Officer Email"])?.toLowerCase();
  const assignedLoUserId =
    (loName ? nameToUserId.get(loName.toLowerCase()) ?? null : null) ??
    (loEmail && emailToUserId ? emailToUserId.get(loEmail) ?? null : null);

  // Prefer "Loan Amount"; fall back to "Purchase Price" for purchase-money loans
  // where Shape stores the amount under borpurchasePrice instead of LoanAmount.
  const loanAmountSource = r["Loan Amount"] ?? r["Purchase Price"];
  const { loan_amount_raw, loan_amount_cents } = parseLoanAmountCents(loanAmountSource);

  const loanType = trimOrNull(r["Loan Type"]);
  const loanPurpose = trimOrNull(r["Loan Purpose"]);

  const appraisalTs = parseMaybeTimestamp(r["Appraisal Request Date"]);
  const esignReturnedAt = parseMaybeTimestamp(r["E-Sign Returned Date"]);
  const appraisalPaymentCollectedAt = parseMaybeTimestamp(r["Appraisal Payment Collected Date"]);

  const lpLoanRaw = trimOrNull(r["Custom Field - LendingPad Loan ID"]);
  const lendingpad_loan_uuid = normalizeLendingPadLoanUuid(lpLoanRaw);

  const note_rate_bps = parseRateToBps(r["Note Rate"]);
  const original_rate_bps = parseRateToBps(r["Original Rate"]);
  const apr_bps = parseRateToBps(r["APR"]);
  const property_value_cents = parseMoneyCents(r["Property Value"]);
  const current_loan_balance_cents = parseMoneyCents(r["Current Loan Balance"]);

  const ltv_bps = pctToBps(r["LTV"]);
  const cltv_bps = pctToBps(r["CLTV"]);
  const dti_bps = pctToBps(r["DTI"]);

  const credit_score_mid = parseInt0(r["Credit Score"] ?? r["borcreditscore"]);
  const is_veteran = parseBool(r["Is Veteran"]);
  const is_self_employed = parseBool(r["Is Self Employed"]);
  const arm_first_reset_date = parseMaybeDate(r["ARM First Reset Date"]);
  const arm_margin_bps = parseRateToBps(r["ARM Margin"]);
  const arm_index = trimOrNull(r["ARM Index"]);
  const hmda_denial_reason = trimOrNull(r["HMDA Denial Reason"]);
  const do_not_contact = parseBool(r["Do Not Contact"]);
  const last_contacted_at = parseMaybeTimestamp(r["Last Contacted"]);
  const insellerate_ref_id = trimOrNull(r["Insellerate Ref ID"]);
  const funded_at = parseMaybeTimestamp(r["Funded Date"]);
  const closing_scheduled_at = parseMaybeTimestamp(r["Closing Scheduled Date"]);
  // closing_date (DATE) is used in Action Queue "Closing Soon" flags — derive from closing_scheduled_at
  const closing_date = closing_scheduled_at ? closing_scheduled_at.slice(0, 10) : null;
  const lock_expiration_date = parseMaybeDate(r["Lock Expiration Date"]);
  const lendingpad_status_raw = trimOrNull(r["LendingPad Status"]);

  // New Shape fields
  const finance_contingency_date = parseMaybeDate(r["Finance Contingency Date"]);
  const appraisal_contingency_date = parseMaybeDate(r["Appraisal Contingency Date"]);
  const down_payment_cents = parseMoneyCents(r["Down Payment Amount"]);
  const estimated_appraisal_value_cents = parseMoneyCents(r["Estimated Appraisal Value"]);
  // shape_last_updated_at: "Date Loan Last Updated" is the mapped key for lastActivityDate
  const shape_last_updated_at = parseMaybeTimestamp(r["Date Loan Last Updated"]);

  const payload = {
    import_batch_id: importBatchId,
    shape_record_id: shapeRecordId,
    shape_lead_id: Number(String(r["Lead ID"] ?? "").trim()) || null,
    lead_created_at: parseMaybeTimestamp(r["Created Date"]),

    record_type: trimOrNull(r["Record Type"]),
    borrower_first_name: trimOrNull(r["First Name"]),
    borrower_last_name: trimOrNull(r["Last Name"]),
    borrower_email: trimOrNull(r["Email"]),
    borrower_phone: trimOrNull(r["Phone"]),
    home_phone: trimOrNull(r["Home Phone"]),
    work_phone: trimOrNull(r["Work Phone"]),
    birth_date: parseMaybeDate(r["Birth Date"]),
    marital_status: trimOrNull(r["Marital Status"]),

    co_borrower_first_name: trimOrNull(r["Co Borrower First Name"]),
    co_borrower_last_name: trimOrNull(r["Co Borrower Last Name"]),
    co_borrower_email: trimOrNull(r["Co Borrower Email"]),
    co_borrower_phone: trimOrNull(r["Co Borrower Phone"]),

    mailing_state: trimOrNull(r["Mailing State"]),
    mailing_city: trimOrNull(r["Mailing City"]),
    mailing_zip: trimOrNull(r["Mailing Zip"]),
    mailing_address: trimOrNull(r["Mailing Address"]),
    property_state: trimOrNull(r["Property State"]),
    property_city: trimOrNull(r["Property City"]),
    property_zip: trimOrNull(r["Property Zip"]),
    property_address: trimOrNull(r["Property Address"]),
    subject_property_type: trimOrNull(r["Subject Property Type"]),
    occupancy_type: trimOrNull(r["Occupancy Type"]),

    loan_amount_raw,
    loan_amount_cents,

    status_raw: statusRaw,
    current_stage: currentStage,

    source: trimOrNull(r["Source"]),
    utm_campaign: trimOrNull(r["Custom Field - UTM Campaign"]),
    channel: trimOrNull(r["Channel"]),

    loan_type: loanType,
    loan_purpose: loanPurpose,
    documentation_type: trimOrNull(r["Documentation Type"]),
    is_self_employed,
    track: deriveTrack(loanType),

    // Milestone timestamps — every Shape tracker we request in fields.ts.
    application_completed_at: parseMaybeTimestamp(r["Application Completed Date"]),
    credit_report_requested_at: parseMaybeTimestamp(r["Credit Report Request Date"]),
    appraisal_requested_at: appraisalTs,
    appraisal_ordered_at: appraisalTs,
    appraisal_received_at: parseMaybeTimestamp(r["Appraisal Received Date"]),
    appraisal_payment_collected_at: appraisalPaymentCollectedAt,
    title_ordered_at: parseMaybeTimestamp(r["Title Ordered Date"]),
    insurance_ordered_at: parseMaybeTimestamp(r["Insurance Ordered Date"]),
    esign_requested_at: parseMaybeTimestamp(r["E-Sign Requested Date"]),
    esign_returned_at: esignReturnedAt,
    submitted_to_processing_at: parseMaybeTimestamp(r["Submitted To Processing Date"]),
    processing_completed_at: parseMaybeTimestamp(r["Processing Completed Date"]),
    submitted_to_uw_at: parseMaybeTimestamp(r["Submitted To UW Date"]),
    uw_decision_at: parseMaybeTimestamp(r["UW Decision Date"]),
    conditions_received_at: parseMaybeTimestamp(r["Conditions Received Date"]),
    conditions_submitted_at: parseMaybeTimestamp(r["Conditions Submitted Date"]),
    pre_cd_sent_at: parseMaybeTimestamp(r["Pre CD Sent Date"]),
    pre_cd_approved_at: parseMaybeTimestamp(r["Pre CD Approved Date"]),
    ctc_at: parseMaybeTimestamp(r["CTC Date"]),
    closing_scheduled_at,
    closing_date,
    lock_expiration_date,
    closed_at: parseMaybeTimestamp(r["Tracking Date Closed"]),

    assigned_loan_officer_name: loName,
    assigned_loan_officer_user_id: assignedLoUserId,
    loan_officer_email: trimOrNull(r["Loan Officer Email"]),

    lendingpad_loan_uuid,
    lendingpad_status_raw,

    // Underwriting fields.
    note_rate_bps,
    original_rate_bps,
    apr_bps,
    property_value_cents,
    current_loan_balance_cents,
    ltv_bps,
    cltv_bps,
    dti_bps,
    credit_score_mid,
    is_veteran,
    arm_first_reset_date,
    arm_margin_bps,
    arm_index,
    hmda_denial_reason,
    do_not_contact,
    last_contacted_at,
    insellerate_ref_id,
    funded_at,

    // New synced fields
    finance_contingency_date,
    appraisal_contingency_date,
    down_payment_cents,
    estimated_appraisal_value_cents,
    shape_last_updated_at,

    // Notes — stored as-is (may be HTML); consumers strip tags as needed.
    notes_sidebar: trimOrNull(r["Notes Sidebar"]),
    notes_sidebar_ai_note: trimOrNull(r["Notes Sidebar AI Note"]),
    recent_notes: trimOrNull(r["Recent Note"]),
  };
  return compactPayload(payload);
}
