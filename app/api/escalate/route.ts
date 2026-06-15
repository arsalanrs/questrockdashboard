/**
 * Escalation API
 *
 * POST /api/escalate
 *   Body: { loan_id: string, note: string }
 *   Creates an escalation row and notifies the LO via executive_notifications.
 *   Requires manager / executive / admin session.
 *
 * PATCH /api/escalate
 *   Body: { escalation_id: string }
 *   Resolves (closes) an open escalation.
 *   Requires manager / executive / admin session.
 */
import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/current-user";
import { canViewManagerDashboard } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function assertManagerAccess() {
  const { appUser } = await requireCurrentUser();
  if (!canViewManagerDashboard(appUser.role)) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403 });
  }
  return appUser;
}

export async function POST(request: Request) {
  let appUser;
  try {
    appUser = await assertManagerAccess();
  } catch (resp) {
    if (resp instanceof Response) return resp;
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: { loan_id?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { loan_id, note } = body;
  if (!loan_id || typeof loan_id !== "string") {
    return NextResponse.json({ error: "loan_id is required" }, { status: 400 });
  }
  if (!note || typeof note !== "string" || note.trim().length === 0) {
    return NextResponse.json({ error: "note is required" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();

  // Look up loan metadata for denormalization + LO notification
  const { data: loan, error: loanErr } = await supabase
    .from("loans")
    .select("id,borrower_first_name,borrower_last_name,assigned_loan_officer_user_id,assigned_loan_officer_name,shape_record_id")
    .eq("id", loan_id)
    .maybeSingle();

  if (loanErr) return NextResponse.json({ error: loanErr.message }, { status: 500 });
  if (!loan) return NextResponse.json({ error: "Loan not found" }, { status: 404 });

  const borrowerName =
    [loan.borrower_first_name, loan.borrower_last_name].filter(Boolean).join(" ") || "Unknown";

  const { data: escalation, error: insErr } = await supabase
    .from("escalations")
    .insert({
      loan_id,
      escalated_by: appUser.id,
      note: note.trim(),
      shape_record_id: loan.shape_record_id ?? null,
      lo_name: loan.assigned_loan_officer_name ?? null,
      borrower_name: borrowerName,
    })
    .select()
    .single();

  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  // Notify the assigned LO (non-blocking — failure is OK)
  if (loan.assigned_loan_officer_user_id) {
    await supabase.from("executive_notifications").insert({
      user_id: loan.assigned_loan_officer_user_id,
      kind: "escalation",
      title: `Action required: ${borrowerName}`,
      body: `${appUser.full_name ?? appUser.email}: ${note.trim()}`,
      payload: {
        loan_id,
        escalation_id: escalation.id,
        escalated_by_name: appUser.full_name ?? appUser.email,
      },
    });
  }

  return NextResponse.json({ ok: true, escalation });
}

export async function PATCH(request: Request) {
  let appUser;
  try {
    appUser = await assertManagerAccess();
  } catch (resp) {
    if (resp instanceof Response) return resp;
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: { escalation_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.escalation_id) {
    return NextResponse.json({ error: "escalation_id is required" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("escalations")
    .update({ resolved_at: new Date().toISOString(), resolved_by: appUser.id })
    .eq("id", body.escalation_id)
    .is("resolved_at", null); // idempotent — only update if not already resolved

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
