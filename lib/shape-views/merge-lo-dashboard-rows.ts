import type { LoDashboardLoanRow } from "./lo-dashboard";

function normalizeNamePart(v: string | null | undefined): string {
  return String(v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function borrowerLoMergeKey(row: LoDashboardLoanRow): string {
  const name = `${normalizeNamePart(row.borrower_first_name)} ${normalizeNamePart(row.borrower_last_name)}`.trim();
  const lo = row.assigned_loan_officer_user_id ?? normalizeNamePart(row.assigned_loan_officer_name);
  return `${name}|${lo}`;
}

const DATE_FIELDS = [
  "credit_report_requested_at",
  "conversion_date",
  "submitted_to_processing_at",
  "processing_completed_at",
  "submitted_to_uw_at",
  "uw_decision_at",
  "ctc_at",
  "closing_date",
  "closing_scheduled_at",
  "lock_expiration_date",
  "finance_contingency_date",
  "appraisal_contingency_date",
  "application_completed_at",
  "verification_started_at",
  "verification_completed_at",
] as const;

/**
 * Shape rebuild + LP sync often create two rows per borrower (shape_record_id vs lendingpad_loan_uuid).
 * Merge them for dashboard display so LP list dates attach to the Shape row the UI already shows.
 */
export function mergeLoDashboardLoanRows(rows: LoDashboardLoanRow[]): LoDashboardLoanRow[] {
  const groups = new Map<string, LoDashboardLoanRow[]>();
  for (const row of rows) {
    const key = borrowerLoMergeKey(row);
    if (!key.replace("|", "").trim()) {
      groups.set(`__solo_${row.id}`, [row]);
      continue;
    }
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  return [...groups.values()].map((group) => (group.length === 1 ? group[0] : mergeLoanGroup(group)));
}

function mergeLoanGroup(group: LoDashboardLoanRow[]): LoDashboardLoanRow {
  const shapeRow = group.find((r) => r.shape_record_id != null) ?? group[0];
  const lpRow = group.find((r) => r.lendingpad_loan_uuid) ?? shapeRow;

  const merged: LoDashboardLoanRow = { ...shapeRow };

  if (lpRow.lendingpad_loan_uuid) merged.lendingpad_loan_uuid = lpRow.lendingpad_loan_uuid;
  if (lpRow.lendingpad_status_raw) merged.lendingpad_status_raw = lpRow.lendingpad_status_raw;
  if (lpRow.lendingpad_status_at) merged.lendingpad_status_at = lpRow.lendingpad_status_at;
  if (lpRow.lp_last_synced_at) merged.lp_last_synced_at = lpRow.lp_last_synced_at;
  if (lpRow.loan_type && !merged.loan_type) merged.loan_type = lpRow.loan_type;
  if (lpRow.loan_purpose && !merged.loan_purpose) merged.loan_purpose = lpRow.loan_purpose;
  if (lpRow.credit_score_mid != null && merged.credit_score_mid == null) {
    merged.credit_score_mid = lpRow.credit_score_mid;
  }

  for (const field of DATE_FIELDS) {
    const lpVal = lpRow[field];
    const shapeVal = shapeRow[field];
    if (lpVal && !shapeVal) {
      (merged as Record<string, unknown>)[field] = lpVal;
    } else if (!merged[field] && shapeVal) {
      (merged as Record<string, unknown>)[field] = shapeVal;
    }
  }

  // Preserve LP row id for rich_loan_data lookup when canonical id is Shape-only.
  if (lpRow.id !== shapeRow.id) {
    (merged as LoDashboardLoanRow & { _richLoanId?: string })._richLoanId = lpRow.id;
  }

  return merged;
}

export function richLoanIdsForRows(rows: Array<LoDashboardLoanRow & { _richLoanId?: string }>): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    ids.add(row.id);
    if (row._richLoanId) ids.add(row._richLoanId);
  }
  return [...ids];
}
