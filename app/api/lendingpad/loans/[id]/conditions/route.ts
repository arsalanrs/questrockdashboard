import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasLendingPadReadConfig } from "@/lib/lendingpad/config";
import { getLendingPadLoanConditions } from "@/lib/lendingpad/client";
import { normalizeLendingPadLoanUuid } from "@/lib/lendingpad/parse-response";

/**
 * GET — live conditions from LendingPad for a loan the user can already see (RLS).
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: loanId } = await context.params;
  if (!loanId) return NextResponse.json({ error: "Missing loan id" }, { status: 400 });

  if (!hasLendingPadReadConfig()) {
    return NextResponse.json({ error: "LendingPad is not configured" }, { status: 503 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: loan, error: loanError } = await supabase
    .from("loans")
    .select("id,lendingpad_loan_uuid")
    .eq("id", loanId)
    .maybeSingle();

  if (loanError) return NextResponse.json({ error: loanError.message }, { status: 500 });
  if (!loan) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const lpUuid = normalizeLendingPadLoanUuid(loan.lendingpad_loan_uuid as string | null);
  if (!lpUuid) {
    return NextResponse.json(
      { error: "This loan has no LendingPad UUID (lendingpad_loan_uuid)." },
      { status: 422 },
    );
  }

  try {
    const conditions = await getLendingPadLoanConditions(lpUuid);
    return NextResponse.json({ loanId, lendingpadLoanUuid: lpUuid, conditions });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "LendingPad request failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
