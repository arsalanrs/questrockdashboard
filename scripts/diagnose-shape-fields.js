/**
 * Dumps raw Shape API field names and sample values from one page.
 * Run: node scripts/diagnose-shape-fields.js
 * Requires .env.local: SHAPE_API_KEY
 */
const path = require("path");
const fs = require("fs");

function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) { console.error("Missing .env.local"); process.exit(1); }
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim(); const v = t.slice(eq + 1).trim();
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}

async function main() {
  loadEnvLocal();
  const apiKey = process.env.SHAPE_API_KEY?.trim();
  const baseUrl = (process.env.SHAPE_API_BASE_URL || "https://secure-api.setshape.com/api").replace(/\/$/, "");
  const crmId = process.env.SHAPE_CRM_ID?.trim() || "20931";
  if (!apiKey) { console.error("Set SHAPE_API_KEY in .env.local"); process.exit(1); }

  const FIELDS_TO_REQUEST = [
    "leadid", "recordtype", "createdDate", "lastActivityDate",
    "firstname", "lastname", "email", "phone",
    "loanamount", "prState", "mailingState",
    "leadsource", "channel", "depursLo",
    "utmCampaign", "mstrstatus1", "status",
    "purpose", "loanType",
    "trkApplicationCompleted", "trkAppraisalRequest",
    "trkCreditReportRequest", "trkDateClosed",
  ];

  console.log("Fetching ONE page from Shape API (no DB write)...\n");

  const res = await fetch(`${baseUrl}/leads/bulk/export/${crmId}`, {
    method: "POST",
    headers: { Authorization: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      fields: FIELDS_TO_REQUEST,
      pageNumber: 1,
      createdDateRange: { from: "2026-01-01", to: "2026-03-16" },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Shape API error ${res.status}:`, text.slice(0, 400));
    process.exit(1);
  }

  const json = await res.json();
  const records = Object.values(json.data || {});

  console.log("Total records in page:", records.length);
  if (json.fields_not_found?.length) {
    console.log("\n>>> FIELDS NOT FOUND (these field names are wrong for this account):");
    json.fields_not_found.forEach(f => console.log("  -", f));
  } else {
    console.log("\n>>> All requested fields were found.");
  }

  if (records.length === 0) {
    console.log("\nNo records returned. Try a wider date range or check credentials.");
    return;
  }

  // Print ALL keys from the first record with their values
  const first = records[0];
  console.log("\n>>> ALL KEYS in first raw record:");
  const entries = Object.entries(first).sort(([a], [b]) => a.localeCompare(b));
  for (const [k, v] of entries) {
    const display = v === null || v === "" ? "(empty)" : String(v).slice(0, 80);
    console.log(`  ${k}: ${display}`);
  }

  // Print 2 more samples focusing on LO-like keys
  const loKeys = entries.filter(([k]) => /lo|officer|assign|depur|owner/i.test(k));
  if (loKeys.length) {
    console.log("\n>>> Keys that might be the LO field:");
    loKeys.forEach(([k, v]) => console.log(`  ${k}: ${v === null || v === "" ? "(empty)" : v}`));
  }

  // Check a few more records to see if the LO key is ever non-empty
  const allKeys = new Set(entries.map(([k]) => k));
  const candidates = [...allKeys].filter(k => /lo|officer|assign|depur|owner/i.test(k));
  if (candidates.length) {
    console.log("\n>>> Values for LO candidate keys across all records:");
    for (const k of candidates) {
      const vals = records.map(r => (r[k] || "")).filter(Boolean);
      console.log(`  ${k}: ${vals.length} non-empty / ${records.length} records. Examples: ${[...new Set(vals)].slice(0, 5).join(", ")}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
