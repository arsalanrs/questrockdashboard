#!/usr/bin/env node
/**
 * One-time scrub of junk assigned_loan_officer_* from bad Shape field-map matches.
 * Usage: node scripts/scrub-lo-assignment.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnvLocal() {
  for (const line of readFileSync(join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}

const JUNK = new Set([
  "purchase", "refinance", "conventional", "fha", "va", "usda", "other",
  "fixed", "arm", "primary", "secondary", "investment", "construction", "rehab",
]);

function isJunkName(name) {
  if (!name) return false;
  const s = String(name).trim();
  if (/^\d+$/.test(s.replace(/[,$]/g, ""))) return true;
  if (/[kKmM]\s*[-–—]/.test(s)) return true;
  if (/^\d[\d.]*[kKmM]$/i.test(s.replace(/\s/g, ""))) return true;
  if (JUNK.has(s.toLowerCase())) return true;
  if (/^\([\d\s\-–—]+\)/.test(s)) return true;
  return false;
}

async function main() {
  loadEnvLocal();
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const { data: users } = await admin.from("users").select("id,full_name");
  const userNameById = new Map((users || []).map((u) => [u.id, u.full_name]));

  let cleared = 0;
  let repaired = 0;
  let offset = 0;

  while (true) {
    const { data: rows } = await admin
      .from("loans")
      .select("id,assigned_loan_officer_name,assigned_loan_officer_user_id,lendingpad_loan_uuid")
      .range(offset, offset + 499);
    if (!rows?.length) break;

    for (const row of rows) {
      const name = row.assigned_loan_officer_name;
      const userId = row.assigned_loan_officer_user_id;
      const hasLp = Boolean(row.lendingpad_loan_uuid);

      if (hasLp && userId) {
        const canonical = userNameById.get(userId);
        if (canonical && isJunkName(name)) {
          await admin.from("loans").update({ assigned_loan_officer_name: canonical }).eq("id", row.id);
          repaired++;
        }
        continue;
      }

      if (!hasLp && (isJunkName(name) || (name && !/\s|,/.test(name) && !String(name).toLowerCase().includes("concierge")))) {
        await admin
          .from("loans")
          .update({ assigned_loan_officer_name: null, assigned_loan_officer_user_id: null })
          .eq("id", row.id);
        cleared++;
      }
    }

    if (rows.length < 500) break;
    offset += 500;
  }

  const { count: withId } = await admin
    .from("loans")
    .select("*", { count: "exact", head: true })
    .not("assigned_loan_officer_user_id", "is", null);
  console.log(`Scrub done. Cleared junk: ${cleared}, repaired LP names: ${repaired}`);
  console.log(`Loans with LO user id: ${withId ?? 0}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
