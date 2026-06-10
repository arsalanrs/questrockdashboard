import { NextResponse } from "next/server";

import { executeAssignmentBlitz, type BlitzTier } from "@/lib/assignment/engine";
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
  const loanIds = Array.isArray(body?.loanIds) ? body.loanIds.map((x: unknown) => String(x)) : [];
  const confirm = body?.confirm === true;

  if (!confirm) {
    return NextResponse.json(
      { error: "Must pass confirm: true after reviewing a preview for the same loan IDs." },
      { status: 400 },
    );
  }
  if (tier !== "RED" && tier !== "ORANGE") {
    return NextResponse.json({ error: "tier must be RED or ORANGE" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const res = await executeAssignmentBlitz(admin, tier as BlitzTier, loanIds);
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, completed: res.completed, failed: res.failed });
}
