import { describe, expect, it } from "vitest";
import { mapLendingPadStatusToStage } from "./map-lp-status-to-stage";

describe("mapLendingPadStatusToStage", () => {
  it("maps common LP labels", () => {
    expect(mapLendingPadStatusToStage("Processing")).toBe("processing");
    expect(mapLendingPadStatusToStage("Clear To Close")).toBe("clear_to_close");
    expect(mapLendingPadStatusToStage("Funded")).toBe("funded");
    expect(mapLendingPadStatusToStage("Pre Qualify")).toBe("application");
    expect(mapLendingPadStatusToStage("Submitted to UW")).toBe("underwriting");
  });
  it("returns null for unknown", () => {
    expect(mapLendingPadStatusToStage("Custom Vendor Status")).toBeNull();
    expect(mapLendingPadStatusToStage("")).toBeNull();
  });
});
