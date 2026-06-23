/**
 * POST /api/webhooks/lendingpad
 * Receives LendingPad loan export pushes (batch up to 25 loans).
 */
import { NextResponse } from "next/server";
import { buildBasicAuthHeader } from "@/lib/lendingpad/parse-response";
import { processLendingPadExportBatch } from "@/lib/lendingpad/process-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorizeWebhook(request: Request): boolean {
  const expectedUser = process.env.LENDINGPAD_WEBHOOK_USERNAME?.trim();
  const expectedPass = process.env.LENDINGPAD_WEBHOOK_PASSWORD?.trim();
  if (!expectedUser || !expectedPass) {
    // Fall back to main API credentials
    const u = process.env.LENDINGPAD_USERNAME?.trim();
    const p = process.env.LENDINGPAD_PASSWORD?.trim();
    if (!u || !p) return false;
    const auth = request.headers.get("authorization") ?? "";
    return auth === buildBasicAuthHeader(u, p);
  }
  const auth = request.headers.get("authorization") ?? "";
  return auth === buildBasicAuthHeader(expectedUser, expectedPass);
}

export async function POST(request: Request) {
  if (request.headers.get("x-test")) {
    return NextResponse.json({ ok: true, test: true });
  }

  if (!authorizeWebhook(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rows = Array.isArray(body) ? body : [body];
  const exportRows = rows.filter((r) => r && typeof r === "object") as Array<Record<string, unknown>>;

  try {
    const result = await processLendingPadExportBatch(exportRows);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
