import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { updateShapeLeadFields } from "@/lib/shape-api/update-lead";

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { shapeRecordId?: number; phone?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const shapeRecordId = Number(body.shapeRecordId);
  const phone = String(body.phone ?? "").replace(/\D/g, "");
  if (!shapeRecordId || !phone) {
    return NextResponse.json({ error: "shapeRecordId and phone required" }, { status: 400 });
  }

  const result = await updateShapeLeadFields(shapeRecordId, { mobilephone: phone });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ ok: true });
}
