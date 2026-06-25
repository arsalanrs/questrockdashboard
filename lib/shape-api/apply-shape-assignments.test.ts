import { describe, expect, it } from "vitest";
import { applyShapeAssignmentFields } from "./apply-shape-assignments";
import { mapApiRecordToCsvLike } from "./field-map";

describe("applyShapeAssignmentFields", () => {
  it("prefers depursLo over depursLi for primary LO columns", () => {
    const out: Record<string, string> = {};
    applyShapeAssignmentFields(
      { depursLo: "34", depursLi: "3" },
      out,
    );
    expect(out["Shape Depurs LO Id"]).toBe("34");
    expect(out["Shape Depurs LI Id"]).toBe("3");
  });

  it("falls back to depursLi when depursLo is empty", () => {
    const out: Record<string, string> = {};
    applyShapeAssignmentFields({ depursLi: "3" }, out);
    expect(out["Shape Depurs LI Id"]).toBe("3");
    expect(out["Shape Depurs LO Id"]).toBe("3");
  });

  it("falls back through processor departments", () => {
    const out: Record<string, string> = {};
    applyShapeAssignmentFields({ depursPo: "22" }, out);
    expect(out["Shape Depurs PO Id"]).toBe("22");
    expect(out["Shape Depurs LO Id"]).toBe("22");
  });

  it("uses display name when dept ids are absent", () => {
    const out: Record<string, string> = {};
    applyShapeAssignmentFields(
      { "Loan Officer User Name": "Tyler, Johnson" },
      out,
    );
    expect(out["Loan Officer User Name"]).toBe("Tyler, Johnson");
  });
});

describe("mapApiRecordToCsvLike assignments", () => {
  it("maps lead 47568-style depursLi assignment", () => {
    const row = mapApiRecordToCsvLike({
      leadid: "47568",
      depursLi: "3",
      depursPo: "22",
    });
    expect(row["Shape Depurs LI Id"]).toBe("3");
    expect(row["Shape Depurs PO Id"]).toBe("22");
    expect(row["Shape Depurs LO Id"]).toBe("3");
  });
});
