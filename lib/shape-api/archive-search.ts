/**
 * Archive search — retrieves relevant historical leads + notes for the
 * /chat AI assistant. Uses keyword scoring + status matching; no vector DB.
 *
 * Returns up to `limit` leads (default 12) with their top notes attached,
 * ready to be serialised into an OpenAI prompt context block.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type ArchiveLeadWithNotes = {
  shape_lead_id: number;
  name: string;
  phone: string | null;
  email: string | null;
  lead_source: string | null;
  status_raw: string | null;
  loan_officer_name: string | null;
  loan_amount_cents: number | null;
  property_state: string | null;
  created_date: string | null;
  notes: string[];
};

export async function searchArchive(
  query: string,
  limit = 12
): Promise<ArchiveLeadWithNotes[]> {
  const admin = createSupabaseAdminClient();

  // --- 1. Fetch candidates from the leads table using ilike on key text columns ---
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2)
    .slice(0, 6);

  // Build an OR filter across searchable fields for each term.
  // We over-fetch and re-rank in JS so we can use a simple scoring model.
  const { data: leads, error: leadsError } = await admin
    .from("shape_archive_leads")
    .select(
      "shape_lead_id,first_name,last_name,phone,email,lead_source,status_raw,loan_officer_name,loan_amount_cents,property_state,created_date,notes_sidebar,notes_sidebar_ai_note,recent_notes"
    )
    .limit(200);

  if (leadsError) throw leadsError;

  const rows = leads ?? [];

  // --- 2. Score each lead by term matches ---
  function score(row: typeof rows[number]): number {
    const blob = [
      row.first_name,
      row.last_name,
      row.email,
      row.phone,
      row.lead_source,
      row.status_raw,
      row.loan_officer_name,
      row.property_state,
      row.notes_sidebar,
      row.notes_sidebar_ai_note,
      row.recent_notes,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    let s = 0;
    for (const term of terms) {
      if (blob.includes(term)) s += 2;
    }
    // Bonus: exact name match
    const fullName = `${row.first_name ?? ""} ${row.last_name ?? ""}`.toLowerCase();
    if (query.toLowerCase().includes(fullName.trim()) && fullName.trim().length > 3) s += 5;
    // Boost leads with notes
    if (row.notes_sidebar || row.notes_sidebar_ai_note || row.recent_notes) s += 1;
    return s;
  }

  const scored = rows
    .map((r) => ({ row: r, score: score(r) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (scored.length === 0) return [];

  const topIds = scored.map((x) => x.row.shape_lead_id);

  // --- 3. Fetch notes for the top leads ---
  const { data: notes, error: notesError } = await admin
    .from("shape_archive_notes")
    .select("shape_lead_id,note_source,content")
    .in("shape_lead_id", topIds)
    .order("created_at", { ascending: true })
    .limit(topIds.length * 20);

  if (notesError) throw notesError;

  const notesByLead = new Map<number, string[]>();
  for (const n of notes ?? []) {
    const arr = notesByLead.get(n.shape_lead_id) ?? [];
    arr.push(n.content);
    notesByLead.set(n.shape_lead_id, arr);
  }

  // --- 4. Shape output ---
  return scored.map(({ row }) => ({
    shape_lead_id: row.shape_lead_id,
    name: `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || "Unknown",
    phone: row.phone,
    email: row.email,
    lead_source: row.lead_source,
    status_raw: row.status_raw,
    loan_officer_name: row.loan_officer_name,
    loan_amount_cents: row.loan_amount_cents,
    property_state: row.property_state,
    created_date: row.created_date,
    notes: notesByLead.get(row.shape_lead_id) ?? [],
  }));
}
