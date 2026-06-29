/**
 * One-page Shape backfill smoke test (validates new field mappings + upsert).
 * Run: npx vitest run scripts/shape-backfill-one-page.vitest.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { SHAPE_BULK_EXPORT_FIELDS_SYNC } from "@/lib/shape-api/fields";
import { shapeBulkExport } from "@/lib/shape-api/client";
import { mapApiRecordToCsvLike } from "@/lib/shape-api/field-map";
import { buildLoanPayloadFromRow } from "@/lib/import/build-loan-payload";
import { buildLoUserIdLookup } from "@/lib/import/resolve-lo-user-id";
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

describe("shape-backfill-one-page", () => {
  it("upserts page 1 with extended sync fields", async () => {
    loadEnvLocal();
    const admin = createSupabaseAdminClient();
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 730 * 86400000).toISOString().slice(0, 10);

    const res = await shapeBulkExport({
      fields: [...SHAPE_BULK_EXPORT_FIELDS_SYNC],
      pageNumber: 1,
      createdDateRange: { from, to },
    });
    expect(res.fields_not_found ?? []).toHaveLength(0);

    const { data: mappingRows } = await admin.from("stage_mapping").select("source_status,normalized_stage");
    const statusToStage = new Map(
      (mappingRows ?? []).map((m) => [m.source_status, m.normalized_stage]),
    );
    const { data: users } = await admin.from("users").select("id,full_name,email");
    const { nameToUserId, emailToUserId } = buildLoUserIdLookup(users ?? []);

    const { data: batch } = await admin
      .from("import_batches")
      .insert({ source: "shape_field_discovery_backfill", source_filename: null, imported_by: null })
      .select("id")
      .single();

    const payloads: Record<string, unknown>[] = [];
    let withGamePlanInApi = 0;
    let withLastContactInApi = 0;

    for (const record of Object.values(res.data ?? {}) as Record<string, unknown>[]) {
      if (record.game_plan_notes || record["Game Plan Notes"]) withGamePlanInApi++;
      if (record["Last Contacted"] || record.last_contacted) withLastContactInApi++;

      const row = mapApiRecordToCsvLike(record);
      const loan = buildLoanPayloadFromRow(
        row,
        statusToStage,
        nameToUserId,
        batch!.id as string,
        emailToUserId,
        users ?? [],
      );
      if (loan) payloads.push(loan);
    }

    expect(payloads.length).toBeGreaterThan(0);

    const { error } = await admin.from("loans").upsert(payloads, { onConflict: "shape_record_id" });
    expect(error).toBeNull();

    console.log(
      `Page 1: ${payloads.length} loans upserted; API had game_plan=${withGamePlanInApi}, last_contacted=${withLastContactInApi}`,
    );
  }, 120_000);
});
