const DEFAULT_BASE_URL = "https://testapi.lendingpad.com";

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
