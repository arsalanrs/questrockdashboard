/**
 * Probe LendingPad per-loan endpoints (detail, documents, conditions, and optional extras).
 * Used by Shape-driven enrichment to record which APIs return real JSON vs HTML/errors.
 */
import { getLendingPadReadConfig } from "./config";
import { lendingPadGetRaw, type LendingPadAuthContext } from "./auth-fetch";
import {
  parseLendingPadConditionsResponse,
  parseLendingPadDocumentsResponse,
  parseLendingPadLoanDetailResponse,
} from "./parse-response";

export type LpEndpointProbeResult = {
  path: string;
  status: number;
  kind: "json" | "html" | "empty" | "error";
  keyCount: number;
  parsedCount: number | null;
  error: string | null;
};

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

function collectKeys(obj: unknown, prefix = "", out = new Set<string>()): Set<string> {
  if (obj == null) return out;
  if (Array.isArray(obj)) {
    if (obj[0] && typeof obj[0] === "object") collectKeys(obj[0], `${prefix}[]`, out);
    return out;
  }
  if (typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    out.add(key);
    if (v && typeof v === "object" && !Array.isArray(v)) collectKeys(v, key, out);
    else if (Array.isArray(v) && v[0] && typeof v[0] === "object") collectKeys(v[0], `${key}[]`, out);
  }
  return out;
}

function formatCreationPeriodYmdRange(from: Date, to: Date): string {
  const ymd = (d: Date) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return `${ymd(from)}-${ymd(to)}`;
}

function parsedCountForPath(path: string, json: unknown): number | null {
  if (path.includes("/conditions")) return parseLendingPadConditionsResponse(json).length;
  if (path.includes("/documents")) return parseLendingPadDocumentsResponse(json).length;
  if (path.includes("/detail") || path.endsWith("/integrations/loans")) {
    return parseLendingPadLoanDetailResponse(json) ? 1 : 0;
  }
  return null;
}

export type ProbeLendingPadLoanOptions = {
  /** When false, only probes detail/conditions/documents (faster). Default true. */
  includeExtraPaths?: boolean;
};

/** Paths aligned with scripts/probe-lendingpad.mjs */
export function buildLendingPadLoanProbePaths(
  loanUuid: string,
  ctx: Pick<LendingPadAuthContext, "contactId" | "companyId">,
  options?: ProbeLendingPadLoanOptions,
): string[] {
  const loanQ = queryParams({ contact: ctx.contactId, company: ctx.companyId, loan: loanUuid });
  const end = new Date();
  const start = new Date();
  start.setUTCFullYear(start.getUTCFullYear() - 5);
  const creationPeriod = formatCreationPeriodYmdRange(start, end);

  const core = [
    `/integrations/loans/detail${loanQ}`,
    `/integrations/loans${loanQ}`,
    `/integrations/loans/${loanUuid}${queryParams({ contact: ctx.contactId, company: ctx.companyId })}`,
    `/integrations/loans/conditions${loanQ}`,
    `/integrations/loans/documents${loanQ}&creationPeriod=${creationPeriod}`,
  ];

  if (options?.includeExtraPaths === false) return core;

  return [
    ...core,
    `/integrations/loans/milestones${loanQ}`,
    `/integrations/loans/tasks${loanQ}`,
    `/integrations/loans/fees${loanQ}`,
    `/integrations/loans/timeline${loanQ}`,
    `/integrations/loans/closingdisclosure${loanQ}`,
    `/integrations/loans/closing-disclosure${loanQ}`,
    `/integrations/loans/criticaldates${loanQ}`,
    `/integrations/loans/critical-dates${loanQ}`,
    `/integrations/loans/processingdates${loanQ}`,
    `/integrations/loans/processing-dates${loanQ}`,
    `/integrations/loans/dates${loanQ}`,
    `/integrations/loans/notes${loanQ}`,
    `/integrations/loans/events${loanQ}`,
    `/integrations/loans/history${loanQ}`,
    `/integrations/loans/lock${loanQ}`,
    `/integrations/loans/locks${loanQ}`,
  ];
}

export async function probeLendingPadLoanEndpoints(
  loanUuid: string,
  options?: ProbeLendingPadLoanOptions,
): Promise<LpEndpointProbeResult[]> {
  const ctx = readContext();
  const paths = buildLendingPadLoanProbePaths(loanUuid, ctx, options);
  const results: LpEndpointProbeResult[] = [];

  for (const pathWithQuery of paths) {
    const raw = await lendingPadGetRaw(ctx, pathWithQuery);
    const keyCount = raw.kind === "json" && raw.json != null ? collectKeys(raw.json).size : 0;
    const parsedCount =
      raw.kind === "json" && raw.json != null ? parsedCountForPath(raw.path, raw.json) : null;
    results.push({
      path: raw.path,
      status: raw.status,
      kind: raw.kind,
      keyCount,
      parsedCount,
      error: raw.ok ? null : raw.textSnippet.slice(0, 120),
    });
  }

  return results;
}
