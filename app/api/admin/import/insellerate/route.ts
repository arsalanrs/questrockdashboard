import { NextResponse } from "next/server";

import { isCronRequestAuthorized } from "@/lib/cron-auth";
import { requireCurrentUser } from "@/lib/current-user";
import { canAccessAdmin } from "@/lib/permissions";
import { runInsellerateImport } from "@/lib/import/run-insellerate-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Upload an Insellerate .xlsx export.
 *
 * Auth: admin session OR CRON_SECRET header (for CLI / one-off imports).
 * Body: multipart/form-data with field `file` containing the .xlsx.
 *
 * Query params:
 *   ?noMerge=1  — write historical_leads only; skip active-row merge into loans.
 */
export async function POST(request: Request) {
  const isCron = isCronRequestAuthorized(request);
  let adminGate = false;
  let importedByUserId: string | undefined;
  if (!isCron) {
    try {
      const { appUser } = await requireCurrentUser();
      adminGate = canAccessAdmin(appUser.role);
      importedByUserId = appUser.id;
    } catch {
      adminGate = false;
    }
    if (!adminGate) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const { searchParams } = new URL(request.url);
  const noMerge = searchParams.get("noMerge") === "1";

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file field" }, { status: 400 });
    }
    const arrayBuffer = await file.arrayBuffer();

    const result = await runInsellerateImport({
      buffer: arrayBuffer,
      filename: file.name,
      importedByUserId,
      mergeActiveToLoans: !noMerge,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("admin/import/insellerate error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
