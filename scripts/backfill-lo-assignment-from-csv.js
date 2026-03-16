/**
 * Backfill loans.assigned_loan_officer_user_id from a Shape custom report CSV.
 * Use when the API sync doesn't set LO assignment (e.g. different field name).
 *
 * Usage: node scripts/backfill-lo-assignment-from-csv.js [path/to/report.csv]
 * Default CSV: customreportcsv_172522-0.csv in project root.
 *
 * Requires .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

const path = require("path");
const fs = require("fs");
const Papa = require("papaparse");
const { createClient } = require("@supabase/supabase-js");

function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) {
    console.error("Missing .env.local");
    process.exit(1);
  }
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function findLoNameColumn(row) {
  const keys = Object.keys(row);
  const lo = keys.find((k) => k === "Loan Officer User Name" || (k && k.toLowerCase().includes("loan officer")));
  return lo || null;
}

async function main() {
  loadEnvLocal();
  const csvPath = process.argv[2] || path.join(__dirname, "..", "customreportcsv_172522-0.csv");
  if (!fs.existsSync(csvPath)) {
    console.error("CSV not found:", csvPath);
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  const supabase = createClient(url, key);

  const csvText = fs.readFileSync(csvPath, "utf8");
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  if (parsed.errors?.length) {
    console.error("CSV parse errors:", parsed.errors);
    process.exit(1);
  }
  const rows = parsed.data;

  const sample = rows[0] || {};
  const recordIdKey = "recordId";
  const loNameKey = findLoNameColumn(sample) || "Loan Officer User Name";
  console.log("Using record id column:", recordIdKey, "| LO name column:", loNameKey);

  const { data: users, error: usersErr } = await supabase.from("users").select("id, full_name");
  if (usersErr) {
    console.error("Failed to load users:", usersErr.message);
    process.exit(1);
  }
  const nameToUserId = new Map();
  (users || []).forEach((u) => nameToUserId.set(String(u.full_name).trim().toLowerCase(), u.id));
  console.log("Loaded", nameToUserId.size, "users:", [...nameToUserId.keys()].slice(0, 10).join(", "), nameToUserId.size > 10 ? "..." : "");

  let updated = 0;
  let skipped = 0;
  let noUser = 0;

  for (const row of rows) {
    const recordIdRaw = row[recordIdKey] ?? row["Lead ID"];
    const recordId = recordIdRaw != null ? parseInt(String(recordIdRaw).trim(), 10) : NaN;
    if (!Number.isFinite(recordId)) {
      skipped++;
      continue;
    }
    const loName = (row[loNameKey] ?? "").toString().trim() || null;
    if (!loName) {
      skipped++;
      continue;
    }
    const uid = nameToUserId.get(loName.toLowerCase());
    if (!uid) {
      noUser++;
      continue;
    }
    const { error } = await supabase
      .from("loans")
      .update({ assigned_loan_officer_user_id: uid, assigned_loan_officer_name: loName })
      .eq("shape_record_id", recordId);
    if (error) {
      console.error("Update failed for shape_record_id", recordId, error.message);
      continue;
    }
    updated++;
  }

  console.log("Done. Updated:", updated, "| Skipped (no id/name):", skipped, "| LO name not in users:", noUser);
  if (noUser > 0) {
    const names = new Set();
    rows.forEach((r) => {
      const n = (r[loNameKey] ?? "").toString().trim();
      if (n && !nameToUserId.has(n.toLowerCase())) names.add(n);
    });
    console.log("LO names in CSV with no user:", [...names].join(", "));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
