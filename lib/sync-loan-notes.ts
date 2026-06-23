/**
 * Sync Shape sidebar notes from loans table into loan_notes.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function syncLoanNotesFromLoans(maxLoans = 500): Promise<{ written: number }> {
  const admin = createSupabaseAdminClient();
  const { data: loans } = await admin
    .from("loans")
    .select("id,notes_sidebar,notes_sidebar_ai_note,recent_notes")
    .or("notes_sidebar.not.is.null,notes_sidebar_ai_note.not.is.null,recent_notes.not.is.null")
    .limit(maxLoans);

  let written = 0;
  for (const l of loans ?? []) {
    const loanId = l.id as string;
    if (l.notes_sidebar_ai_note) {
      const { error } = await admin.from("loan_notes").upsert(
        {
          loan_id: loanId,
          source: "shape",
          author: "Shape AI",
          body: String(l.notes_sidebar_ai_note),
          noted_at: new Date().toISOString(),
          external_id: "shape:ai_note",
        },
        { onConflict: "loan_id,source,external_id" },
      );
      if (!error) written++;
    }
    if (l.notes_sidebar) {
      const { error } = await admin.from("loan_notes").upsert(
        {
          loan_id: loanId,
          source: "shape",
          author: "Shape",
          body: String(l.notes_sidebar),
          noted_at: new Date().toISOString(),
          external_id: "shape:sidebar",
        },
        { onConflict: "loan_id,source,external_id" },
      );
      if (!error) written++;
    }
  }
  return { written };
}
