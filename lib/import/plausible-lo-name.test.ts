import { describe, expect, it } from "vitest";
import { isPlausibleLoName } from "./plausible-lo-name";

describe("isPlausibleLoName", () => {
  it("rejects loan amounts and loan types", () => {
    expect(isPlausibleLoName("150000")).toBe(false);
    expect(isPlausibleLoName("295000")).toBe(false);
    expect(isPlausibleLoName("Purchase")).toBe(false);
    expect(isPlausibleLoName("Refinance")).toBe(false);
    expect(isPlausibleLoName("Other")).toBe(false);
  });

  it("accepts real LO names", () => {
    expect(isPlausibleLoName("Tyler Johnson")).toBe(true);
    expect(isPlausibleLoName("Nikk, Smith")).toBe(true);
    expect(isPlausibleLoName("Gregory Bethea Jr")).toBe(true);
    expect(isPlausibleLoName("Concierge Desk")).toBe(true);
  });
});
