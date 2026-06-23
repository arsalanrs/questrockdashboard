import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { importLendingPadNotes } from "@/lib/lendingpad/write";
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
    .from("loan_notes")
    .select("id,source,author,body,noted_at")
    .eq("loan_id", loanId)
    .order("noted_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ notes: data ?? [] });
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

  let body: { note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const note = String(body.note ?? "").trim();
  if (!note) return NextResponse.json({ error: "note is required" }, { status: 400 });

  const { data: loan } = await supabase
    .from("loans")
    .select("id,lendingpad_loan_uuid,assigned_loan_officer_user_id")
    .eq("id", loanId)
    .maybeSingle();

  if (!loan) return NextResponse.json({ error: "Loan not found" }, { status: 404 });

  const admin = createSupabaseAdminClient();
  const notedAt = new Date().toISOString();

  if (loan.lendingpad_loan_uuid && hasLendingPadReadConfig()) {
    try {
      await importLendingPadNotes(loan.lendingpad_loan_uuid, [note]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `LendingPad: ${msg}` }, { status: 502 });
    }
  }

  const { data: appUser } = await supabase.from("users").select("full_name").eq("id", user.id).maybeSingle();

  await admin.from("loan_notes").insert({
    loan_id: loanId,
    source: "manual",
    author: appUser?.full_name ?? user.email ?? "User",
    body: note,
    noted_at: notedAt,
  });

  return NextResponse.json({ ok: true });
}
