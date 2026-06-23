import type { SupabaseClient } from "@supabase/supabase-js";
import type { NormalizedLpLoanDetail, NormalizedLpLoanListItem } from "./parse-response";

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
  }

  void listItem; // reserved for future list-level fields

  const { error } = await admin.from("rich_loan_data").upsert(payload, { onConflict: "loan_id" });
  if (error) {
    throw new Error(`rich_loan_data upsert: ${error.message}`);
  }
}
