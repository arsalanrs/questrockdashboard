import { NextResponse } from "next/server";

/**
 * GHL webhook endpoint — stub for future implementation.
 * Geoey is setting up website traffic to flow through GHL.
 * This endpoint will receive contact create/update webhooks
 * and upsert them into the leads table.
 */
export async function POST(request: Request) {
  const secret = request.headers.get("x-webhook-secret");
  const expectedSecret = process.env.GHL_WEBHOOK_SECRET;
  if (expectedSecret && secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // TODO: Parse GHLWebhookPayload, validate, upsert into leads table
  const _body = await request.json();

  console.warn("[GHL Webhook] Received payload — stub, not yet processing");

  return NextResponse.json({ ok: true, message: "Webhook received (stub)" });
}
