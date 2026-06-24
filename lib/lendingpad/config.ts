import { DEFAULT_LENDINGPAD_SYNC_OFFICERS } from "./default-officers";

const DEFAULT_BASE_URL = "https://testapi.lendingpad.com";

/** One LP list/loans scope (`user=` query) + optional label for matching dashboard users by name. */
export type LendingPadOfficerListEntry = {
  officerName: string;
  listUserId: string;
};

export type LendingPadReadConfig = {
  baseUrl: string;
  username: string;
  password: string;
  contactId: string;
  companyId: string;
  listUserId: string;
};

export function getLendingPadReadConfig(): LendingPadReadConfig {
  const baseUrl = (process.env.LENDINGPAD_API_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const username = process.env.LENDINGPAD_USERNAME?.trim() ?? "";
  const password = process.env.LENDINGPAD_PASSWORD?.trim() ?? "";
  const contactId = process.env.LENDINGPAD_CONTACT_ID?.trim() ?? "";
  const companyId = process.env.LENDINGPAD_COMPANY_ID?.trim() ?? "";
  const listUserId = process.env.LENDINGPAD_LIST_USER_ID?.trim() ?? "";
  if (!username || !password || !contactId || !companyId) {
    throw new Error(
      "LendingPad read API requires LENDINGPAD_USERNAME, LENDINGPAD_PASSWORD, LENDINGPAD_CONTACT_ID, and LENDINGPAD_COMPANY_ID.",
    );
  }
  return { baseUrl, username, password, contactId, companyId, listUserId };
}

export function hasLendingPadReadConfig(): boolean {
  return Boolean(
    process.env.LENDINGPAD_USERNAME?.trim() &&
      process.env.LENDINGPAD_PASSWORD?.trim() &&
      process.env.LENDINGPAD_CONTACT_ID?.trim() &&
      process.env.LENDINGPAD_COMPANY_ID?.trim(),
  );
}

/**
 * Parse `LENDINGPAD_OFFICERS_JSON` — array of `{ "officerName", "listUserId" }` (snake_case keys also accepted).
 * Invalid JSON returns `{ ok: false }`; unset env returns `{ ok: true, officers: [] }`.
 */
export function parseLendingPadOfficersJson():
  | { ok: true; officers: LendingPadOfficerListEntry[] }
  | { ok: false; error: string } {
  const raw = process.env.LENDINGPAD_OFFICERS_JSON?.trim();
  if (!raw) {
    return { ok: true, officers: [...DEFAULT_LENDINGPAD_SYNC_OFFICERS] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "LENDINGPAD_OFFICERS_JSON is not valid JSON." };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: "LENDINGPAD_OFFICERS_JSON must be a JSON array." };
  }
  const officers: LendingPadOfficerListEntry[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const listUserId = String(o.listUserId ?? o.list_user_id ?? "").trim();
    if (!listUserId) continue;
    const officerName = String(o.officerName ?? o.officer_name ?? "").trim();
    officers.push({ officerName, listUserId });
  }
  return { ok: true, officers };
}

/** True when list/loans can run: `LENDINGPAD_LIST_USER_ID` and/or non-empty `LENDINGPAD_OFFICERS_JSON`. */
export function hasLendingPadListLoansConfig(): boolean {
  if (!hasLendingPadReadConfig()) return false;
  if (Boolean(process.env.LENDINGPAD_LIST_USER_ID?.trim())) return true;
  const parsed = parseLendingPadOfficersJson();
  return parsed.ok && parsed.officers.length > 0;
}
