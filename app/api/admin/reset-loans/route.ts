import { NextResponse } from "next/server";
import { isCronRequestAuthorized } from "@/lib/cron-auth";
import { requireCurrentUser } from "@/lib/current-user";
import { canAccessAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resetOperationalLoans } from "@/lib/admin/reset-operational-loans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/reset-loans
 * Wipes loans + related operational rows; keeps users, teams, stage_mapping, archives.
 * Auth: executive/admin session OR CRON_SECRET.
 */
export async function POST(request: Request) {
  const isCron = isCronRequestAuthorized(request);
  if (!isCron) {
    try {
      const { appUser } = await requireCurrentUser();
      if (!canAccessAdmin(appUser.role)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const admin = createSupabaseAdminClient();
    const result = await resetOperationalLoans(admin);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Reset failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
