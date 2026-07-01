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

describe("debug-paul-criscillis", () => {
  it("dump loan row", async () => {
    loadEnvLocal();
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("loans")
      .select("*")
      .or("borrower_last_name.ilike.%Criscillis%,borrower_email.ilike.%criscillis%")
      .limit(5);
    console.log(JSON.stringify(data, null, 2));

    if (data?.[0]?.id) {
      const { data: rich } = await admin
        .from("rich_loan_data")
        .select("*")
        .eq("loan_id", data[0].id)
        .maybeSingle();
      console.log("rich_loan_data:", JSON.stringify(rich, null, 2));
    }
  });
});
