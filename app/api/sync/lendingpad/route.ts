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

  try {
    const loans = await runLendingPadLoansSync();
    const conditions = await runLendingPadConditionsSync();
    const documents = await runLendingPadDocumentsSync();
    return NextResponse.json({ loans, conditions, documents });
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
