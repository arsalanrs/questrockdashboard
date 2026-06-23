import { buildBasicAuthHeader } from "./parse-response";
import type { LendingPadAuthContext } from "./auth-fetch";

const REQUEST_MS = 45_000;

export async function lendingPadPostJson(
  ctx: LendingPadAuthContext,
  path: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const url = `${ctx.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: buildBasicAuthHeader(ctx.username, ctx.password),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_MS),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`LendingPad POST ${path} failed: ${res.status} ${text.slice(0, 200)}`);
  }
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("LendingPad response was not valid JSON");
  }
}
