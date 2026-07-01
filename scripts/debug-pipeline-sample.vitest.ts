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

describe("debug-pipeline-sample", () => {
  it("sample pipeline loans linkage", async () => {
    loadEnvLocal();
    const admin = createSupabaseAdminClient();
    const names = ["Ramsey", "Paul", "Todd", "Gary"];
    for (const n of names) {
      const { data } = await admin
        .from("loans")
        .select(
          "borrower_first_name,borrower_last_name,status_raw,lendingpad_status_raw,lendingpad_loan_uuid,shape_record_id,credit_report_requested_at,closing_date,ctc_at,lendingpad_status_at,last_status_change_at,conversion_date",
        )
        .ilike("borrower_first_name", `%${n}%`)
        .limit(2);
      console.log(`\n=== ${n} ===`, JSON.stringify(data, null, 2));
    }

    const { data: all } = await admin
      .from("loans")
      .select(
        "id,borrower_first_name,borrower_last_name,status_raw,lendingpad_loan_uuid,shape_record_id,credit_report_requested_at,closing_date,ctc_at,lendingpad_status_at,assigned_loan_officer_name",
      )
      .not("lendingpad_loan_uuid", "is", null)
      .limit(500);
    const pipeline = buildPipelineLoans((all ?? []) as LoDashboardLoanRow[]);
    console.log(`\nLP-linked pipeline: ${pipeline.length}`);
    for (const r of pipeline.slice(0, 5)) {
      console.log({
        name: `${r.borrower_first_name} ${r.borrower_last_name}`,
        lpStatus: r.lendingpad_status_raw,
        shape: r.shape_record_id,
        credit: r.credit_report_requested_at?.slice(0, 10),
        closing: r.closing_date,
        ctc: r.ctc_at,
        lpAt: r.lendingpad_status_at?.slice(0, 10),
      });
    }
  });
});
