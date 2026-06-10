import { NextResponse } from "next/server";

import { requireCurrentUser } from "@/lib/current-user";
import { canViewExecutiveDashboard } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { explainLeadTierNullReason } from "@/lib/signals/tier-classifier";
import type { SignalLoanRow } from "@/lib/signals/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ROWS = 500;

/**
 * Executive drill-down: loans in a tier bucket (RED / ORANGE / GREEN / UNSET).
 * UNSET rows include `unsetReason` (rule-based, not LLM).
 */
export async function GET(request: Request) {
  try {
    const { appUser } = await requireCurrentUser();
    if (!canViewExecutiveDashboard(appUser.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const tier = searchParams.get("tier")?.trim().toUpperCase() ?? "";

  if (!["RED", "ORANGE", "GREEN", "UNSET"].includes(tier)) {
    return NextResponse.json(
      { error: "Query tier must be RED, ORANGE, GREEN, or UNSET" },
      { status: 400 },
    );
  }

  const admin = createSupabaseAdminClient();
  const select =
    "id,borrower_first_name,borrower_last_name,current_stage,status_raw,loan_amount_cents,shape_record_id,lead_tier,assigned_loan_officer_name,do_not_contact,closed_at,funded_at";

  let q = admin
    .from("loans")
    .select(select)
    .order("borrower_last_name", { ascending: true, nullsFirst: false })
    .limit(MAX_ROWS + 1);

  if (tier === "UNSET") {
    q = q.is("lead_tier", null);
  } else {
    q = q.eq("lead_tier", tier);
  }

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const raw = (data ?? []) as SignalLoanRow[];
  const truncated = raw.length > MAX_ROWS;
  const slice = raw.slice(0, MAX_ROWS);

  const loans = slice.map((loan) => {
    const borrower =
      [loan.borrower_first_name, loan.borrower_last_name].filter(Boolean).join(" ").trim() || null;
    const base = {
      id: loan.id,
      borrower,
      current_stage: loan.current_stage,
      status_raw: loan.status_raw,
      loan_amount_cents: loan.loan_amount_cents,
      shape_record_id: loan.shape_record_id,
      lead_tier: (loan.lead_tier as string | null) ?? null,
      assigned_loan_officer_name: loan.assigned_loan_officer_name,
    };
    if (tier === "UNSET") {
      return { ...base, unsetReason: explainLeadTierNullReason(loan) };
    }
    return base;
  });

  return NextResponse.json({ loans, truncated, maxRows: MAX_ROWS });
}
