/**
 * GET/POST /api/sync/shape — Shape bulk export sync into Supabase.
 * Auth: Vercel Cron (Authorization: Bearer CRON_SECRET), x-cron-secret, or signed-in admin.
 *
 * GET (cron): incremental sync via updatedDateRange + DB watermark.
 * POST: JSON { "mode": "full" | "incremental", "dateFrom"?, "dateTo"? }; default mode full (legacy).
 */
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canAccessAdmin } from "@/lib/permissions";
import { isCronRequestAuthorized } from "@/lib/cron-auth";
import { hasShapeApiConfig } from "@/lib/shape-api/config";
import { runShapeApiSync, type ShapeSyncMode } from "@/lib/shape-api/sync";

async function authorize(request: Request): Promise<NextResponse | null> {
  if (isCronRequestAuthorized(request)) return null;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: appUser, error: appUserError } = await supabase
    .from("users")
    .select("id,role")
    .eq("id", user.id)
    .maybeSingle();
  if (appUserError || !appUser) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!canAccessAdmin(appUser.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return null;
}

function parseJsonOptions(request: Request): Promise<{
  mode?: ShapeSyncMode;
  dateFrom?: string;
  dateTo?: string;
}> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return Promise.resolve({});
  }
  return request
    .json()
    .then((body: unknown) => {
      if (!body || typeof body !== "object") return {};
      const o = body as Record<string, unknown>;
      const out: { mode?: ShapeSyncMode; dateFrom?: string; dateTo?: string } = {};
      if (o.mode === "full" || o.mode === "incremental") out.mode = o.mode;
      if (typeof o.dateFrom === "string" && o.dateFrom.trim()) out.dateFrom = o.dateFrom.trim();
      if (typeof o.dateTo === "string" && o.dateTo.trim()) out.dateTo = o.dateTo.trim();
      return out;
    })
    .catch(() => ({}));
}

export async function GET(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;

  if (!hasShapeApiConfig()) {
    return NextResponse.json(
      { error: "Shape API sync is not configured. Set SHAPE_API_KEY in .env.local." },
      { status: 503 },
    );
  }

  try {
    const result = await runShapeApiSync({ mode: "incremental" });
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sync failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;

  if (!hasShapeApiConfig()) {
    return NextResponse.json(
      { error: "Shape API sync is not configured. Set SHAPE_API_KEY in .env.local." },
      { status: 503 },
    );
  }

  try {
    const parsed = await parseJsonOptions(request);
    const mode: ShapeSyncMode = parsed.mode ?? "full";
    const result = await runShapeApiSync({
      mode,
      dateFrom: parsed.dateFrom,
      dateTo: parsed.dateTo,
    });
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sync failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
