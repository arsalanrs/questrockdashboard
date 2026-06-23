#!/usr/bin/env node
/**
 * Wipe operational loan data (loans + children) and reset shape_sync_watermark.
 *
 * Usage:
 *   node scripts/reset-operational-loans.mjs
 *   node scripts/reset-operational-loans.mjs --confirm
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const confirm = process.argv.includes("--confirm");
if (!confirm) {
  console.log("Dry run — pass --confirm to delete operational loan data.");
  console.log("Tables: conditions, loan_notes, rich_loan_data, loan_stage_events,");
  console.log("  shape_activity_log, reminder_dismissals, escalations, deal_signals,");
  console.log("  signal_outcomes, assignment_queue, raw_shape_kpi_leads, loans");
  process.exit(0);
}

const admin = createClient(url, key, { auth: { persistSession: false } });

async function deleteAll(table) {
  const { count, error } = await admin.from(table).delete({ count: "exact" }).not("id", "is", null);
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

async function main() {
  const deleted = {};
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
    "raw_shape_kpi_leads",
  ];

  for (const table of childTables) {
    try {
      deleted[table] = await deleteAll(table);
    } catch (err) {
      console.warn(`Skip ${table}:`, err.message);
      deleted[table] = 0;
    }
  }

  await admin.from("historical_leads").update({ merged_into_loan_id: null }).not("id", "is", null);

  deleted.loans = await deleteAll("loans");

  const { error: wmError } = await admin
    .from("shape_sync_watermark")
    .upsert({ id: 1, last_updated_sync_to: "1970-01-01", updated_at: new Date().toISOString() });

  console.log(JSON.stringify({ deleted, watermarkReset: !wmError }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
