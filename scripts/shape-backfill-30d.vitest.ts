/**
 * Shape 30-day backfill for new field mappings.
 * Run: npx vitest run scripts/shape-backfill-30d.vitest.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
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

describe("shape-backfill-30d", () => {
  it(
    "30d full sync",
    async () => {
      loadEnvLocal();
      const to = new Date().toISOString().slice(0, 10);
      const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      console.log(`Shape full sync ${from} → ${to}...`);
      const shape = await runShapeApiSync({ mode: "full", dateFrom: from, dateTo: to });
      console.log("Shape result:", shape);

      const admin = createSupabaseAdminClient();
      const { count: withGamePlan } = await admin
        .from("loans")
        .select("*", { count: "exact", head: true })
        .not("game_plan_notes", "is", null);
      const { count: withLastContact } = await admin
        .from("loans")
        .select("*", { count: "exact", head: true })
        .not("last_contacted_at", "is", null);
      console.log(`Loans with game_plan_notes: ${withGamePlan ?? 0}`);
      console.log(`Loans with last_contacted_at: ${withLastContact ?? 0}`);
    },
    600_000,
  );
});
