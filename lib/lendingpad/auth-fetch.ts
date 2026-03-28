import { buildBasicAuthHeader } from "./parse-response";

const REQUEST_MS = 45_000;

export type LendingPadAuthContext = {
  baseUrl: string;
  contactId: string;
  companyId: string;
  username: string;
  password: string;
};

export async function lendingPadGetJson(ctx: LendingPadAuthContext, pathWithQuery: string): Promise<unknown> {
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
