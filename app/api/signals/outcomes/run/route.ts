import { NextResponse } from "next/server";

import { isCronRequestAuthorized } from "@/lib/cron-auth";
import { canViewExecutiveDashboard } from "@/lib/permissions";
import { requireCurrentUser } from "@/lib/current-user";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runOutcomeLabeler } from "@/lib/signals/outcomes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Populate signal_outcomes from the current deal_signals + loans state.
 * Feeds the future Phase 5 ML ranker with training labels.
 *
 * Auth: cron secret OR executive/admin session.
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

  try {
    const admin = createSupabaseAdminClient();
    const result = await runOutcomeLabeler(admin);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("signals/outcomes/run error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  return POST(request);
}
