/**
 * LendingPad Web API — read-only (GET). Uses HTTP Basic auth per Postman collection.
 * GET /integrations/list/loans: take must be 1–25 per LendingPad Web API guide.
 */
import { getLendingPadReadConfig, parseLendingPadOfficersJson } from "./config";
import { lendingPadGetJson, type LendingPadAuthContext } from "./auth-fetch";
import {
  parseLendingPadConditionsResponse,
  parseLendingPadDocumentsResponse,
  parseLendingPadListLoansResponse,
  type NormalizedLpCondition,
  type NormalizedLpDocument,
  type NormalizedLpLoanListItem,
} from "./parse-response";

function readContext(): LendingPadAuthContext {
  const cfg = getLendingPadReadConfig();
  return {
    baseUrl: cfg.baseUrl,
    contactId: cfg.contactId,
    companyId: cfg.companyId,
    username: cfg.username,
    password: cfg.password,
  };
}

function queryParams(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const q = sp.toString();
  return q ? `?${q}` : "";
}

/** List loans (JSON). `take` is clamped 1–25 (LendingPad API limit). */
export async function listLendingPadLoansWithAuth(
  ctx: LendingPadAuthContext,
  listUserId: string,
  options?: { skip?: number; take?: number },
): Promise<NormalizedLpLoanListItem[]> {
  const take = Math.min(25, Math.max(1, options?.take ?? 25));
  const q = queryParams({
    contact: ctx.contactId,
    company: ctx.companyId,
    user: listUserId,
    skip: options?.skip,
    take,
  });
  const json = await lendingPadGetJson(ctx, `/integrations/list/loans${q}`);
  return parseLendingPadListLoansResponse(json);
}

/**
 * List loans using env `LENDINGPAD_LIST_USER_ID`, or `options.listUserId`, or the first entry in
 * `LENDINGPAD_OFFICERS_JSON` when no single list id is set.
 */
export async function listLendingPadLoans(options?: {
  skip?: number;
  take?: number;
  /** When set, overrides env list user id (e.g. pick one officer when using LENDINGPAD_OFFICERS_JSON). */
  listUserId?: string;
}): Promise<NormalizedLpLoanListItem[]> {
  const cfg = getLendingPadReadConfig();
  const officersParsed = parseLendingPadOfficersJson();
  const officers = officersParsed.ok ? officersParsed.officers : [];
  const resolved =
    options?.listUserId?.trim() ||
    cfg.listUserId ||
    officers[0]?.listUserId ||
    "";
  if (!resolved) {
    throw new Error(
      "LENDINGPAD_LIST_USER_ID, LENDINGPAD_OFFICERS_JSON (at least one listUserId), or options.listUserId is required for list/loans.",
    );
  }
  return listLendingPadLoansWithAuth(readContext(), resolved, options);
}

export async function getLendingPadLoanConditions(loanUuid: string): Promise<NormalizedLpCondition[]> {
  const cfg = getLendingPadReadConfig();
  const ctx = readContext();
  const q = queryParams({
    contact: cfg.contactId,
    company: cfg.companyId,
    loan: loanUuid,
  });
  const json = await lendingPadGetJson(ctx, `/integrations/loans/conditions${q}`);
  return parseLendingPadConditionsResponse(json);
}

function formatCreationPeriodYmdRange(from: Date, to: Date): string {
  const ymd = (d: Date) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return `${ymd(from)}-${ymd(to)}`;
}

/** Document metadata for a loan. Optional date range defaults to last 5 years. */
export async function getLendingPadLoanDocuments(
  loanUuid: string,
  creationPeriod?: string,
): Promise<NormalizedLpDocument[]> {
  const cfg = getLendingPadReadConfig();
  const ctx = readContext();
  const end = new Date();
  const start = new Date();
  start.setUTCFullYear(start.getUTCFullYear() - 5);
  const period = creationPeriod ?? formatCreationPeriodYmdRange(start, end);
  const q = queryParams({
    contact: cfg.contactId,
    company: cfg.companyId,
    loan: loanUuid,
    creationPeriod: period,
  });
  const json = await lendingPadGetJson(ctx, `/integrations/loans/documents${q}`);
  return parseLendingPadDocumentsResponse(json);
}
