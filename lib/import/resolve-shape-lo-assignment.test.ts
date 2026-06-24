import { describe, expect, it } from "vitest";
import { resolveShapeLoAssignment } from "./resolve-shape-lo-assignment";

const lookup = {
  nameToUserId: new Map([["tyler johnson", "user-tyler"]]),
  users: [{ id: "user-tyler", full_name: "Tyler Johnson" }],
};

describe("resolveShapeLoAssignment", () => {
  it("resolves numeric depursLo in LO name field", () => {
    const res = resolveShapeLoAssignment(
      { "Loan Officer User Name": "34" },
      lookup,
    );
    expect(res.loName).toBe("Tyler Johnson");
    expect(res.assignedLoUserId).toBe("user-tyler");
    expect(res.shapeDepursLoId).toBe(34);
  });

  it("resolves explicit Shape Depurs LO Id column", () => {
    const res = resolveShapeLoAssignment(
      { "Shape Depurs LO Id": "34", "Loan Officer User Name": "" },
      lookup,
    );
    expect(res.loName).toBe("Tyler Johnson");
    expect(res.assignedLoUserId).toBe("user-tyler");
  });

  it("keeps concierge unassigned in app", () => {
    const res = resolveShapeLoAssignment(
      { "Loan Officer User Name": "Concierge Desk" },
      lookup,
    );
    expect(res.loName).toBe("Concierge Desk");
    expect(res.assignedLoUserId).toBeNull();
  });
});
