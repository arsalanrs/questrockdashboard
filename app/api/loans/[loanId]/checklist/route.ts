import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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

  const { data: loan, error: loanErr } = await supabase
    .from("loans")
    .select("loan_type, documentation_type")
    .eq("id", loanId)
    .single();

  if (loanErr || !loan) {
    return NextResponse.json({ error: "Loan not found" }, { status: 404 });
  }

  let query = supabase
    .from("loan_type_checklists")
    .select("id, name")
    .eq("loan_type", loan.loan_type)
    .eq("is_active", true);

  if (loan.documentation_type) {
    query = query.eq("documentation_type", loan.documentation_type);
  }

  const { data: checklist, error: clErr } = await query.limit(1).maybeSingle();

  if (clErr) {
    return NextResponse.json({ error: clErr.message }, { status: 500 });
  }

  if (!checklist) {
    return NextResponse.json({ checklist: [], checklistName: null });
  }

  const { data: items, error: itemsErr } = await supabase
    .from("checklist_items")
    .select("id, title, sort_order, is_required")
    .eq("checklist_id", checklist.id)
    .order("sort_order", { ascending: true });

  if (itemsErr) {
    return NextResponse.json({ error: itemsErr.message }, { status: 500 });
  }

  const { data: entries } = await supabase
    .from("loan_checklist_entries")
    .select("checklist_item_id, status, received_at, notes")
    .eq("loan_id", loanId);

  const entryMap = new Map(
    (entries ?? []).map((e) => [e.checklist_item_id, e]),
  );

  const merged = (items ?? []).map((item) => {
    const entry = entryMap.get(item.id);
    return {
      id: item.id,
      title: item.title,
      is_required: item.is_required,
      sort_order: item.sort_order,
      status: entry?.status ?? "pending",
      received_at: entry?.received_at ?? null,
      notes: entry?.notes ?? null,
    };
  });

  return NextResponse.json({ checklist: merged, checklistName: checklist.name });
}
