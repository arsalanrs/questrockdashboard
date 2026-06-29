import type { SupabaseClient } from "@supabase/supabase-js";
import { passesGlobalFilters } from "./global-filters";
import { DEFAULT_WINDOW_DAYS, windowStartIso, type FetchShapeLoansOptions } from "./query-loans";
import type { LoDashboardLoanRow } from "./lo-dashboard";

export const LO_DASHBOARD_SELECT =
  "id,shape_record_id,record_type,source,status_raw,portal_status_raw,lendingpad_status_raw,borrower_first_name,borrower_last_name,borrower_email,borrower_phone,assigned_loan_officer_user_id,assigned_loan_officer_name,lead_created_at,application_completed_at,conversion_date,shape_last_updated_at,last_status_change_at,last_contacted_at,funded_at,closed_at,lendingpad_loan_uuid,current_stage,loan_amount_cents,loan_type,loan_purpose,property_state,mailing_state,track,documentation_type,is_brokered,notes_sidebar,notes_sidebar_ai_note,recent_notes,game_plan_notes,initial_contact_attempted,credit_report_requested_at,verification_started_at,verification_completed_at,submitted_to_processing_at,processing_completed_at,submitted_to_uw_at,uw_decision_at,ctc_at,closing_date,lock_expiration_date,finance_contingency_date,appraisal_contingency_date,credit_score_mid";

export type LoDashboardRichData = {
  front_dti?: number | null;
  back_dti?: number | null;
  ltv_ratio_percent?: number | null;
  note_rate?: number | null;
  lock_expiration_at?: string | null;
  borrower_mobile_phone?: string | null;
  borrower_email?: string | null;
  borrower_address_json?: { street?: string; city?: string; state?: string; zipCode?: string } | null;
  processing_checklist_json?: Record<
    string,
    { completed?: boolean; requestDate?: string; receivedDate?: string }
  > | null;
};

export async function fetchLoDashboardLoans(
  supabase: SupabaseClient,
  options: FetchShapeLoansOptions,
): Promise<{ loans: LoDashboardLoanRow[]; error: string | null }> {
  const maxRows = options.limit ?? 5000;
  const pageSize = 1000;
  const loans: LoDashboardLoanRow[] = [];
  let offset = 0;

  while (loans.length < maxRows) {
    let q = supabase
      .from("loans")
      .select(LO_DASHBOARD_SELECT)
      .or(`lead_created_at.gte.${options.windowStartIso},shape_last_updated_at.gte.${options.windowStartIso}`)
      .order("shape_last_updated_at", { ascending: false, nullsFirst: false })
      .range(offset, offset + pageSize - 1);

    if (options.assignedLoUserId || options.assignedLoName) {
      const orParts: string[] = [];
      if (options.assignedLoUserId) {
        orParts.push(`assigned_loan_officer_user_id.eq.${options.assignedLoUserId}`);
      }
      if (options.assignedLoName?.trim()) {
        // ilike = case-insensitive exact match — handles "Zachary Davis" vs "zachary davis" etc.
        orParts.push(`assigned_loan_officer_name.ilike.${options.assignedLoName.trim()}`);
      }
      if (orParts.length) q = q.or(orParts.join(","));
    }

    const { data, error } = await q;
    if (error) return { loans: [], error: error.message };

    const batch = (data ?? []) as LoDashboardLoanRow[];
    if (batch.length === 0) break;
    loans.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }

  const loName = options.assignedLoName?.trim()?.toLowerCase() ?? null;
  const loUserId = options.assignedLoUserId ?? null;

  const scoped =
    loUserId || loName
      ? loans.slice(0, maxRows).filter((row) => {
          // Match by user ID (exact)
          if (loUserId && row.assigned_loan_officer_user_id === loUserId) return true;
          // Match by name (case-insensitive)
          if (loName && row.assigned_loan_officer_name?.trim().toLowerCase() === loName) return true;
          return false;
        })
      : loans.slice(0, maxRows);

  return { loans: scoped.filter(passesGlobalFilters), error: null };
}

export async function fetchRichLoanDataByIds(
  supabase: SupabaseClient,
  loanIds: string[],
): Promise<Record<string, LoDashboardRichData>> {
  if (!loanIds.length) return {};
  const out: Record<string, LoDashboardRichData> = {};
  const chunkSize = 200;

  for (let i = 0; i < loanIds.length; i += chunkSize) {
    const chunk = loanIds.slice(i, i + chunkSize);
    const { data } = await supabase
      .from("rich_loan_data")
      .select(
        "loan_id,front_dti,back_dti,ltv_ratio_percent,note_rate,lock_expiration_at,borrower_mobile_phone,borrower_email,borrower_address_json,processing_checklist_json",
      )
      .in("loan_id", chunk);

    for (const row of data ?? []) {
      out[row.loan_id as string] = {
        front_dti: row.front_dti,
        back_dti: row.back_dti,
        ltv_ratio_percent: row.ltv_ratio_percent,
        note_rate: row.note_rate,
        lock_expiration_at: row.lock_expiration_at,
        borrower_mobile_phone: row.borrower_mobile_phone,
        borrower_email: row.borrower_email,
        borrower_address_json: row.borrower_address_json as LoDashboardRichData["borrower_address_json"],
        processing_checklist_json: row.processing_checklist_json as LoDashboardRichData["processing_checklist_json"],
      };
    }
  }

  return out;
}

export { DEFAULT_WINDOW_DAYS, windowStartIso };
