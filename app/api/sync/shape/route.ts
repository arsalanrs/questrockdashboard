/**
 * POST /api/sync/shape — Shape bulk export sync into Supabase.
 * Auth: admin role or header x-cron-secret matching CRON_SECRET.
 * For live data: schedule every 15–30 min (Vercel Cron or external cron).
 */
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canAccessAdmin } from "@/lib/permissions";
import { hasShapeApiConfig } from "@/lib/shape-api/config";
import { runShapeApiSync } from "@/lib/shape-api/sync";

export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const headerSecret = request.headers.get("x-cron-secret");
  const allowedByCron = Boolean(cronSecret && headerSecret === cronSecret);

  if (!allowedByCron) {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: appUser, error: appUserError } = await supabase
      .from("users")
      .select("id,role")
      .eq("id", user.id)
      .maybeSingle();
    if (appUserError || !appUser)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (!canAccessAdmin(appUser.role))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!hasShapeApiConfig()) {
    return NextResponse.json(
      { error: "Shape API sync is not configured. Set SHAPE_API_KEY in .env.local." },
      { status: 503 }
    );
  }

  try {
    const result = await runShapeApiSync({});
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sync failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
