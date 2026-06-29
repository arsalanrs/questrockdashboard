import { buildBasicAuthHeader } from "./parse-response";

const REQUEST_MS = 45_000;

export type LendingPadAuthContext = {
  baseUrl: string;
  contactId: string;
  companyId: string;
  username: string;
  password: string;
};

export type LendingPadRawResponse = {
  ok: boolean;
  status: number;
  path: string;
  textLen: number;
  kind: "json" | "html" | "empty" | "error";
  json: unknown;
  textSnippet: string;
};

export function classifyLendingPadResponseText(status: number, text: string): LendingPadRawResponse["kind"] {
  const trimmed = text.trim();
  if (!trimmed) return "empty";
  if (!status || status >= 400) return "error";
  try {
    JSON.parse(trimmed);
    return "json";
  } catch {
    if (trimmed.startsWith("<") || /<!DOCTYPE/i.test(trimmed)) return "html";
    return "error";
  }
}

export async function lendingPadGetRaw(
  ctx: LendingPadAuthContext,
  pathWithQuery: string,
): Promise<LendingPadRawResponse> {
  const path = pathWithQuery.split("?")[0] ?? pathWithQuery;
  const url = `${ctx.baseUrl}${pathWithQuery.startsWith("/") ? "" : "/"}${pathWithQuery}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: buildBasicAuthHeader(ctx.username, ctx.password),
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(REQUEST_MS),
    cache: "no-store",
  });
  const text = await res.text();
  const kind = classifyLendingPadResponseText(res.status, text);
  let json: unknown = null;
  if (kind === "json") {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      /* classified as json but parse failed — treat as error */
    }
  }
  return {
    ok: res.ok,
    status: res.status,
    path,
    textLen: text.length,
    kind: kind === "json" && json == null ? "error" : kind,
    json,
    textSnippet: text.slice(0, 200),
  };
}

export async function lendingPadGetJson(ctx: LendingPadAuthContext, pathWithQuery: string): Promise<unknown> {
  const raw = await lendingPadGetRaw(ctx, pathWithQuery);
  if (!raw.ok) {
    throw new Error(`LendingPad GET ${raw.path} failed: ${raw.status} ${raw.textSnippet}`);
  }
  if (raw.kind === "empty") return null;
  if (raw.kind !== "json") {
    throw new Error(`LendingPad response was not valid JSON (${raw.kind})`);
  }
  return raw.json;
}
