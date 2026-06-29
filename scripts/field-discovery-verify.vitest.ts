import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
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

describe("field-discovery-verify", () => {
  it("LP list fields landed in loans + rich_loan_data", async () => {
    loadEnvLocal();
    const admin = createSupabaseAdminClient();

    const { count: lpLinked } = await admin
      .from("loans")
      .select("*", { count: "exact", head: true })
      .not("lendingpad_loan_uuid", "is", null);
    const { count: withClosing } = await admin
      .from("loans")
      .select("*", { count: "exact", head: true })
      .not("closing_date", "is", null)
      .not("lendingpad_loan_uuid", "is", null);
    const { count: withLpRaw } = await admin
      .from("rich_loan_data")
      .select("*", { count: "exact", head: true })
      .not("lp_raw_json", "is", null);

    console.log(`LP-linked loans: ${lpLinked ?? 0}`);
    console.log(`LP-linked with closing_date: ${withClosing ?? 0}`);
    console.log(`rich_loan_data with lp_raw_json: ${withLpRaw ?? 0}`);

    expect(lpLinked ?? 0).toBeGreaterThan(0);
    expect(withLpRaw ?? 0).toBeGreaterThan(0);
  });
});
