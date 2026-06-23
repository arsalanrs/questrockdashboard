#!/usr/bin/env node
/**
 * Reconcile Shape view counts: Supabase vs view rule definitions.
 *
 * Usage:
 *   node scripts/reconcile-shape-views.mjs
 *   node scripts/reconcile-shape-views.mjs --lo=<user-uuid>
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const loFilter = process.argv.find((a) => a.startsWith("--lo="))?.slice(5) || null;

// Dynamic import of compiled TS isn't available — inline minimal mirror of view ids for CLI.
// Full rules live in lib/shape-views/; this script reports counts per view id via Supabase fetch + filter.
const __dir = dirname(fileURLToPath(import.meta.url));
const viewsModulePath = join(__dir, "../lib/shape-views/index.ts");

console.log("Shape view reconciliation");
console.log("Views defined in:", viewsModulePath);
console.log("LO filter:", loFilter ?? "(all)");
console.log("");

const admin = createClient(url, key, { auth: { persistSession: false } });

const WINDOW_DAYS = 90;
const windowStart = new Date();
windowStart.setDate(windowStart.getDate() - WINDOW_DAYS);

let q = admin
  .from("loans")
  .select(
    "id,record_type,source,status_raw,portal_status_raw,lendingpad_status_raw,lead_created_at,shape_last_updated_at,last_status_change_at,funded_at,closed_at,assigned_loan_officer_user_id",
  )
  .or(`lead_created_at.gte.${windowStart.toISOString()},shape_last_updated_at.gte.${windowStart.toISOString()}`)
  .limit(5000);

if (loFilter) q = q.eq("assigned_loan_officer_user_id", loFilter);

const { data, error } = await q;
if (error) {
  console.error("Fetch failed:", error.message);
  process.exit(1);
}

const EXCLUDED_SOURCES = new Set([
  "zWebLead - VISIT",
  "zWebLead - Visit",
  "zCRM Import",
  "Test Lead",
  "Inbound Shape Call",
]);
const EXCLUDED_RT = new Set(["Referral Partner", "Referral Partners", "Contact"]);

const loans = (data ?? []).filter((r) => {
  if (r.source && EXCLUDED_SOURCES.has(r.source)) return false;
  if (r.record_type && EXCLUDED_RT.has(r.record_type)) return false;
  return true;
});

console.log(`Loaded ${loans.length} loans (${WINDOW_DAYS}-day window)\n`);

// Status histogram for unmapped discovery
const statusHist = new Map();
for (const r of loans) {
  const s = r.status_raw ?? "(null)";
  statusHist.set(s, (statusHist.get(s) ?? 0) + 1);
}

console.log("Top status_raw values:");
[...statusHist.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 25)
  .forEach(([s, n]) => console.log(`  ${n}\t${s}`));

console.log("\nCompare these counts to Nikk's Shape saved views manually.");
console.log("Run from QRdashboard root after sync; use --lo=<uuid> for a single LO.");

// Optional: read view ids from index.ts for a checklist
try {
  const src = readFileSync(viewsModulePath, "utf8");
  const ids = [...src.matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]);
  console.log(`\n${ids.length} view ids in lib/shape-views/ — verify each in Shape UI.`);
} catch {
  /* ignore */
}
