import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canAccessAdmin } from "@/lib/permissions";
import { hasLendingPadReadConfig } from "@/lib/lendingpad/config";
import { listLendingPadLoans } from "@/lib/lendingpad/client";

/**
 * GET — JSON list of loans from LendingPad (read-only). Admin only; for mapping / validation.
 */
export async function GET(request: Request) {
  if (!hasLendingPadReadConfig()) {
    return NextResponse.json({ error: "LendingPad is not configured" }, { status: 503 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: appUser, error: appUserError } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (appUserError || !appUser || !canAccessAdmin(appUser.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const skip = url.searchParams.get("skip");
  const take = url.searchParams.get("take");
  const skipN = skip != null && skip !== "" ? Number(skip) : undefined;
  const takeN = take != null && take !== "" ? Number(take) : undefined;

  try {
    const loans = await listLendingPadLoans({
      skip: Number.isFinite(skipN) ? skipN : undefined,
      take: Number.isFinite(takeN) ? takeN : undefined,
    });
    return NextResponse.json({ count: loans.length, loans });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "LendingPad list failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
