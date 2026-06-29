/**
 * Local rebuild: reset operational loans + 90d Shape sync (no Vercel timeout).
 * Run: npx vitest run scripts/rebuild-shape-sync.vitest.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { resetOperationalLoans } from "@/lib/admin/reset-operational-loans";
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

describe("rebuild-shape-sync", () => {
  it("reset + 90d full sync", async () => {
    loadEnvLocal();
    const admin = createSupabaseAdminClient();

    console.log("Resetting operational loans...");
    const reset = await resetOperationalLoans(admin);
    console.log("Reset:", reset);

    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    console.log(`Shape sync ${from} → ${to}...`);

    const result = await runShapeApiSync({ mode: "full", dateFrom: from, dateTo: to });
    console.log("Sync result:", result);

    console.log("LendingPad list sync (links UUIDs + list fields)...");
    const lp = await runLendingPadLoansSync({ fetchDetail: false });
    console.log("LP list sync:", {
      loansUpserted: lp.loansUpserted,
      errors: lp.errors.length,
    });

    const { linkShapeLoansToLendingPad } = await import("@/lib/shape-api/link-shape-lp");
    const link = await linkShapeLoansToLendingPad(admin);
    console.log("Shape↔LP fuzzy link:", link);

    console.log("Per-loan LP enrichment (detail, documents, conditions, endpoint probe)...");
    const enrich = await runShapeLoansLpEnrichmentSync({
      probeExtraEndpoints: false,
      writeReport: true,
    });
    console.log("LP enrichment:", {
      shapeLoans: enrich.shapeLoansConsidered,
      withLpUuid: enrich.withLpUuid,
      withoutLpUuid: enrich.withoutLpUuid,
      detailParsed: enrich.detailParsed,
      documentsWritten: enrich.documentsWritten,
      conditionsWritten: enrich.conditionsWritten,
      recommendCompanyReport: enrich.recommendCompanyReport,
      recommendation: enrich.recommendation,
      reportPath: enrich.reportPath,
      errors: enrich.errors.length,
    });

    const { count: withName } = await admin
      .from("loans")
      .select("*", { count: "exact", head: true })
      .not("assigned_loan_officer_name", "is", null);
    const { count: withUser } = await admin
      .from("loans")
      .select("*", { count: "exact", head: true })
      .not("assigned_loan_officer_user_id", "is", null);
    const { count: total } = await admin
      .from("loans")
      .select("*", { count: "exact", head: true });

    console.log(`LO names: ${withName ?? 0} / ${total ?? 0}`);
    console.log(`LO user ids: ${withUser ?? 0} / ${total ?? 0}`);
  }, 1_800_000);
});
