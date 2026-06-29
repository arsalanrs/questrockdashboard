import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { runShapeApiSync } from "@/lib/shape-api/sync";
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

describe("shape-backfill-incremental", () => {
  it(
    "incremental sync",
    async () => {
      loadEnvLocal();
      const shape = await runShapeApiSync({ mode: "incremental" });
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
    900_000,
  );
});
