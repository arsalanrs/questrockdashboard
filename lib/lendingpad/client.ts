/**
 * LendingPad Web API — read-only (GET). Uses HTTP Basic auth per Postman collection.
 */
import { getLendingPadReadConfig, type LendingPadReadConfig } from "./config";
import {
  buildBasicAuthHeader,
  parseLendingPadConditionsResponse,
  parseLendingPadDocumentsResponse,
  parseLendingPadListLoansResponse,
  type NormalizedLpCondition,
  type NormalizedLpDocument,
  type NormalizedLpLoanListItem,
} from "./parse-response";

const REQUEST_MS = 45_000;

function authHeaders(cfg: LendingPadReadConfig): HeadersInit {
  return {
    Authorization: buildBasicAuthHeader(cfg.username, cfg.password),
    Accept: "application/json",
  };
}

async function lendingPadGetJson(pathWithQuery: string): Promise<unknown> {
  const cfg = getLendingPadReadConfig();
  const url = `${cfg.baseUrl}${pathWithQuery.startsWith("/") ? "" : "/"}${pathWithQuery}`;
  const res = await fetch(url, {
    method: "GET",
    headers: authHeaders(cfg),
    signal: AbortSignal.timeout(REQUEST_MS),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`LendingPad GET ${pathWithQuery.split("?")[0]} failed: ${res.status} ${text.slice(0, 200)}`);
  }
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("LendingPad response was not valid JSON");
  }
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

/** List loans (JSON). Requires LENDINGPAD_LIST_USER_ID. */
export async function listLendingPadLoans(options?: {
  skip?: number;
  take?: number;
}): Promise<NormalizedLpLoanListItem[]> {
  const cfg = getLendingPadReadConfig();
  if (!cfg.listUserId) {
    throw new Error("LENDINGPAD_LIST_USER_ID is required for list/loans.");
  }
  const q = queryParams({
    contact: cfg.contactId,
    company: cfg.companyId,
    user: cfg.listUserId,
    skip: options?.skip,
    take: options?.take,
  });
  const json = await lendingPadGetJson(`/integrations/list/loans${q}`);
  return parseLendingPadListLoansResponse(json);
}

export async function getLendingPadLoanConditions(loanUuid: string): Promise<NormalizedLpCondition[]> {
  const cfg = getLendingPadReadConfig();
  const q = queryParams({
    contact: cfg.contactId,
    company: cfg.companyId,
    loan: loanUuid,
  });
  const json = await lendingPadGetJson(`/integrations/loans/conditions${q}`);
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
  const json = await lendingPadGetJson(`/integrations/loans/documents${q}`);
  return parseLendingPadDocumentsResponse(json);
}
