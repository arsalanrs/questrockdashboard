import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildPipelineLoans } from "@/lib/shape-views/lo-dashboard";
import type { LoDashboardLoanRow } from "@/lib/shape-views/lo-dashboard";

function loadEnvLocal() {
  for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}

describe("check-pipeline-dates", () => {
  it("reports date column fill rates on pipeline loans", async () => {
    loadEnvLocal();
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("loans")
      .select(
        "id,shape_record_id,lendingpad_loan_uuid,lendingpad_status_raw,lendingpad_status_at,status_raw,borrower_first_name,borrower_last_name,loan_amount_cents,loan_type,loan_purpose,credit_report_requested_at,conversion_date,submitted_to_processing_at,uw_decision_at,ctc_at,closing_date,finance_contingency_date,appraisal_contingency_date,lock_expiration_date",
      )
      .limit(2000);
    if (error) throw error;

    const pipeline = buildPipelineLoans((data ?? []) as LoDashboardLoanRow[]);
    const fields = [
      "credit_report_requested_at",
      "conversion_date",
      "submitted_to_processing_at",
      "uw_decision_at",
      "ctc_at",
      "closing_date",
      "finance_contingency_date",
      "appraisal_contingency_date",
    ] as const;

    console.log(`Total loans: ${data?.length ?? 0}, pipeline eligible: ${pipeline.length}`);
    for (const f of fields) {
      const n = pipeline.filter((r) => r[f]).length;
      console.log(`  ${f}: ${n}/${pipeline.length}`);
    }

    const sample = pipeline.slice(0, 5);
    for (const row of sample) {
      console.log("\nSample:", row.borrower_first_name, row.borrower_last_name, row.status_raw);
      console.log("  shape_record_id:", row.shape_record_id, "lp:", row.lendingpad_loan_uuid?.slice(0, 8));
      for (const f of fields) console.log(`  ${f}:`, row[f] ?? "—");
    }

    const withShape = pipeline.filter((r) => r.shape_record_id);
    const withoutShape = pipeline.filter((r) => !r.shape_record_id);
    console.log(`\nWith Shape ID: ${withShape.length}, LP-only: ${withoutShape.length}`);
  });
});
