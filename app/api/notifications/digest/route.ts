import { NextResponse } from "next/server";

import { isCronRequestAuthorized } from "@/lib/cron-auth";
import { canViewExecutiveDashboard } from "@/lib/permissions";
import { requireCurrentUser } from "@/lib/current-user";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  buildDigestSummary,
  deliverMorningDigest,
} from "@/lib/notifications/morning-digest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Generate + deliver the executive morning digest.
 *
 * Auth: cron secret OR executive/admin session.
 *
 * Query params:
 *   ?dry=1  — return the summary without inserting any notifications.
 */
export async function POST(request: Request) {
  const isCron = isCronRequestAuthorized(request);
  if (!isCron) {
    try {
      const { appUser } = await requireCurrentUser();
      if (!canViewExecutiveDashboard(appUser.role)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const { searchParams } = new URL(request.url);
  const dry = searchParams.get("dry") === "1";

  try {
    const admin = createSupabaseAdminClient();
    if (dry) {
      const summary = await buildDigestSummary(admin);
      return NextResponse.json({ ok: true, dry: true, summary });
    }
    const result = await deliverMorningDigest(admin);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("notifications/digest error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  return POST(request);
}
