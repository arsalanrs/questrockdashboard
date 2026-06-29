/**
 * Backfill newly mapped LP + Shape fields (no dev server).
 * Run: npx vitest run scripts/field-discovery-backfill.vitest.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { runLendingPadLoansSync } from "@/lib/lendingpad/sync-loans";
import { runShapeLoansLpEnrichmentSync } from "@/lib/lendingpad/sync-enrich-shape-loans";
import { runShapeApiSync } from "@/lib/shape-api/sync";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function loadEnvLocal() {
  const envPath = join(process.cwd(), ".env.local");
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}

describe("field-discovery-backfill", () => {
  it(
    "LP list sync + Shape full sync",
    async () => {
      loadEnvLocal();

      console.log("LendingPad sync (list fields only; detail API unavailable on this account)...");
      const lp = await runLendingPadLoansSync({ fetchDetail: false });
      console.log("LP result:", {
        loansUpserted: lp.loansUpserted,
        loansConsidered: lp.loansConsidered,
        errorCount: lp.errors.length,
        sampleErrors: lp.errors.slice(0, 3),
      });

      const to = new Date().toISOString().slice(0, 10);
      const from = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      console.log(`Shape full sync ${from} → ${to}...`);
      const shape = await runShapeApiSync({ mode: "full", dateFrom: from, dateTo: to });
      console.log("Shape result:", shape);

      console.log("LP list sync after Shape (link UUIDs)...");
      const lpAfterShape = await runLendingPadLoansSync({ fetchDetail: false });
      console.log("LP list (post-Shape):", {
        loansUpserted: lpAfterShape.loansUpserted,
        errorCount: lpAfterShape.errors.length,
      });

      const { linkShapeLoansToLendingPad } = await import("@/lib/shape-api/link-shape-lp");
      const admin = createSupabaseAdminClient();
      const link = await linkShapeLoansToLendingPad(admin);
      console.log("Shape↔LP fuzzy link:", link);

      console.log("Per-loan LP enrichment + endpoint probe report...");
      const enrich = await runShapeLoansLpEnrichmentSync({
        probeExtraEndpoints: true,
        writeReport: true,
      });
      console.log("Enrichment report:", {
        shapeLoans: enrich.shapeLoansConsidered,
        withLpUuid: enrich.withLpUuid,
        detailParsed: enrich.detailParsed,
        documentsWritten: enrich.documentsWritten,
        conditionsWritten: enrich.conditionsWritten,
        endpointSummary: enrich.endpointSummary,
        recommendCompanyReport: enrich.recommendCompanyReport,
        recommendation: enrich.recommendation,
        reportPath: enrich.reportPath,
      });

      const { count: withGamePlan } = await admin
        .from("loans")
        .select("*", { count: "exact", head: true })
        .not("game_plan_notes", "is", null);
      const { count: withLpRaw } = await admin
        .from("rich_loan_data")
        .select("*", { count: "exact", head: true })
        .not("lp_raw_json", "is", null);

      console.log(`Loans with game_plan_notes: ${withGamePlan ?? 0}`);
      console.log(`rich_loan_data with lp_raw_json: ${withLpRaw ?? 0}`);
    },
    1_800_000,
  );
});
