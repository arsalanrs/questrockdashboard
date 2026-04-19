import { NextResponse } from "next/server";

import { canViewExecutiveDashboard } from "@/lib/permissions";
import { requireCurrentUser } from "@/lib/current-user";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let appUser: Awaited<ReturnType<typeof requireCurrentUser>>["appUser"] | null = null;
  try {
    const res = await requireCurrentUser();
    appUser = res.appUser;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!appUser || !canViewExecutiveDashboard(appUser.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.ids) ? body.ids.filter((v: unknown) => typeof v === "string") : [];
  if (ids.length === 0) return NextResponse.json({ ok: true, updated: 0 });

  const admin = createSupabaseAdminClient();
  const { error, count } = await admin
    .from("executive_notifications")
    .update({ read_at: new Date().toISOString() }, { count: "exact" })
    .eq("user_id", appUser.id)
    .in("id", ids);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, updated: count ?? ids.length });
}
