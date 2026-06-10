import { describe, expect, it } from "vitest";
import { computeSignalsForLoans, groupSignalsByLO, groupSignalsByType } from "./run";
import type { SignalLoanRow } from "./types";

const NOW = new Date("2026-04-15T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function makeLoan(overrides: Partial<SignalLoanRow> = {}): SignalLoanRow {
  const { first_payment_date, note_date, ...rest } = overrides;
  return {
    id: "loan-1",
    current_stage: null,
    status_raw: null,
    loan_amount_cents: 500_000_00,
    appraisal_ordered_at: null,
    closed_at: null,
    closing_date: null,
    esign_returned_at: null,
    esign_requested_at: null,
    application_completed_at: null,
    submitted_to_processing_at: null,
    submitted_to_uw_at: null,
    ctc_at: null,
    lead_created_at: null,
    assigned_loan_officer_user_id: "lo-1",
    assigned_loan_officer_name: "Bill Medley",
    borrower_first_name: "Jane",
    borrower_last_name: "Doe",
    loan_type: "Conventional",
    loan_purpose: "Purchase",
    shape_record_id: 1234,
    lendingpad_loan_uuid: null,
    is_restructure_hold: false,
    note_rate_bps: null,
    original_rate_bps: null,
    property_value_cents: null,
    current_loan_balance_cents: null,
    ltv_bps: null,
    cltv_bps: null,
    dti_bps: null,
    credit_score_mid: null,
    is_veteran: null,
    arm_first_reset_date: null,
    arm_index: null,
    arm_margin_bps: null,
    do_not_contact: null,
    last_contacted_at: null,
    funded_at: null,
    loan_age_months: null,
    lead_tier: null,
    epo_date: null,
    epo_window_activated: null,
    reengagement_8month_completed_at: null,
    appraisal_received_at: null,
    first_payment_date: first_payment_date ?? null,
    note_date: note_date ?? null,
    ...rest,
  };
}

describe("detectPipedNeverClosed", () => {
  it("fires when appraisal ordered 30d ago and not closed", () => {
    const appraisalOrdered = new Date(NOW.getTime() - 30 * DAY).toISOString();
    const signals = computeSignalsForLoans({
      loans: [makeLoan({ appraisal_ordered_at: appraisalOrdered, current_stage: "processing" })],
      events: [],
      conditions: [],
      now: NOW,
    });
    const piped = signals.filter((s) => s.signalType === "piped_never_closed");
    expect(piped).toHaveLength(1);
    expect(piped[0].priority).toBe(4);
  });

  it("does not fire before 14d grace period", () => {
    const appraisalOrdered = new Date(NOW.getTime() - 10 * DAY).toISOString();
    const signals = computeSignalsForLoans({
      loans: [makeLoan({ appraisal_ordered_at: appraisalOrdered })],
      events: [],
      conditions: [],
      now: NOW,
    });
    expect(signals.filter((s) => s.signalType === "piped_never_closed")).toHaveLength(0);
  });

  it("does not fire when already closed", () => {
    const signals = computeSignalsForLoans({
      loans: [
        makeLoan({
          appraisal_ordered_at: new Date(NOW.getTime() - 60 * DAY).toISOString(),
          closed_at: NOW.toISOString(),
        }),
      ],
      events: [],
      conditions: [],
      now: NOW,
    });
    expect(signals.filter((s) => s.signalType === "piped_never_closed")).toHaveLength(0);
  });

  it("does not fire when denied/withdrawn", () => {
    const signals = computeSignalsForLoans({
      loans: [
        makeLoan({
          appraisal_ordered_at: new Date(NOW.getTime() - 40 * DAY).toISOString(),
          status_raw: "Denied - Credit",
        }),
      ],
      events: [],
      conditions: [],
      now: NOW,
    });
    expect(signals.filter((s) => s.signalType === "piped_never_closed")).toHaveLength(0);
  });
});

describe("detectAppNoMovement", () => {
  it("fires for application stage with last event > 30d", () => {
    const loan = makeLoan({ id: "l2", current_stage: "application" });
    const signals = computeSignalsForLoans({
      loans: [loan],
      events: [
        { loan_id: "l2", stage: "application", entered_at: new Date(NOW.getTime() - 45 * DAY).toISOString() },
      ],
      conditions: [],
      now: NOW,
    });
    const m = signals.filter((s) => s.signalType === "app_no_movement");
    expect(m).toHaveLength(1);
    expect(m[0].meta?.daysStale).toBe(45);
  });

  it("escalates to priority 5 at 90d+", () => {
    const loan = makeLoan({ id: "l3", current_stage: "underwriting" });
    const signals = computeSignalsForLoans({
      loans: [loan],
      events: [
        { loan_id: "l3", stage: "underwriting", entered_at: new Date(NOW.getTime() - 100 * DAY).toISOString() },
      ],
      conditions: [],
      now: NOW,
    });
    const m = signals.find((s) => s.signalType === "app_no_movement");
    expect(m?.priority).toBe(5);
  });

  it("uses lead_created_at when no stage events", () => {
    const loan = makeLoan({
      id: "l4",
      current_stage: "processing",
      lead_created_at: new Date(NOW.getTime() - 50 * DAY).toISOString(),
    });
    const signals = computeSignalsForLoans({ loans: [loan], events: [], conditions: [], now: NOW });
    expect(signals.some((s) => s.signalType === "app_no_movement")).toBe(true);
  });
});

describe("detectApprovedNeverFunded", () => {
  it("fires for status containing 'approved' and not funded", () => {
    const loan = makeLoan({
      id: "l5",
      status_raw: "Approved with Conditions",
      current_stage: "approval_conditions",
      lead_created_at: new Date(NOW.getTime() - 45 * DAY).toISOString(),
    });
    const signals = computeSignalsForLoans({ loans: [loan], events: [], conditions: [], now: NOW });
    expect(signals.some((s) => s.signalType === "approved_never_funded")).toBe(true);
  });

  it("does not fire for Denied", () => {
    const loan = makeLoan({
      id: "l6",
      status_raw: "Denied - approved then pulled",
      lead_created_at: new Date(NOW.getTime() - 45 * DAY).toISOString(),
    });
    const signals = computeSignalsForLoans({ loans: [loan], events: [], conditions: [], now: NOW });
    expect(signals.some((s) => s.signalType === "approved_never_funded")).toBe(false);
  });
});

describe("detectCtcStall", () => {
  it("fires for clear_to_close stuck > 7d", () => {
    const loan = makeLoan({ id: "l7", current_stage: "clear_to_close" });
    const signals = computeSignalsForLoans({
      loans: [loan],
      events: [
        { loan_id: "l7", stage: "clear_to_close", entered_at: new Date(NOW.getTime() - 10 * DAY).toISOString() },
      ],
      conditions: [],
      now: NOW,
    });
    expect(signals.some((s) => s.signalType === "ctc_stall")).toBe(true);
  });

  it("hits priority 5 at 21d+", () => {
    const loan = makeLoan({ id: "l8", current_stage: "clear_to_close" });
    const signals = computeSignalsForLoans({
      loans: [loan],
      events: [
        { loan_id: "l8", stage: "clear_to_close", entered_at: new Date(NOW.getTime() - 25 * DAY).toISOString() },
      ],
      conditions: [],
      now: NOW,
    });
    const m = signals.find((s) => s.signalType === "ctc_stall");
    expect(m?.priority).toBe(5);
  });
});

describe("detectEsignStuck", () => {
  it("fires when esign_out > 3 days with no return", () => {
    const loan = makeLoan({
      id: "l9",
      current_stage: "esign_out",
      esign_requested_at: new Date(NOW.getTime() - 4 * DAY).toISOString(),
    });
    const signals = computeSignalsForLoans({ loans: [loan], events: [], conditions: [], now: NOW });
    expect(signals.some((s) => s.signalType === "esign_stuck")).toBe(true);
  });

  it("does not fire if esign_returned_at set", () => {
    const loan = makeLoan({
      id: "l10",
      current_stage: "esign_out",
      esign_requested_at: new Date(NOW.getTime() - 10 * DAY).toISOString(),
      esign_returned_at: new Date(NOW.getTime() - 2 * DAY).toISOString(),
    });
    const signals = computeSignalsForLoans({ loans: [loan], events: [], conditions: [], now: NOW });
    expect(signals.some((s) => s.signalType === "esign_stuck")).toBe(false);
  });
});

describe("ranking + grouping", () => {
  it("groupSignalsByLO tallies counts", () => {
    const loans: SignalLoanRow[] = [
      makeLoan({
        id: "a",
        appraisal_ordered_at: new Date(NOW.getTime() - 40 * DAY).toISOString(),
        assigned_loan_officer_user_id: "lo-1",
        assigned_loan_officer_name: "Bill Medley",
      }),
      makeLoan({
        id: "b",
        current_stage: "clear_to_close",
        assigned_loan_officer_user_id: "lo-2",
        assigned_loan_officer_name: "Brenden",
      }),
    ];
    const signals = computeSignalsForLoans({
      loans,
      events: [{ loan_id: "b", stage: "clear_to_close", entered_at: new Date(NOW.getTime() - 15 * DAY).toISOString() }],
      conditions: [],
      now: NOW,
    });
    const byLo = groupSignalsByLO(signals);
    expect(byLo.length).toBeGreaterThanOrEqual(2);
    expect(byLo.map((r) => r.loName).sort()).toEqual(["Bill Medley", "Brenden"]);
  });

  it("groupSignalsByType returns a map keyed by SignalType", () => {
    const signals = computeSignalsForLoans({
      loans: [
        makeLoan({
          appraisal_ordered_at: new Date(NOW.getTime() - 40 * DAY).toISOString(),
        }),
      ],
      events: [],
      conditions: [],
      now: NOW,
    });
    const byType = groupSignalsByType(signals);
    expect(byType.has("piped_never_closed")).toBe(true);
  });

  it("ranks highest priority first", () => {
    const loans: SignalLoanRow[] = [
      makeLoan({ id: "low", appraisal_ordered_at: new Date(NOW.getTime() - 20 * DAY).toISOString() }),
      makeLoan({ id: "high", appraisal_ordered_at: new Date(NOW.getTime() - 70 * DAY).toISOString() }),
    ];
    const signals = computeSignalsForLoans({ loans, events: [], conditions: [], now: NOW });
    expect(signals[0].loanId).toBe("high");
  });
});
