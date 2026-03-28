import { describe, it, expect, afterEach } from "vitest";
import { parseLendingPadOfficersJson, hasLendingPadListLoansConfig } from "./config";

describe("parseLendingPadOfficersJson", () => {
  afterEach(() => {
    delete process.env.LENDINGPAD_OFFICERS_JSON;
    delete process.env.LENDINGPAD_USERNAME;
    delete process.env.LENDINGPAD_PASSWORD;
    delete process.env.LENDINGPAD_CONTACT_ID;
    delete process.env.LENDINGPAD_COMPANY_ID;
    delete process.env.LENDINGPAD_LIST_USER_ID;
  });

  it("returns empty when unset", () => {
    const r = parseLendingPadOfficersJson();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.officers).toEqual([]);
  });

  it("parses camelCase and snake_case", () => {
    process.env.LENDINGPAD_OFFICERS_JSON = JSON.stringify([
      { officerName: "A B", listUserId: "11111111-1111-1111-1111-111111111111" },
      { officer_name: "C D", list_user_id: "22222222-2222-2222-2222-222222222222" },
    ]);
    const r = parseLendingPadOfficersJson();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.officers).toHaveLength(2);
      expect(r.officers[0]).toEqual({
        officerName: "A B",
        listUserId: "11111111-1111-1111-1111-111111111111",
      });
      expect(r.officers[1].listUserId).toBe("22222222-2222-2222-2222-222222222222");
    }
  });

  it("skips rows without listUserId", () => {
    process.env.LENDINGPAD_OFFICERS_JSON = JSON.stringify([{ officerName: "X" }, { listUserId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }]);
    const r = parseLendingPadOfficersJson();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.officers).toHaveLength(1);
  });

  it("rejects invalid JSON", () => {
    process.env.LENDINGPAD_OFFICERS_JSON = "{";
    const r = parseLendingPadOfficersJson();
    expect(r.ok).toBe(false);
  });

  it("rejects non-array", () => {
    process.env.LENDINGPAD_OFFICERS_JSON = "{}";
    const r = parseLendingPadOfficersJson();
    expect(r.ok).toBe(false);
  });
});

describe("hasLendingPadListLoansConfig", () => {
  afterEach(() => {
    delete process.env.LENDINGPAD_OFFICERS_JSON;
    delete process.env.LENDINGPAD_USERNAME;
    delete process.env.LENDINGPAD_PASSWORD;
    delete process.env.LENDINGPAD_CONTACT_ID;
    delete process.env.LENDINGPAD_COMPANY_ID;
    delete process.env.LENDINGPAD_LIST_USER_ID;
  });

  it("is true with officers JSON and base creds", () => {
    process.env.LENDINGPAD_USERNAME = "u";
    process.env.LENDINGPAD_PASSWORD = "p";
    process.env.LENDINGPAD_CONTACT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    process.env.LENDINGPAD_COMPANY_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    process.env.LENDINGPAD_OFFICERS_JSON = JSON.stringify([
      { listUserId: "cccccccc-cccc-cccc-cccc-cccccccccccc" },
    ]);
    expect(hasLendingPadListLoansConfig()).toBe(true);
  });
});
