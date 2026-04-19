import { describe, expect, it } from "vitest";

import { renderDigestBody, type DigestSignal } from "./morning-digest";

function makeSummary(overrides: Partial<Parameters<typeof renderDigestBody>[0]> = {}) {
  const topSignals: DigestSignal[] = [
    {
      id: "s1",
      signal_type: "ctc_stall",
      priority: 5,
      reason: "Clear-to-close 21d — should have funded",
      lo_name: "Bill Medley",
      computed_at: "2026-04-15T12:00:00Z",
      loan_id: "loan-1",
    },
    {
      id: "s2",
      signal_type: "rate_above_market",
      priority: 4,
      reason: "Note rate 7.50% is 1.00% above market (6.50%)",
      lo_name: "Brenden",
      computed_at: "2026-04-15T11:00:00Z",
      loan_id: "loan-2",
    },
  ];
  return {
    generatedAt: "2026-04-15T14:00:00Z",
    totalActive: 42,
    hotCount: 7,
    newLast24h: 3,
    topSignals,
    loTopList: [
      { loName: "Bill Medley", total: 20, hot: 4 },
      { loName: "Brenden", total: 12, hot: 2 },
    ],
    ...overrides,
  };
}

describe("renderDigestBody", () => {
  it("renders counts, top signals and LO rollup", () => {
    const md = renderDigestBody(makeSummary());
    expect(md).toContain("7 hot signals");
    expect(md).toContain("42 active");
    expect(md).toContain("3 new in the last 24h");
    expect(md).toContain("Top priorities");
    expect(md).toContain("Clear-to-close stall");
    expect(md).toContain("Rate above market");
    expect(md).toContain("Bill Medley: 20 signals · 4 hot");
  });

  it("skips top-priorities section when empty", () => {
    const md = renderDigestBody(makeSummary({ topSignals: [] }));
    expect(md).not.toContain("Top priorities");
    expect(md).toContain("LOs with the most signals");
  });
});
