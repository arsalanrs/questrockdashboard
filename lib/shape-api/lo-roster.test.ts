import { describe, expect, it, afterEach } from "vitest";
import {
  parseShapeDepursLoId,
  resolveDepursLoIdToName,
  resolveNameToDepursLoId,
  resetShapeLoRosterCacheForTests,
} from "./lo-roster";

afterEach(() => {
  delete process.env.SHAPE_LO_ROSTER_JSON;
  resetShapeLoRosterCacheForTests();
});

describe("lo-roster", () => {
  it("maps depursLo id to display name", () => {
    expect(resolveDepursLoIdToName(34)).toBe("Tyler Johnson");
    expect(resolveDepursLoIdToName(58)).toBe("Gregory Bethea Jr");
  });

  it("parses numeric owner id strings", () => {
    expect(parseShapeDepursLoId("34")).toBe(34);
    expect(parseShapeDepursLoId("Tyler Johnson")).toBeNull();
  });

  it("maps display name to depursLo id", () => {
    expect(resolveNameToDepursLoId("Tyler Johnson")).toBe(34);
    expect(resolveNameToDepursLoId("Gregory Bethea Jr")).toBe(58);
  });
});
