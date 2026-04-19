import { describe, expect, it } from "vitest";

import { normalizeInsellerateRow } from "@/lib/import/insellerate";

function row(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    PrimaryAgentFirstName: "Bill Medley",
    StatusName: "Application",
    Campaign: "QuestRock Refi LP",
    PropertyState: "TX",
    MailingState: "TX",
    FirstName: "John",
    LastName: "Smith",
    Email: "john@example.com",
    MobilePhone: "5551234567",
    AppCreateDate: "5/27/22 12:41",
    PostDate: "5/27/22 12:41",
    CurrentActivityDate: "6/1/22 09:00",
    CurrentStatusDate: "6/1/22 09:00",
    "ProposedLoanTypeName-First": "Conventional",
    "ProposedLoanPurposeTypeName-First": "Refinance",
    ProposedLoanRate: "6.875",
    ProposedInitialLoanAmount: "350000",
    EstimatedValue: "500000",
    "CurrentLoanBalance-First": "280000",
    CurrentLTV: "56",
    DTI: "38",
    CreditScore: "720",
    Veteran: "FALSE",
    SelfEmployed: "FALSE",
    Notes: "",
    ...overrides,
  };
}

describe("normalizeInsellerateRow", () => {
  it("maps active status to pipeline stage and marks as active", () => {
    const n = normalizeInsellerateRow(row({ StatusName: "Piped" }));
    expect(n.rawStatus).toBe("Piped");
    expect(n.stage).toBe("submission");
    expect(n.isActive).toBe(true);
  });

  it("maps Approved to approval_conditions (matches Shape mapping)", () => {
    const n = normalizeInsellerateRow(row({ StatusName: "Approved" }));
    expect(n.stage).toBe("approval_conditions");
    expect(n.isActive).toBe(true);
  });

  it("maps Clear to Close to clear_to_close", () => {
    const n = normalizeInsellerateRow(row({ StatusName: "Clear to Close" }));
    expect(n.stage).toBe("clear_to_close");
    expect(n.isActive).toBe(true);
  });

  it("marks funded as not active but mapped", () => {
    const n = normalizeInsellerateRow(row({ StatusName: "Funded" }));
    expect(n.stage).toBe("funded");
    expect(n.isActive).toBe(false);
  });

  it("leaves inactive statuses unmapped but captured in historical", () => {
    const n = normalizeInsellerateRow(row({ StatusName: "Long Term Nurture" }));
    expect(n.rawStatus).toBe("Long Term Nurture");
    expect(n.stage).toBeNull();
    expect(n.isActive).toBe(false);
  });

  it("flags Do Not Contact", () => {
    const n = normalizeInsellerateRow(row({ StatusName: "Do Not Contact" }));
    expect(n.doNotContact).toBe(true);
    expect(n.isActive).toBe(false);
  });

  it("parses money to cents and rate to bps", () => {
    const n = normalizeInsellerateRow(
      row({ ProposedInitialLoanAmount: "$350,000.00", ProposedLoanRate: "6.875%" })
    );
    expect(n.loanAmountCents).toBe(35_000_000);
    expect(n.noteRateBps).toBe(688);
  });

  it("parses LTV and DTI consistently as bps", () => {
    const n = normalizeInsellerateRow(row({ CurrentLTV: "75", DTI: "0.42" }));
    expect(n.ltvBps).toBe(7500);
    expect(n.dtiBps).toBe(4200);
  });

  it("picks best available phone", () => {
    const n = normalizeInsellerateRow(
      row({ MobilePhone: "", HomePhone: "", WorkPhone: "5559999999" })
    );
    expect(n.phone).toBe("5559999999");
  });

  it("produces stable externalRefId for same inputs", () => {
    const a = normalizeInsellerateRow(row());
    const b = normalizeInsellerateRow(row());
    expect(a.externalRefId).toBe(b.externalRefId);
    expect(a.externalRefId.startsWith("ins:")).toBe(true);
  });

  it("differs across different emails", () => {
    const a = normalizeInsellerateRow(row({ Email: "a@example.com" }));
    const b = normalizeInsellerateRow(row({ Email: "b@example.com" }));
    expect(a.externalRefId).not.toBe(b.externalRefId);
  });

  it("parses 2-digit year timestamps", () => {
    const n = normalizeInsellerateRow(row({ AppCreateDate: "5/27/22 12:41" }));
    expect(n.createdAtSource).not.toBeNull();
    expect(n.createdAtSource!.startsWith("2022-05-27")).toBe(true);
  });
});
