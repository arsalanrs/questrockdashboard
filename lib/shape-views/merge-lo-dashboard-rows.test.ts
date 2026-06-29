import { describe, expect, it } from "vitest";
import { mergeLoDashboardLoanRows } from "./merge-lo-dashboard-rows";
import type { LoDashboardLoanRow } from "./lo-dashboard";

function row(partial: Partial<LoDashboardLoanRow> & { id: string }): LoDashboardLoanRow {
  return {
    id: partial.id,
    shape_record_id: partial.shape_record_id ?? null,
    record_type: partial.record_type ?? "Loans",
    source: partial.source ?? null,
    status_raw: partial.status_raw ?? null,
    portal_status_raw: partial.portal_status_raw ?? null,
    lendingpad_status_raw: partial.lendingpad_status_raw ?? null,
    lendingpad_status_at: partial.lendingpad_status_at ?? null,
    borrower_first_name: partial.borrower_first_name ?? null,
    borrower_last_name: partial.borrower_last_name ?? null,
    borrower_email: partial.borrower_email ?? null,
    borrower_phone: partial.borrower_phone ?? null,
    assigned_loan_officer_user_id: partial.assigned_loan_officer_user_id ?? "lo-1",
    assigned_loan_officer_name: partial.assigned_loan_officer_name ?? "Test LO",
    lead_created_at: partial.lead_created_at ?? null,
    application_completed_at: partial.application_completed_at ?? null,
    conversion_date: partial.conversion_date ?? null,
    shape_last_updated_at: partial.shape_last_updated_at ?? null,
    last_status_change_at: partial.last_status_change_at ?? null,
    last_contacted_at: partial.last_contacted_at ?? null,
    funded_at: partial.funded_at ?? null,
    closed_at: partial.closed_at ?? null,
    lendingpad_loan_uuid: partial.lendingpad_loan_uuid ?? null,
    current_stage: partial.current_stage ?? null,
    loan_amount_cents: partial.loan_amount_cents ?? null,
    credit_report_requested_at: partial.credit_report_requested_at ?? null,
    closing_date: partial.closing_date ?? null,
    ctc_at: partial.ctc_at ?? null,
    submitted_to_processing_at: partial.submitted_to_processing_at ?? null,
    uw_decision_at: partial.uw_decision_at ?? null,
    loan_type: partial.loan_type ?? null,
    loan_purpose: partial.loan_purpose ?? null,
    property_state: partial.property_state ?? null,
    mailing_state: partial.mailing_state ?? null,
    track: partial.track ?? null,
    documentation_type: partial.documentation_type ?? null,
    is_brokered: partial.is_brokered ?? null,
    notes_sidebar: partial.notes_sidebar ?? null,
    notes_sidebar_ai_note: partial.notes_sidebar_ai_note ?? null,
    recent_notes: partial.recent_notes ?? null,
    game_plan_notes: partial.game_plan_notes ?? null,
    initial_contact_attempted: partial.initial_contact_attempted ?? null,
    verification_started_at: partial.verification_started_at ?? null,
    verification_completed_at: partial.verification_completed_at ?? null,
    processing_completed_at: partial.processing_completed_at ?? null,
    submitted_to_uw_at: partial.submitted_to_uw_at ?? null,
    lock_expiration_date: partial.lock_expiration_date ?? null,
    finance_contingency_date: partial.finance_contingency_date ?? null,
    appraisal_contingency_date: partial.appraisal_contingency_date ?? null,
    credit_score_mid: partial.credit_score_mid ?? null,
  };
}

describe("mergeLoDashboardLoanRows", () => {
  it("merges LP dates onto Shape row for same borrower", () => {
    const merged = mergeLoDashboardLoanRows([
      row({
        id: "shape-1",
        shape_record_id: 50310,
        status_raw: "Verification",
        borrower_first_name: "Ramsey",
        borrower_last_name: "Munir",
      }),
      row({
        id: "lp-1",
        lendingpad_loan_uuid: "d248b9a5-1fb3-4569-8474-c6c4335e5404",
        lendingpad_status_raw: "Lead",
        lendingpad_status_at: "2026-06-12T00:00:00Z",
        closing_date: "2026-07-15",
        borrower_first_name: "Ramsey",
        borrower_last_name: "Munir",
      }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("shape-1");
    expect(merged[0].shape_record_id).toBe(50310);
    expect(merged[0].lendingpad_loan_uuid).toBe("d248b9a5-1fb3-4569-8474-c6c4335e5404");
    expect(merged[0].closing_date).toBe("2026-07-15");
  });
});
