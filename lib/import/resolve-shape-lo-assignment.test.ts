import { describe, expect, it } from "vitest";
import { resolveShapeLoAssignment } from "./resolve-shape-lo-assignment";

const lookup = {
  nameToUserId: new Map([["tyler johnson", "user-tyler"]]),
  emailToUserId: new Map([["tjohnson@questrock.com", "user-tyler"]]),
  users: [{ id: "user-tyler", full_name: "Tyler Johnson", email: "tjohnson@questrock.com" }],
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

  it("resolves depursLi id when depursLo is absent", () => {
    const res = resolveShapeLoAssignment(
      { "Shape Depurs LI Id": "3", "Loan Officer User Name": "" },
      lookup,
    );
    expect(res.loName).toBe("Nikk Smith");
    expect(res.shapeDepursLoId).toBe(3);
  });

  it("prefers depursLo over depursLi for roster name", () => {
    const res = resolveShapeLoAssignment(
      {
        "Shape Depurs LO Id": "34",
        "Shape Depurs LI Id": "3",
        "Loan Officer User Name": "",
      },
      lookup,
    );
    expect(res.loName).toBe("Tyler Johnson");
    expect(res.shapeDepursLoId).toBe(34);
    expect(res.assignedLoUserId).toBe("user-tyler");
  });

  it("resolves comma display name from Loan Officer User Name", () => {
    const res = resolveShapeLoAssignment(
      { "Loan Officer User Name": "Tyler, Johnson" },
      lookup,
    );
    expect(res.assignedLoUserId).toBe("user-tyler");
    expect(res.loName).toBeTruthy();
  });

  it("resolves depursLo email via roster and app user", () => {
    const res = resolveShapeLoAssignment(
      { "Loan Officer Email": "tjohnson@questrock.com" },
      lookup,
    );
    expect(res.loName).toBe("Tyler Johnson");
    expect(res.assignedLoUserId).toBe("user-tyler");
    expect(res.shapeDepursLoId).toBeNull();
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
