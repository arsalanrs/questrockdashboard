import { describe, expect, it } from "vitest";

import { OUTCOME_WINDOW_DAYS, computeOutcome } from "./outcomes";

const NOW = new Date("2026-04-15T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function mkSignal(overrides: Record<string, unknown> = {}) {
  return {
    id: "sig-1",
    loan_id: "loan-1",
    signal_type: "ctc_stall",
    priority: 4,
    computed_at: new Date(NOW.getTime() - 10 * DAY).toISOString(),
    dismissed_at: null,
    dismissed_by: null,
    ...overrides,
  } as Parameters<typeof computeOutcome>[0];
}

function mkLoan(overrides: Record<string, unknown> = {}) {
  return {
    id: "loan-1",
    current_stage: "processing",
    status_raw: "Processing",
    funded_at: null,
    closed_at: null,
    ...overrides,
  } as Parameters<typeof computeOutcome>[1];
}

describe("computeOutcome", () => {
  it("labels loans that closed within the window as closed_within_window", () => {
    const o = computeOutcome(
      mkSignal(),
      mkLoan({ funded_at: new Date(NOW.getTime() - 2 * DAY).toISOString(), current_stage: "funded" }),
      NOW
    );
    expect(o?.outcome_kind).toBe("closed_within_window");
    expect(o?.days_from_signal).toBe(8);
  });

  it("labels dismissed_by_exec when dismissed_by is set", () => {
    const o = computeOutcome(
      mkSignal({ dismissed_at: NOW.toISOString(), dismissed_by: "user-1" }),
      mkLoan(),
      NOW
    );
    expect(o?.outcome_kind).toBe("dismissed_by_exec");
  });

  it("labels resolved_other when auto-dismissed (no user)", () => {
    const o = computeOutcome(
      mkSignal({ dismissed_at: NOW.toISOString() }),
      mkLoan(),
      NOW
    );
    expect(o?.outcome_kind).toBe("resolved_other");
  });

  it("labels loan_withdrawn_denied when status goes to denied", () => {
    const o = computeOutcome(mkSignal(), mkLoan({ status_raw: "Denied" }), NOW);
    expect(o?.outcome_kind).toBe("loan_withdrawn_denied");
  });

  it("labels stale_no_movement when signal is older than the window", () => {
    const oldSignal = mkSignal({
      computed_at: new Date(NOW.getTime() - (OUTCOME_WINDOW_DAYS + 5) * DAY).toISOString(),
    });
    const o = computeOutcome(oldSignal, mkLoan(), NOW);
    expect(o?.outcome_kind).toBe("stale_no_movement");
    expect(o?.days_from_signal).toBe(OUTCOME_WINDOW_DAYS);
  });

  it("returns null when the signal is young and nothing has happened yet", () => {
    const o = computeOutcome(mkSignal(), mkLoan(), NOW);
    expect(o).toBeNull();
  });

  it("does not count closes outside the window", () => {
    // Signal fired long ago, loan funded well after the 45-day window closed.
    const oldSignal = mkSignal({
      computed_at: new Date(NOW.getTime() - 100 * DAY).toISOString(),
    });
    const o = computeOutcome(
      oldSignal,
      mkLoan({ funded_at: new Date(NOW.getTime() - 1 * DAY).toISOString() }),
      NOW
    );
    // funded 99 days after the signal — outside the 45-day window — so this
    // should be labeled as stale_no_movement, not closed_within_window.
    expect(o?.outcome_kind).toBe("stale_no_movement");
  });
});
