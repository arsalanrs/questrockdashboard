import { describe, expect, it } from "vitest";
import { computeLifecyclePhase } from "./lifecycle";

describe("computeLifecyclePhase", () => {
  it("returns fund when funded", () => {
    expect(computeLifecyclePhase({ current_stage: "funded", validation_launched_at: null })).toBe("fund");
  });

  it("returns close for clear_to_close and closing", () => {
    expect(computeLifecyclePhase({ current_stage: "clear_to_close", validation_launched_at: "2024-01-01" })).toBe("close");
    expect(computeLifecyclePhase({ current_stage: "closing", validation_launched_at: null })).toBe("close");
  });

  it("returns validation when launch timestamp set and not close/fund", () => {
    expect(
      computeLifecyclePhase({ current_stage: "underwriting", validation_launched_at: "2024-01-01T00:00:00Z" }),
    ).toBe("validation");
  });

  it("returns verification when no launch", () => {
    expect(computeLifecyclePhase({ current_stage: "processing", validation_launched_at: null })).toBe("verification");
  });

  it("close wins over validation launch", () => {
    expect(
      computeLifecyclePhase({ current_stage: "clear_to_close", validation_launched_at: "2024-01-01T00:00:00Z" }),
    ).toBe("close");
  });
});
