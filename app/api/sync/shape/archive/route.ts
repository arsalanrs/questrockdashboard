/**
 * POST /api/sync/shape/archive
 *
 * Triggers a bulk export of historical Shape leads (pre-2026 by default) into
 * the shape_archive_leads + shape_archive_notes tables.
 *
 * Auth: same as the regular Shape sync — Vercel Cron bearer token OR
 * a signed-in admin user.
 *
 * Body (optional JSON):
 *   { "dateFrom": "2020-01-01", "dateTo": "2025-12-31" }
 *
 * This is an on-demand / one-time operation — it is NOT part of the nightly cron.
 * Re-running it is safe: leads upsert on shape_lead_id and notes ignore duplicates.
 */
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canAccessAdmin } from "@/lib/permissions";
import { isCronRequestAuthorized } from "@/lib/cron-auth";
import { hasShapeApiConfig } from "@/lib/shape-api/config";
import { runShapeArchiveSync } from "@/lib/shape-api/archive";

async function authorize(request: Request): Promise<NextResponse | null> {
  if (isCronRequestAuthorized(request)) return null;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: appUser } = await supabase
    .from("users")
    .select("id,role")
    .eq("id", user.id)
    .maybeSingle();
  if (!appUser || !canAccessAdmin(appUser.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return null;
}

export async function POST(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;

  if (!hasShapeApiConfig()) {
    return NextResponse.json(
      { error: "Shape API not configured — set SHAPE_API_KEY." },
      { status: 503 }
    );
  }

  let dateFrom: string | undefined;
  let dateTo: string | undefined;

  try {
    const ct = request.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const body = (await request.json()) as Record<string, unknown>;
      if (typeof body.dateFrom === "string" && body.dateFrom.trim())
        dateFrom = body.dateFrom.trim();
      if (typeof body.dateTo === "string" && body.dateTo.trim())
        dateTo = body.dateTo.trim();
    }
  } catch {
    // Non-JSON body is fine — use defaults
  }

  try {
    const result = await runShapeArchiveSync({ dateFrom, dateTo });
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Archive sync failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;

  // GET returns the latest batches for status monitoring
  const supabase = await createSupabaseServerClient();
  const { data, error } = await (await import("@/lib/supabase/admin"))
    .createSupabaseAdminClient()
    .from("shape_archive_batches")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(10);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ batches: data });
}
