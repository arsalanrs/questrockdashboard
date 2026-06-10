import { describe, expect, it } from "vitest";

import { generatePlaybookFromTemplate, type PlaybookInput } from "./playbooks";
import type { SignalType } from "@/lib/signals/types";

function makeInput(overrides: Partial<PlaybookInput> = {}): PlaybookInput {
  return {
    signalType: overrides.signalType ?? "piped_never_closed",
    reason: overrides.reason ?? "test reason",
    priority: overrides.priority ?? 3,
    meta: overrides.meta ?? {},
    loan: {
      id: "loan-1",
      borrowerFirstName: "Jane",
      borrowerLastName: "Doe",
      loanAmountCents: 400_000_00,
      loanType: "Conventional",
      loanPurpose: "Refinance",
      currentStage: "processing",
      propertyState: "TX",
      loName: "Bill Medley",
      ...(overrides.loan ?? {}),
    },
  };
}

const ALL_TYPES: SignalType[] = [
  "piped_never_closed",
  "app_no_movement",
  "approved_never_funded",
  "ctc_stall",
  "esign_stuck",
  "rate_above_market",
  "cash_out_candidate",
  "fha_to_conventional",
  "va_irrrl",
  "arm_reset_window",
  "credit_score_improved",
  "never_contacted",
  "pre_signature",
  "packaged_not_closed",
  "ctc_expired",
  "appraisal_ordered_stalled",
  "closing_8month_due",
  "book_checkin_6m",
  "book_checkin_12m",
  "post_close_skip_payment_due",
  "first_payment_touch",
  "fha_seasoning_prep",
  "arm_book_checkin_due",
  "orange_pipeline_hot",
  "epo_window_opening",
];

describe("generatePlaybookFromTemplate", () => {
  it("produces a playbook for every signal type", () => {
    for (const t of ALL_TYPES) {
      const p = generatePlaybookFromTemplate(makeInput({ signalType: t }));
      expect(p.headline).toBeTruthy();
      expect(p.callScript).toBeTruthy();
      expect(p.email.subject).toBeTruthy();
      expect(p.email.body).toBeTruthy();
      expect(Array.isArray(p.nextSteps)).toBe(true);
      expect(p.nextSteps.length).toBeGreaterThan(0);
      expect(p.source).toBe("template");
    }
  });

  it("uses borrower first name in the call script when available", () => {
    const p = generatePlaybookFromTemplate(
      makeInput({
        signalType: "rate_above_market",
        meta: { noteRateBps: 750, marketBps: 650, deltaBps: 100 },
      })
    );
    expect(p.callScript).toContain("Jane");
    expect(p.email.body).toContain("Jane");
  });

  it("uses LO name when available", () => {
    const p = generatePlaybookFromTemplate(makeInput());
    expect(p.callScript).toContain("Bill Medley");
  });

  it("falls back when borrower or LO name is missing", () => {
    const p = generatePlaybookFromTemplate(
      makeInput({
        loan: {
          id: "loan-1",
          borrowerFirstName: null,
          borrowerLastName: null,
          loanAmountCents: null,
          loanType: null,
          loanPurpose: null,
          currentStage: null,
          propertyState: null,
          loName: null,
        },
      })
    );
    expect(p.callScript).toContain("there");
    expect(p.callScript).toContain("your Quest Rock loan officer");
  });

  it("includes meta numbers in rate_above_market playbook", () => {
    const p = generatePlaybookFromTemplate(
      makeInput({
        signalType: "rate_above_market",
        meta: { noteRateBps: 800, marketBps: 650, deltaBps: 150 },
      })
    );
    expect(p.headline).toContain("1.50%");
    expect(p.callScript).toContain("8.00%");
    expect(p.callScript).toContain("6.50%");
  });
});
