import { describe, expect, it } from "vitest";
import { parseDepursLoValue } from "./parse-depurs-lo-value";
import { mapApiRecordToCsvLike } from "./field-map";

describe("parseDepursLoValue", () => {
  it("parses numeric depursLo id", () => {
    expect(parseDepursLoValue("34")).toEqual({ id: 34, email: null, name: null });
    expect(parseDepursLoValue(3)).toEqual({ id: 3, email: null, name: null });
  });

  it("parses depursLo email", () => {
    expect(parseDepursLoValue("tylerjohnson@questrock.com")).toEqual({
      id: null,
      email: "tylerjohnson@questrock.com",
      name: null,
    });
  });

  it("parses depursLo display name", () => {
    expect(parseDepursLoValue("Tyler Johnson")).toEqual({
      id: null,
      email: null,
      name: "Tyler Johnson",
    });
  });

  it("rejects loan amounts mistaken for ids", () => {
    expect(parseDepursLoValue("522750")).toEqual({ id: null, email: null, name: null });
  });
});

describe("mapApiRecordToCsvLike depursLo", () => {
  it("maps email depursLo to Loan Officer Email", () => {
    const row = mapApiRecordToCsvLike({
      leadid: "47568",
      depursLo: "tylerjohnson@questrock.com",
    });
    expect(row["Loan Officer Email"]).toBe("tylerjohnson@questrock.com");
    expect(row["Shape Depurs LO Id"]).toBeUndefined();
  });

  it("maps numeric depursLo to Shape Depurs LO Id", () => {
    const row = mapApiRecordToCsvLike({
      leadid: "47568",
      depursLo: "34",
    });
    expect(row["Shape Depurs LO Id"]).toBe("34");
  });

  it("maps depursLi to Shape Depurs LI Id and LO columns as fallback", () => {
    const row = mapApiRecordToCsvLike({
      leadid: "47568",
      depursLi: "3",
    });
    expect(row["Shape Depurs LI Id"]).toBe("3");
    expect(row["Shape Depurs LO Id"]).toBe("3");
  });
});
