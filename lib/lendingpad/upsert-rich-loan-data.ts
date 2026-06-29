import type { SupabaseClient } from "@supabase/supabase-js";
import type { NormalizedLpLoanDetail, NormalizedLpLoanListItem } from "./parse-response";

function isoFromDateOnly(date: string | null | undefined): string | null {
  if (!date) return null;
  const t = Date.parse(`${date}T12:00:00.000Z`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function buildMilestoneHistory(
  listItem: NormalizedLpLoanListItem | null | undefined,
): Record<string, unknown> | null {
  if (!listItem) return null;
  const history: Record<string, unknown> = {};
  if (listItem.statusRaw) history.currentStatus = listItem.statusRaw;
  if (listItem.statusAt) history.statusAt = listItem.statusAt;
  if (listItem.loanDatesJson) history.loanDates = listItem.loanDatesJson;
  if (listItem.lockDate || listItem.lockExpirationDate || listItem.lockStatusName) {
    history.lock = {
      lockDate: listItem.lockDate,
      lockExpirationDate: listItem.lockExpirationDate,
      lockStatus: listItem.lockStatusName,
    };
  }
  if (listItem.creditReportRequestedAt) {
    history.creditReportRequestedAt = listItem.creditReportRequestedAt;
  }
  return Object.keys(history).length > 0 ? history : null;
}

function buildLpListSnapshot(
  listItem: NormalizedLpLoanListItem | null | undefined,
  milestoneHistory?: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!listItem) return null;
  const snapshot: Record<string, unknown> = {
    loanStatus: listItem.statusRaw,
    loanStatusDate: listItem.statusAt,
    estimatedClosingDate: listItem.estimatedClosingDate,
    lockDate: listItem.lockDate,
    lockExpirationDate: listItem.lockExpirationDate,
    lockStatus: listItem.lockStatusName,
    loanDates: listItem.loanDatesJson,
    creditReportRequestedAt: listItem.creditReportRequestedAt,
  };
  if (milestoneHistory) snapshot.milestoneHistory = milestoneHistory;
  return snapshot;
}

const RICH_LOAN_EXTENDED_COLUMN_RE =
  /milestone_history|first_payment_date|note_date/i;

function stripExtendedRichLoanColumns(payload: Record<string, unknown>): Record<string, unknown> {
  const out = { ...payload };
  delete out.milestone_history;
  delete out.first_payment_date;
  delete out.note_date;
  return out;
}

/**
 * Upsert rich_loan_data from LP list + detail API responses (cron sync path).
 */
export async function upsertRichLoanDataFromSync(
  admin: SupabaseClient,
  loanId: string,
  detail: NormalizedLpLoanDetail | null,
  listItem?: NormalizedLpLoanListItem | null,
): Promise<void> {
  if (!detail && !listItem) return;

  const payload: Record<string, unknown> = {
    loan_id: loanId,
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (detail) {
    if (detail.noteRateBps != null) payload.note_rate = detail.noteRateBps / 100;
    if (detail.ltvBps != null) payload.ltv_ratio_percent = detail.ltvBps / 100;
    if (detail.cltvBps != null) payload.combined_ltv_ratio_percent = detail.cltvBps / 100;
    if (detail.dtiBps != null) {
      const dti = detail.dtiBps / 100;
      payload.back_dti = dti;
      payload.front_dti = dti;
    }
    if (detail.firstPaymentDate) payload.first_payment_date = detail.firstPaymentDate;
    if (detail.noteDate) payload.note_date = detail.noteDate;
  }

  if (listItem) {
    const milestoneHistory = buildMilestoneHistory(listItem);
    if (milestoneHistory) payload.milestone_history = milestoneHistory;

    const lpSnapshot = buildLpListSnapshot(listItem, milestoneHistory);
    if (lpSnapshot) payload.lp_raw_json = lpSnapshot;

    if (listItem.lockExpirationDate) {
      payload.lock_expiration_at = isoFromDateOnly(listItem.lockExpirationDate);
    }
    if (listItem.estimatedClosingDate) {
      payload.estimated_closing_at = isoFromDateOnly(listItem.estimatedClosingDate);
    }
  }

  let { error } = await admin.from("rich_loan_data").upsert(payload, { onConflict: "loan_id" });
  if (error && RICH_LOAN_EXTENDED_COLUMN_RE.test(error.message)) {
    ({ error } = await admin
      .from("rich_loan_data")
      .upsert(stripExtendedRichLoanColumns(payload), { onConflict: "loan_id" }));
  }
  if (error) {
    throw new Error(`rich_loan_data upsert: ${error.message}`);
  }
}
