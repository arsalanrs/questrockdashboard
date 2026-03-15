import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { runShapeKpiImport } from "@/lib/import/run-shape-kpi-import";
import { canAccessAdmin } from "@/lib/permissions";

export async function POST(request: Request) {
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

  const body = (await request.json().catch(() => null)) as { csvText?: string; filename?: string } | null;
  if (!body?.csvText) return NextResponse.json({ error: "Missing csvText" }, { status: 400 });

  const result = await runShapeKpiImport({ csvText: body.csvText, filename: body.filename ?? null, importedByUserId: appUser.id });
  return NextResponse.json(result);
}

