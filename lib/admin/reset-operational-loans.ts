import type { SupabaseClient } from "@supabase/supabase-js";

export type ResetOperationalLoansResult = {
  deleted: Record<string, number>;
  watermarkReset: boolean;
};

/**
 * Wipe operational loan data while keeping users, teams, stage_mapping, and archives.
 * Deletes child tables first (FK order), then loans, then resets shape_sync_watermark.
 */
export async function resetOperationalLoans(
  admin: SupabaseClient,
): Promise<ResetOperationalLoansResult> {
  const deleted: Record<string, number> = {};

  async function deleteAll(table: string, filter?: { column: string; op: "is"; value: null }) {
    let q = admin.from(table).delete({ count: "exact" });
    if (filter) {
      q = q.is(filter.column, filter.value);
    } else {
      // Supabase requires a filter on delete; match all rows via not-null id/uuid pattern.
      q = q.not("id", "is", null);
    }
    const { count, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    deleted[table] = count ?? 0;
  }

  // Tables with loan_id FK — delete before loans.
  const childTables = [
    "conditions",
    "loan_notes",
    "rich_loan_data",
    "loan_stage_events",
    "shape_activity_log",
    "reminder_dismissals",
    "escalations",
    "deal_signals",
    "signal_outcomes",
    "assignment_queue",
  ] as const;

  for (const table of childTables) {
    try {
      await deleteAll(table);
    } catch (err) {
      // Table may not exist in all environments — skip gracefully.
      const msg = err instanceof Error ? err.message : String(err);
      if (/does not exist|Could not find/i.test(msg)) {
        deleted[table] = 0;
        continue;
      }
      throw err;
    }
  }

  // Operational Shape KPI staging cache.
  try {
    await deleteAll("raw_shape_kpi_leads");
  } catch {
    deleted.raw_shape_kpi_leads = 0;
  }

  // Clear historical_leads merge pointers (set null, don't delete historical rows).
  await admin.from("historical_leads").update({ merged_into_loan_id: null }).not("id", "is", null);

  await deleteAll("loans");

  const { error: wmError } = await admin
    .from("shape_sync_watermark")
    .upsert(
      { id: 1, last_updated_sync_to: "1970-01-01", updated_at: new Date().toISOString() },
      { onConflict: "id" },
    );

  return {
    deleted,
    watermarkReset: !wmError,
  };
}
