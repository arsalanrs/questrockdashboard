import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildBasicAuthHeader,
  normalizeLendingPadLoanUuid,
  parseLendingPadConditionsResponse,
  parseLendingPadDocumentsResponse,
  parseLendingPadListLoansResponse,
} from "./parse-response";

describe("buildBasicAuthHeader", () => {
  it("encodes Basic auth", () => {
    const h = buildBasicAuthHeader("user", "secret");
    expect(h.startsWith("Basic ")).toBe(true);
    const b = Buffer.from(h.slice(6), "base64").toString("utf8");
    expect(b).toBe("user:secret");
  });
});

describe("normalizeLendingPadLoanUuid", () => {
  it("accepts valid UUID", () => {
    const u = "60658c8f-59a2-4163-8f00-4be4e42baea4";
    expect(normalizeLendingPadLoanUuid(u)).toBe(u);
  });
  it("rejects invalid", () => {
    expect(normalizeLendingPadLoanUuid("not-a-uuid")).toBeNull();
    expect(normalizeLendingPadLoanUuid("")).toBeNull();
  });
});

describe("parseLendingPadConditionsResponse", () => {
  it("parses array fixture", () => {
    const raw = JSON.parse(
      readFileSync(path.join(__dirname, "../../data/lendingpad-fixtures/conditions-array.json"), "utf8"),
    );
    const rows = parseLendingPadConditionsResponse(raw);
    expect(rows).toHaveLength(2);
    expect(rows[0].title).toBe("Sample underwriting condition");
    expect(rows[0].status).toBe("open");
    expect(rows[1].status).toBe("cleared");
  });

  it("parses wrapped fixture", () => {
    const raw = JSON.parse(
      readFileSync(path.join(__dirname, "../../data/lendingpad-fixtures/conditions-wrapped.json"), "utf8"),
    );
    const rows = parseLendingPadConditionsResponse(raw);
    expect(rows).toHaveLength(1);
    expect(rows[0].externalId).toBe("cond-001");
    expect(rows[0].status).toBe("open");
  });
});

describe("parseLendingPadListLoansResponse", () => {
  it("parses items array", () => {
    const raw = JSON.parse(
      readFileSync(path.join(__dirname, "../../data/lendingpad-fixtures/list-loans.json"), "utf8"),
    );
    const rows = parseLendingPadListLoansResponse(raw);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("11111111-2222-3333-4444-555555555555");
    expect(rows[0].loanNumber).toBe("LP-10001");
    expect(rows[0].statusRaw).toBeNull();
    expect(rows[0].statusAt).toBeNull();
    expect(rows[0].borrowerFirstName).toBeNull();
  });

  it("parses list row with loanStatus object (LendingPad guide shape)", () => {
    const raw = {
      data: [
        {
          id: "4598b1f0-b115-43d7-ab65-e9ee5ada745f",
          loanNumber: "030431",
          loanStatus: { id: 27, name: "Prospect" },
          loanStatusDate: "2022-12-07T00:00:00Z",
          borrowers: [{ firstName: "Borrower", lastName: "A" }],
          subjectPropertyAddress: { state: "NJ" },
          totalLoanAmount: 500000,
        },
      ],
    };
    const rows = parseLendingPadListLoansResponse(raw);
    expect(rows).toHaveLength(1);
    expect(rows[0].statusRaw).toBe("Prospect");
    expect(rows[0].statusAt).toBe("2022-12-07T00:00:00.000Z");
    expect(rows[0].borrowerFirstName).toBe("Borrower");
    expect(rows[0].propertyState).toBe("NJ");
    expect(rows[0].loanAmountCents).toBe(500000_00);
  });
});

describe("parseLendingPadDocumentsResponse", () => {
  it("parses document array", () => {
    const raw = {
      documents: [
        { id: "doc-1", name: "W2.pdf", category: "Income", uploadedAt: "2024-06-01" },
      ],
    };
    const rows = parseLendingPadDocumentsResponse(raw);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("W2.pdf");
  });
});
