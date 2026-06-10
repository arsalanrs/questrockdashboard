import { describe, expect, it } from "vitest";

import { computeSignalsForLoans } from "./run";
import type { MarketRate, SignalLoanRow } from "./types";

const NOW = new Date("2026-04-15T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function makeFundedLoan(overrides: Partial<SignalLoanRow> = {}): SignalLoanRow {
  const { first_payment_date, note_date, ...rest } = overrides;
  const fundedAt = new Date(NOW.getTime() - 24 * 30 * DAY).toISOString(); // 24 months ago
  return {
    id: "loan-funded",
    current_stage: "funded",
    status_raw: "Funded",
    loan_amount_cents: 400_000_00,
    appraisal_ordered_at: null,
    closed_at: fundedAt,
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
    shape_record_id: 1,
    lendingpad_loan_uuid: null,
    is_restructure_hold: false,
    note_rate_bps: null,
    original_rate_bps: null,
    property_value_cents: null,
    current_loan_balance_cents: null,
    ltv_bps: null,
    cltv_bps: null,
    dti_bps: null,
    credit_score_mid: 720,
    is_veteran: null,
    arm_first_reset_date: null,
    arm_index: null,
    arm_margin_bps: null,
    do_not_contact: false,
    last_contacted_at: null,
    funded_at: fundedAt,
    loan_age_months: 24,
    lead_tier: "GREEN",
    epo_date: null,
    epo_window_activated: false,
    reengagement_8month_completed_at: null,
    appraisal_received_at: null,
    first_payment_date: first_payment_date ?? null,
    note_date: note_date ?? null,
    ...rest,
  };
}

const RATES: MarketRate[] = [
  { loan_type: "Conventional", term_years: 30, rate_bps: 650, quote_date: "2026-04-14" },
  { loan_type: "FHA", term_years: 30, rate_bps: 625, quote_date: "2026-04-14" },
  { loan_type: "VA", term_years: 30, rate_bps: 600, quote_date: "2026-04-14" },
];

describe("detectRateAboveMarket", () => {
  it("fires when note rate is ≥ 50bps above market", () => {
    const signals = computeSignalsForLoans({
      loans: [makeFundedLoan({ note_rate_bps: 750 })], // 100bps above 6.50
      events: [],
      conditions: [],
      marketRates: RATES,
      now: NOW,
    });
    const hits = signals.filter((s) => s.signalType === "rate_above_market");
    expect(hits).toHaveLength(1);
    expect(hits[0].priority).toBe(4);
    expect(hits[0].meta?.deltaBps).toBe(100);
  });

  it("does not fire under threshold", () => {
    const signals = computeSignalsForLoans({
      loans: [makeFundedLoan({ note_rate_bps: 680 })], // only 30bps above
      events: [],
      conditions: [],
      marketRates: RATES,
      now: NOW,
    });
    expect(signals.filter((s) => s.signalType === "rate_above_market")).toHaveLength(0);
  });

  it("does not fire on in-flight pipeline loans", () => {
    const signals = computeSignalsForLoans({
      loans: [
        makeFundedLoan({
          note_rate_bps: 800,
          current_stage: "processing",
          closed_at: null,
          funded_at: null,
          status_raw: "Processing",
        }),
      ],
      events: [],
      conditions: [],
      marketRates: RATES,
      now: NOW,
    });
    expect(signals.filter((s) => s.signalType === "rate_above_market")).toHaveLength(0);
  });

  it("respects do_not_contact", () => {
    const signals = computeSignalsForLoans({
      loans: [makeFundedLoan({ note_rate_bps: 800, do_not_contact: true })],
      events: [],
      conditions: [],
      marketRates: RATES,
      now: NOW,
    });
    expect(signals.filter((s) => s.signalType === "rate_above_market")).toHaveLength(0);
  });
});

describe("detectCashOutCandidate", () => {
  it("fires when equity ≥ $75k and LTV reasonable", () => {
    const signals = computeSignalsForLoans({
      loans: [
        makeFundedLoan({
          property_value_cents: 600_000_00,
          current_loan_balance_cents: 300_000_00, // $300k equity
          ltv_bps: 5000, // 50%
        }),
      ],
      events: [],
      conditions: [],
      marketRates: RATES,
      now: NOW,
    });
    const hits = signals.filter((s) => s.signalType === "cash_out_candidate");
    expect(hits).toHaveLength(1);
    expect(hits[0].meta?.equityCents).toBe(300_000_00);
  });

  it("does not fire when equity is small", () => {
    const signals = computeSignalsForLoans({
      loans: [
        makeFundedLoan({
          property_value_cents: 400_000_00,
          current_loan_balance_cents: 350_000_00, // only $50k equity
        }),
      ],
      events: [],
      conditions: [],
      marketRates: RATES,
      now: NOW,
    });
    expect(signals.filter((s) => s.signalType === "cash_out_candidate")).toHaveLength(0);
  });
});

describe("detectFhaToConventional", () => {
  it("fires on FHA with LTV ≤ 80% and FICO ≥ 680", () => {
    const signals = computeSignalsForLoans({
      loans: [makeFundedLoan({ loan_type: "FHA", ltv_bps: 7500, credit_score_mid: 720 })],
      events: [],
      conditions: [],
      marketRates: RATES,
      now: NOW,
    });
    expect(signals.filter((s) => s.signalType === "fha_to_conventional")).toHaveLength(1);
  });

  it("does not fire when LTV too high", () => {
    const signals = computeSignalsForLoans({
      loans: [makeFundedLoan({ loan_type: "FHA", ltv_bps: 8500 })],
      events: [],
      conditions: [],
      marketRates: RATES,
      now: NOW,
    });
    expect(signals.filter((s) => s.signalType === "fha_to_conventional")).toHaveLength(0);
  });

  it("does not fire on non-FHA loans", () => {
    const signals = computeSignalsForLoans({
      loans: [makeFundedLoan({ loan_type: "Conventional", ltv_bps: 7000 })],
      events: [],
      conditions: [],
      marketRates: RATES,
      now: NOW,
    });
    expect(signals.filter((s) => s.signalType === "fha_to_conventional")).toHaveLength(0);
  });
});

describe("detectVaIrrrl", () => {
  it("fires on 24-month-old VA loan with rate edge", () => {
    const signals = computeSignalsForLoans({
      loans: [
        makeFundedLoan({
          loan_type: "VA",
          note_rate_bps: 700, // 100bps above VA market (600)
          loan_age_months: 24,
        }),
      ],
      events: [],
      conditions: [],
      marketRates: RATES,
      now: NOW,
    });
    const hits = signals.filter((s) => s.signalType === "va_irrrl");
    expect(hits).toHaveLength(1);
    expect(hits[0].meta?.loanAgeMonths).toBe(24);
  });

  it("does not fire outside age window", () => {
    const signals = computeSignalsForLoans({
      loans: [makeFundedLoan({ loan_type: "VA", loan_age_months: 3 })],
      events: [],
      conditions: [],
      marketRates: RATES,
      now: NOW,
    });
    expect(signals.filter((s) => s.signalType === "va_irrrl")).toHaveLength(0);
  });

  it("does not fire when rate is too close to market", () => {
    const signals = computeSignalsForLoans({
      loans: [
        makeFundedLoan({ loan_type: "VA", note_rate_bps: 610, loan_age_months: 24 }),
      ],
      events: [],
      conditions: [],
      marketRates: RATES,
      now: NOW,
    });
    expect(signals.filter((s) => s.signalType === "va_irrrl")).toHaveLength(0);
  });
});

describe("detectArmResetWindow", () => {
  it("fires when ARM reset is within 6 months", () => {
    const reset = new Date(NOW.getTime() + 90 * DAY).toISOString().slice(0, 10);
    const signals = computeSignalsForLoans({
      loans: [makeFundedLoan({ arm_first_reset_date: reset })],
      events: [],
      conditions: [],
      marketRates: RATES,
      now: NOW,
    });
    const hits = signals.filter((s) => s.signalType === "arm_reset_window");
    expect(hits).toHaveLength(1);
    expect(hits[0].priority).toBe(4);
  });

  it("fires with highest priority when reset is imminent", () => {
    const reset = new Date(NOW.getTime() + 14 * DAY).toISOString().slice(0, 10);
    const signals = computeSignalsForLoans({
      loans: [makeFundedLoan({ arm_first_reset_date: reset })],
      events: [],
      conditions: [],
      marketRates: RATES,
      now: NOW,
    });
    const hits = signals.filter((s) => s.signalType === "arm_reset_window");
    expect(hits).toHaveLength(1);
    expect(hits[0].priority).toBe(5);
  });

  it("does not fire when reset is far out", () => {
    const reset = new Date(NOW.getTime() + 365 * DAY).toISOString().slice(0, 10);
    const signals = computeSignalsForLoans({
      loans: [makeFundedLoan({ arm_first_reset_date: reset })],
      events: [],
      conditions: [],
      marketRates: RATES,
      now: NOW,
    });
    expect(signals.filter((s) => s.signalType === "arm_reset_window")).toHaveLength(0);
  });
});
