import { describe, expect, it } from "vitest";
import {
  classifyLeads,
  computeLoanSLA,
  deriveMilestoneProgress,
  getHotTouchpointLabel,
  getVerificationTrack,
  isHotLead,
  isUncontactedLead,
} from "./lo-dashboard";
import type { LoDashboardLoanRow } from "./lo-dashboard";

function baseRow(overrides: Partial<LoDashboardLoanRow> = {}): LoDashboardLoanRow {
  return {
    id: "loan-1",
    shape_record_id: 123,
    record_type: "Leads",
    source: "Referral",
    status_raw: "New Lead",
    portal_status_raw: null,
    lendingpad_status_raw: null,
    borrower_first_name: "Jamie",
    borrower_last_name: "Alvarez",
    borrower_email: "jamie@example.com",
    borrower_phone: "555-0100",
    assigned_loan_officer_user_id: null,
    assigned_loan_officer_name: "Avery Stone",
    lead_created_at: "2026-06-20T12:00:00.000Z",
    application_completed_at: null,
    conversion_date: null,
    shape_last_updated_at: "2026-06-20T12:00:00.000Z",
    last_status_change_at: null,
    last_contacted_at: null,
    funded_at: null,
    closed_at: null,
    lendingpad_loan_uuid: null,
    current_stage: null,
    loan_amount_cents: 47500000,
    loan_type: "Conventional",
    loan_purpose: "Purchase",
    property_state: "NJ",
    mailing_state: "NJ",
    track: "fast",
    documentation_type: "W2",
    is_brokered: false,
    notes_sidebar: null,
    recent_notes: null,
    game_plan_notes: null,
    initial_contact_attempted: false,
    credit_report_requested_at: null,
    verification_started_at: null,
    verification_completed_at: null,
    submitted_to_processing_at: null,
    processing_completed_at: null,
    submitted_to_uw_at: null,
    uw_decision_at: null,
    ctc_at: null,
    closing_date: null,
    lock_expiration_date: null,
    finance_contingency_date: null,
    appraisal_contingency_date: null,
    credit_score_mid: null,
    ...overrides,
  };
}

describe("lo-dashboard", () => {
  it("classifies new leads as hot", () => {
    const now = new Date("2026-06-26T12:00:00.000Z");
    expect(isHotLead(baseRow(), now)).toBe(true);
    expect(classifyLeads([baseRow()], now).hot).toHaveLength(1);
  });

  it("detects uncontacted leads", () => {
    expect(isUncontactedLead(baseRow())).toBe(true);
    expect(isUncontactedLead(baseRow({ last_contacted_at: "2026-06-25T12:00:00.000Z" }))).toBe(false);
  });

  it("maps verification track B for slow track", () => {
    expect(getVerificationTrack(baseRow({ track: "slow" }))).toBe("Verification B");
    expect(getVerificationTrack(baseRow())).toBe("Verification A");
  });

  it("labels funded touchpoints near 6 months", () => {
    const now = new Date("2026-06-26T12:00:00.000Z");
    const row = baseRow({
      record_type: "Leads",
      status_raw: "Funded",
      funded_at: "2025-12-26T12:00:00.000Z",
      last_status_change_at: "2025-12-26T12:00:00.000Z",
    });
    expect(getHotTouchpointLabel(row, now)).toBe("6 month touchpoint");
    expect(isHotLead(row, now)).toBe(true);
  });

  it("computes alert SLA when underwriting is overdue", () => {
    const now = new Date("2026-06-26T12:00:00.000Z");
    const row = baseRow({
      record_type: "Loans",
      lendingpad_loan_uuid: "lp-1",
      status_raw: "Submitted to UW",
      submitted_to_uw_at: "2026-06-20T12:00:00.000Z",
    });
    const { sla } = computeLoanSLA(row, now);
    expect(sla).toBe("ALERT");
    const progress = deriveMilestoneProgress(row, now);
    expect(progress.underwriting).toBe("stalled");
  });
});
