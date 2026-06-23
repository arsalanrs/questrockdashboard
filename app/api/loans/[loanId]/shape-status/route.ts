import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { updateShapeLeadFields } from "@/lib/shape-api/update-lead";

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

  let body: { status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const status = String(body.status ?? "").trim();
  if (!status) return NextResponse.json({ error: "status is required" }, { status: 400 });

  const { data: loan } = await supabase
    .from("loans")
    .select("id,shape_record_id")
    .eq("id", loanId)
    .maybeSingle();

  if (!loan?.shape_record_id) {
    return NextResponse.json({ error: "No Shape record linked" }, { status: 400 });
  }

  const result = await updateShapeLeadFields(loan.shape_record_id, { mstrstatus1: status });
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Shape update failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
