import type { SupabaseClient } from "@supabase/supabase-js";

/** Append a loan_stage_events row when normalized stage changes (pipeline metrics). */
export async function recordLoanStageEventIfChanged(
  admin: SupabaseClient,
  loanId: string,
  newStage: string,
  enteredAtIso: string,
): Promise<void> {
  const { data: rows, error } = await admin
    .from("loan_stage_events")
    .select("stage")
    .eq("loan_id", loanId)
    .order("entered_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const last = rows?.[0] as { stage: string } | undefined;
  if (last?.stage === newStage) return;
  const { error: ins } = await admin.from("loan_stage_events").insert({
    loan_id: loanId,
    stage: newStage,
    entered_at: enteredAtIso,
  });
  if (ins) throw ins;
}
