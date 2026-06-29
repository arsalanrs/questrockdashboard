import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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

describe("check-shape-trk-raw", () => {
  it("inspects raw Shape rows for trk date fields", async () => {
    loadEnvLocal();
    const admin = createSupabaseAdminClient();

    const { data: raw } = await admin
      .from("raw_shape_kpi_leads")
      .select("record_id,row")
      .order("import_batch_id", { ascending: false })
      .limit(200);

    const trkKeys = [
      "Submitted To Processing Date",
      "UW Decision Date",
      "CTC Date",
      "Conversion Date",
      "Credit Report Request Date",
      "Closing Scheduled Date",
      "Finance Contingency Date",
    ];

    let withAnyTrk = 0;
    let withConversion = 0;
    let withLastStatus = 0;
    const samples: unknown[] = [];
    for (const r of raw ?? []) {
      const row = r.row as Record<string, string>;
      const status = row["Status"] ?? row["Shape File Status"] ?? "";
      const hits = trkKeys.filter((k) => row[k]?.trim());
      if (row["Conversion Date"]?.trim()) withConversion++;
      if (row["Last Status Change Date"]?.trim()) withLastStatus++;
      if (hits.length) {
        withAnyTrk++;
        if (samples.length < 3) {
          samples.push({
            recordId: r.record_id,
            status,
            hits: Object.fromEntries(hits.map((k) => [k, row[k]])),
          });
        }
      }
    }

    console.log(`Raw rows scanned: ${raw?.length ?? 0}, with any trk date: ${withAnyTrk}`);
    console.log(`  with Conversion Date: ${withConversion}, Last Status Change Date: ${withLastStatus}`);
    console.log("Samples:", JSON.stringify(samples, null, 2));

    const { data: shapeLoans } = await admin
      .from("loans")
      .select("shape_record_id,status_raw,submitted_to_processing_at,uw_decision_at,ctc_at,conversion_date")
      .not("shape_record_id", "is", null)
      .limit(500);

    const withDates = (shapeLoans ?? []).filter(
      (l) => l.submitted_to_processing_at || l.uw_decision_at || l.ctc_at || l.conversion_date,
    );
    console.log(`Shape loans: ${shapeLoans?.length ?? 0}, with milestone dates: ${withDates.length}`);
    if (withDates[0]) console.log("Sample loan dates:", withDates[0]);
  });
});
