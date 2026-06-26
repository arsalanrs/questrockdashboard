import { describe, expect, it } from "vitest";
import { isSampleRecord, passesGlobalFilters } from "./global-filters";
import type { ShapeLoanRow } from "./types";

function row(overrides: Partial<ShapeLoanRow> = {}): ShapeLoanRow {
  return {
    id: "1",
    shape_record_id: 1,
    record_type: "Leads",
    source: "Referral",
    status_raw: "New Lead",
    portal_status_raw: null,
    lendingpad_status_raw: null,
    borrower_first_name: "Jamie",
    borrower_last_name: "Alvarez",
    borrower_email: null,
    borrower_phone: null,
    assigned_loan_officer_user_id: null,
    assigned_loan_officer_name: null,
    lead_created_at: null,
    application_completed_at: null,
    conversion_date: null,
    shape_last_updated_at: null,
    last_status_change_at: null,
    last_contacted_at: null,
    funded_at: null,
    closed_at: null,
    lendingpad_loan_uuid: null,
    current_stage: null,
    loan_amount_cents: null,
    ...overrides,
  };
}

describe("global-filters sample records", () => {
  it("excludes borrower names containing Sample", () => {
    expect(isSampleRecord({ borrower_first_name: "Sample", borrower_last_name: "Lead" })).toBe(true);
    expect(passesGlobalFilters(row({ borrower_first_name: "Sample", borrower_last_name: "Lead" }))).toBe(false);
    expect(passesGlobalFilters(row({ borrower_first_name: "Jamie", borrower_last_name: "Alvarez" }))).toBe(true);
  });
});
