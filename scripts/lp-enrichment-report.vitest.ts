/**
 * Run Shape→LP per-loan enrichment and write probe report (no Shape rebuild).
 * Run: npx vitest run scripts/lp-enrichment-report.vitest.ts
 *
 * Optional env:
 *   LENDINGPAD_ENRICH_MAX_LOANS=50  (default 50 for this script)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { runShapeLoansLpEnrichmentSync } from "@/lib/lendingpad/sync-enrich-shape-loans";

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

describe("lp-enrichment-report", () => {
  it(
    "probe + sync all LP-linked Shape loans",
    async () => {
      loadEnvLocal();
      const maxLoans = Number(process.env.LENDINGPAD_ENRICH_MAX_LOANS ?? "50");

      const enrich = await runShapeLoansLpEnrichmentSync({
        maxLoans: Number.isFinite(maxLoans) ? maxLoans : 50,
        probeExtraEndpoints: true,
        writeReport: true,
      });

      console.log(JSON.stringify(enrich, null, 2));
    },
    3_600_000,
  );
});
