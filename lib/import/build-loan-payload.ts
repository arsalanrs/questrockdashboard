import type { ShapeKpiCsvRow } from "@/lib/import/shape-kpi";
import { parseLoanAmountCents, parseMaybeTimestamp } from "@/lib/import/shape-kpi";

const SLOW_TRACK_TYPES = new Set(["Construction", "Fix & Flip", "Rehab"]);

function deriveTrack(loanType: string | null): string | null {
  if (!loanType) return null;
  return SLOW_TRACK_TYPES.has(loanType) ? "slow" : "fast";
}

export function buildLoanPayloadFromRow(
  r: ShapeKpiCsvRow,
  statusToStage: Map<string, string | null>,
  nameToUserId: Map<string, string>,
  importBatchId: string
): Record<string, unknown> | null {
  const shapeRecordId = Number(String(r["recordId"] ?? "").trim());
  if (!Number.isFinite(shapeRecordId)) return null;

  const statusRaw = String(r["Status"] ?? "").trim() || null;
  const currentStage = statusRaw ? (statusToStage.get(statusRaw) ?? null) : null;

  const loName = String(r["Loan Officer User Name"] ?? "").trim() || null;
  const assignedLoUserId = loName ? nameToUserId.get(loName.toLowerCase()) ?? null : null;

  const { loan_amount_raw, loan_amount_cents } = parseLoanAmountCents(r["Loan Amount"]);

  const loanType = (r["Loan Type"] ?? "").trim() || null;
  const loanPurpose = (r["Loan Purpose"] ?? "").trim() || null;

  const appraisalTs = parseMaybeTimestamp(r["Appraisal Request Date"]);

  return {
    import_batch_id: importBatchId,
    shape_record_id: shapeRecordId,
    shape_lead_id: Number(String(r["Lead ID"] ?? "").trim()) || null,
    lead_created_at: parseMaybeTimestamp(r["Created Date"]),

    record_type: (r["Record Type"] ?? "").trim() || null,
    borrower_first_name: (r["First Name"] ?? "").trim() || null,
    borrower_last_name: (r["Last Name"] ?? "").trim() || null,
    borrower_email: (r["Email"] ?? "").trim() || null,
    borrower_phone: (r["Phone"] ?? "").trim() || null,

    mailing_state: (r["Mailing State"] ?? "").trim() || null,
    property_state: (r["Property State"] ?? "").trim() || null,

    loan_amount_raw,
    loan_amount_cents,

    status_raw: statusRaw,
    current_stage: currentStage,

    source: (r["Source"] ?? "").trim() || null,
    utm_campaign: (r["Custom Field - UTM Campaign"] ?? "").trim() || null,
    channel: (r["Channel"] ?? "").trim() || null,

    loan_type: loanType,
    loan_purpose: loanPurpose,
    track: deriveTrack(loanType),

    application_completed_at: parseMaybeTimestamp(r["Application Completed Date"]),
    credit_report_requested_at: parseMaybeTimestamp(r["Credit Report Request Date"]),
    appraisal_requested_at: appraisalTs,
    appraisal_ordered_at: appraisalTs,
    closed_at: parseMaybeTimestamp(r["Tracking Date Closed"]),

    assigned_loan_officer_name: loName,
    assigned_loan_officer_user_id: assignedLoUserId,
  };
}
