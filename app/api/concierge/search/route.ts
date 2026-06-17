import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { searchShapeLead } from "@/lib/shape-api/update-lead";
import { hasShapeApiConfig } from "@/lib/shape-api/config";

type LeadResult = {
  id?: string;
  shape_record_id?: number | null;
  lendingpad_loan_uuid?: string | null;
  borrower_first_name?: string | null;
  borrower_last_name?: string | null;
  status_raw?: string | null;
  borrower_phone?: string | null;
  source?: string | null;
};

async function searchDatabase(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  phone: string,
  name: string,
): Promise<LeadResult[]> {
  const digits = phone.replace(/\D/g, "");
  if (digits.length >= 7) {
    const { data } = await supabase
      .from("loans")
      .select(
        "id,shape_record_id,lendingpad_loan_uuid,borrower_first_name,borrower_last_name,status_raw,borrower_phone,source",
      )
      .or(`borrower_phone.ilike.%${digits.slice(-10)}%,borrower_phone.ilike.%${digits}%`)
      .limit(10);
    if (data?.length) return data as LeadResult[];
  }

  if (name.trim()) {
    const parts = name.trim().split(/\s+/);
    const first = parts[0];
    const last = parts[parts.length - 1];
    const { data } = await supabase
      .from("loans")
      .select(
        "id,shape_record_id,lendingpad_loan_uuid,borrower_first_name,borrower_last_name,status_raw,borrower_phone,source",
      )
      .or(`borrower_first_name.ilike.%${first}%,borrower_last_name.ilike.%${last}%`)
      .limit(10);
    return (data ?? []) as LeadResult[];
  }

  return [];
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { phone?: string; name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const phone = String(body.phone ?? "").trim();
  const name = String(body.name ?? "").trim();

  if (!phone && !name) {
    return NextResponse.json({ error: "phone or name required" }, { status: 400 });
  }

  const dbLeads = await searchDatabase(supabase, phone, name);
  if (dbLeads.length > 0) {
    return NextResponse.json({ leads: dbLeads, source: "database" });
  }

  if (!hasShapeApiConfig()) {
    return NextResponse.json({ leads: [], source: "none" });
  }

  if (phone) {
    const res = await searchShapeLead({ phone });
    const shapeLeads = res.leads.map((r) => ({
      shape_record_id: Number(r.leadid ?? r.lead_id ?? r.id) || null,
      borrower_first_name: (r.firstname ?? r.first_name) as string | null,
      borrower_last_name: (r.lastname ?? r.last_name) as string | null,
      status_raw: (r.mstrstatus1 ?? r.status) as string | null,
      borrower_phone: (r.mobilephone ?? r.phone) as string | null,
      source: "Shape",
    }));
    return NextResponse.json({ leads: shapeLeads, source: "shape" });
  }

  return NextResponse.json({ leads: [], source: "none" });
}
