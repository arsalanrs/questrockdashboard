/**
 * GET/POST /api/sync/lendingpad — pull LendingPad loans (list) + conditions into Supabase.
 * Auth: Vercel Cron (Authorization: Bearer CRON_SECRET), x-cron-secret, or signed-in admin.
 *
 * Loan list: env LENDINGPAD_LIST_USER_ID, LENDINGPAD_OFFICERS_JSON, and/or lendingpad_user_credentials (per LO).
 * Conditions: loans.lendingpad_loan_uuid + inbound API enabled for the contact in LendingPad.
 */
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canAccessAdmin } from "@/lib/permissions";
import { isCronRequestAuthorized } from "@/lib/cron-auth";
import { hasLendingPadReadConfig } from "@/lib/lendingpad/config";
import { runLendingPadConditionsSync } from "@/lib/lendingpad/sync-conditions";
import { runLendingPadDocumentsSync } from "@/lib/lendingpad/sync-documents";
import { runLendingPadLoansSync } from "@/lib/lendingpad/sync-loans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** LP list sync across many LOs can exceed the default 10s Vercel limit. */
export const maxDuration = 300;

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

async function handle(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;

  if (!hasLendingPadReadConfig()) {
    return NextResponse.json(
      {
        error:
          "LendingPad sync is not configured. Set LENDINGPAD_USERNAME, LENDINGPAD_PASSWORD, LENDINGPAD_CONTACT_ID, LENDINGPAD_COMPANY_ID.",
      },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(request.url);
  /** rebuild flow: loans only, skip per-loan detail fetch for speed */
  const scope = searchParams.get("scope") ?? "full";
  const skipDetail = searchParams.get("skipDetail") === "1";

  try {
    if (scope === "loans") {
      const loans = await runLendingPadLoansSync({ fetchDetail: !skipDetail });
      return NextResponse.json({ loans, conditions: null, documents: null, scope: "loans" });
    }
    if (scope === "conditions") {
      const conditions = await runLendingPadConditionsSync();
      return NextResponse.json({ loans: null, conditions, documents: null, scope: "conditions" });
    }
    if (scope === "documents") {
      const documents = await runLendingPadDocumentsSync();
      return NextResponse.json({ loans: null, conditions: null, documents, scope: "documents" });
    }

    const loans = await runLendingPadLoansSync({ fetchDetail: !skipDetail });
    const conditions = await runLendingPadConditionsSync();
    const documents = await runLendingPadDocumentsSync();
    return NextResponse.json({ loans, conditions, documents, scope: "full" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "LendingPad sync failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
