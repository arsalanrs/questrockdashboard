import { NextResponse } from "next/server";

import { previewAssignmentBlitz, type BlitzTier } from "@/lib/assignment/engine";
import { requireCurrentUser } from "@/lib/current-user";
import { canViewExecutiveDashboard } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { appUser } = await requireCurrentUser();
    if (!canViewExecutiveDashboard(appUser.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const tier = body?.tier as string | undefined;
  const limit = typeof body?.limit === "number" ? body.limit : 25;

  if (tier !== "RED" && tier !== "ORANGE") {
    return NextResponse.json({ error: "tier must be RED or ORANGE" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const res = await previewAssignmentBlitz(admin, tier as BlitzTier, limit);
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    rows: res.rows,
    limitedTo: res.limitedTo,
    maxBatchSize: res.config.maxBatchSize,
  });
}
