import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { importLendingPadCondition } from "@/lib/lendingpad/write";
import { hasLendingPadReadConfig } from "@/lib/lendingpad/config";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ loanId: string }> },
) {
  const { loanId } = await params;
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("conditions")
    .select("id, title, status, cleared_at, category, source")
    .eq("loan_id", loanId)
    .order("status", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ conditions: data ?? [] });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ loanId: string }> },
) {
  const { loanId } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { description?: string; category?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const description = String(body.description ?? "").trim();
  if (!description) return NextResponse.json({ error: "description is required" }, { status: 400 });
  const category = Number(body.category ?? 1);

  const { data: loan } = await supabase
    .from("loans")
    .select("id,lendingpad_loan_uuid")
    .eq("id", loanId)
    .maybeSingle();

  if (!loan?.lendingpad_loan_uuid) {
    return NextResponse.json({ error: "No LendingPad loan linked" }, { status: 400 });
  }

  if (!hasLendingPadReadConfig()) {
    return NextResponse.json({ error: "LendingPad not configured" }, { status: 503 });
  }

  try {
    await importLendingPadCondition(loan.lendingpad_loan_uuid, {
      category,
      type: 0,
      description,
      responsibleParties: [2],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
