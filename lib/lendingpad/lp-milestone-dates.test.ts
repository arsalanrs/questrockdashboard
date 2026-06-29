import { describe, expect, it } from "vitest";
import {
  approvedDateForDisplay,
  ctcDateForDisplay,
  lpMilestoneDatesFromListStatus,
  pipedDateForDisplay,
} from "./lp-milestone-dates";

describe("lpMilestoneDatesFromListStatus", () => {
  it("maps registered to submitted_to_processing_at", () => {
    expect(
      lpMilestoneDatesFromListStatus("Registered", "2026-03-01T00:00:00Z"),
    ).toEqual({ submitted_to_processing_at: "2026-03-01T00:00:00Z" });
  });

  it("maps clear to close to ctc_at", () => {
    expect(
      lpMilestoneDatesFromListStatus("Clear To Close", "2026-04-01T00:00:00Z"),
    ).toEqual({ ctc_at: "2026-04-01T00:00:00Z" });
  });
});

describe("display date helpers", () => {
  it("prefers stored dates over LP fallback", () => {
    expect(
      pipedDateForDisplay({
        conversion_date: "2026-01-01T00:00:00Z",
        lendingpad_status_raw: "Registered",
        lendingpad_status_at: "2026-02-01T00:00:00Z",
      }),
    ).toBe("2026-01-01T00:00:00Z");
  });

  it("uses LP status_at for CTC when ctc_at missing", () => {
    expect(
      ctcDateForDisplay({
        lendingpad_status_raw: "Clear To Close",
        lendingpad_status_at: "2026-04-06T00:00:00Z",
      }),
    ).toBe("2026-04-06T00:00:00Z");
  });

  it("uses LP status_at for approved", () => {
    expect(
      approvedDateForDisplay({
        lendingpad_status_raw: "Approved",
        lendingpad_status_at: "2026-03-15T00:00:00Z",
      }),
    ).toBe("2026-03-15T00:00:00Z");
  });
});
