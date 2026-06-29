import type { SupabaseClient } from "@supabase/supabase-js";

/** Shape statuses eligible for borrower-name fuzzy match to LP-only rows. */
export const PIPELINE_STATUSES_FOR_LP_FUZZY = new Set([
  "Piped",
  "Registered",
  "Processing",
  "Submitted",
  "Underwriting",
  "Verification",
  "Application Taken",
  "Conditions Out",
  "Approval Conditions",
  "Clear to Close",
  "Closing",
  "Package Out",
  "Signed Not Piped",
  "Package Back",
]);

export type LinkShapeLoansToLendingPadResult = {
  shapeCandidates: number;
  linked: number;
  duplicatesRemoved: number;
};

function normName(first: string | null, last: string | null): string {
  return `${String(first ?? "").trim()} ${String(last ?? "").trim()}`.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Link Shape rows to LendingPad UUIDs by matching LP-only rows (borrower name + lead date ±30d).
 * Run after LP list sync so LP-only rows exist in the database.
 */
export async function linkShapeLoansToLendingPad(
  admin: SupabaseClient,
  options?: { shapeRecordIds?: number[] },
): Promise<LinkShapeLoansToLendingPadResult> {
  const result: LinkShapeLoansToLendingPadResult = {
    shapeCandidates: 0,
    linked: 0,
    duplicatesRemoved: 0,
  };

  let shapeRecordIds = options?.shapeRecordIds?.filter((id) => Number.isFinite(id)) ?? [];

  if (shapeRecordIds.length === 0) {
    const { data: unlinkedShape } = await admin
      .from("loans")
      .select("shape_record_id,status_raw")
      .not("shape_record_id", "is", null)
      .is("lendingpad_loan_uuid", null)
      .limit(5000);
    shapeRecordIds = (unlinkedShape ?? [])
      .filter((r) =>
        PIPELINE_STATUSES_FOR_LP_FUZZY.has(String((r as { status_raw: string | null }).status_raw ?? "")),
      )
      .map((r) => (r as { shape_record_id: number }).shape_record_id)
      .filter((id) => Number.isFinite(id));
  }

  result.shapeCandidates = shapeRecordIds.length;
  if (shapeRecordIds.length === 0) return result;

  const { data: lpOnlyRowsRaw } = await admin
    .from("loans")
    .select("id,lendingpad_loan_uuid,borrower_first_name,borrower_last_name,lead_created_at")
    .is("shape_record_id", null)
    .not("lendingpad_loan_uuid", "is", null)
    .limit(2000);

  const lpOnlyRows = [...(lpOnlyRowsRaw ?? [])] as Array<{
    id: string;
    lendingpad_loan_uuid: string;
    borrower_first_name: string | null;
    borrower_last_name: string | null;
    lead_created_at: string | null;
  }>;

  if (lpOnlyRows.length === 0) return result;

  for (let i = 0; i < shapeRecordIds.length; i += 200) {
    const chunk = shapeRecordIds.slice(i, i + 200);
    const { data: shapeRows } = await admin
      .from("loans")
      .select("id,shape_record_id,borrower_first_name,borrower_last_name,lead_created_at")
      .in("shape_record_id", chunk)
      .is("lendingpad_loan_uuid", null);

    for (const shapeRow of shapeRows ?? []) {
      const shapeName = normName(
        shapeRow.borrower_first_name as string | null,
        shapeRow.borrower_last_name as string | null,
      );
      const shapeDate = shapeRow.lead_created_at
        ? new Date(shapeRow.lead_created_at as string).getTime()
        : null;
      if (!shapeName) continue;

      const nameMatches = lpOnlyRows.filter(
        (lp) => normName(lp.borrower_first_name, lp.borrower_last_name) === shapeName,
      );
      let match: (typeof lpOnlyRows)[0] | undefined;
      if (nameMatches.length === 1) {
        match = nameMatches[0];
      } else if (nameMatches.length > 1 && shapeDate) {
        match = nameMatches.find((lp) => {
          const lpDate = lp.lead_created_at ? new Date(lp.lead_created_at).getTime() : null;
          if (!lpDate) return false;
          return Math.abs(shapeDate - lpDate) <= 30 * 24 * 60 * 60 * 1000;
        });
      }

      if (match) {
        await admin
          .from("loans")
          .update({ lendingpad_loan_uuid: match.lendingpad_loan_uuid })
          .eq("id", shapeRow.id as string);
        await admin.from("loans").delete().eq("id", match.id);
        result.linked += 1;
        result.duplicatesRemoved += 1;
        const idx = lpOnlyRows.findIndex((r) => r.id === match.id);
        if (idx >= 0) lpOnlyRows.splice(idx, 1);
      }
    }
  }

  return result;
}
