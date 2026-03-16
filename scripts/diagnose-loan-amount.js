/**
 * Fetch ONE record from Shape and print every field name + value.
 * This tells us the exact key Shape uses for loan amount.
 *
 * Usage:  node scripts/diagnose-loan-amount.js
 */

const path = require("path");
const fs   = require("fs");

function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) { console.error("Missing .env.local"); process.exit(1); }
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("="); if (eq === -1) continue;
    const k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim();
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}

async function main() {
  loadEnvLocal();

  const apiKey  = process.env.SHAPE_API_KEY?.trim();
  const baseUrl = (process.env.SHAPE_API_BASE_URL || "https://secure-api.setshape.com/api").replace(/\/$/, "");
  const crmId   = process.env.SHAPE_CRM_ID?.trim() || "20931";

  if (!apiKey) { console.error("Set SHAPE_API_KEY in .env.local"); process.exit(1); }

  const today     = new Date().toISOString().slice(0, 10);
  const twoYrsAgo = (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 2); return d.toISOString().slice(0, 10); })();

  // ── Pass 1: fetch with NO fields filter so Shape returns everything it has ──
  console.log("Fetching 1 record with ALL fields from Shape...\n");

  const res = await fetch(`${baseUrl}/leads/bulk/export/${crmId}`, {
    method: "POST",
    headers: { Authorization: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      pageNumber: 1,
      pageSize: 1,
      createdDateRange: { from: twoYrsAgo, to: today },
      // intentionally no "fields" array → Shape should return all available fields
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error(`Shape API error ${res.status}:`, txt.slice(0, 300));
    process.exit(1);
  }

  const json    = await res.json();
  const records = Object.values(json.data || {});

  if (records.length === 0) {
    console.log("No records returned. Try adjusting the date range.");
    process.exit(0);
  }

  const record = records[0];

  console.log("=".repeat(60));
  console.log("ALL FIELDS RETURNED BY SHAPE (key → value):");
  console.log("=".repeat(60));

  for (const [key, value] of Object.entries(record).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${String(key).padEnd(40)} → ${JSON.stringify(value)}`);
  }

  console.log("\n" + "=".repeat(60));
  console.log("FIELDS THAT MIGHT BE LOAN AMOUNT (contains 'loan' or 'amount'):");
  console.log("=".repeat(60));
  for (const [key, value] of Object.entries(record)) {
    if (/loan|amount|price|balance/i.test(key)) {
      console.log(`  ${String(key).padEnd(40)} → ${JSON.stringify(value)}`);
    }
  }

  // ── Pass 2: now try with explicit LoanAmount field to confirm ──
  console.log("\n" + "=".repeat(60));
  console.log('PASS 2: Fetching with explicit fields ["LoanAmount", "loanamount", "loan_amount"]:');
  console.log("=".repeat(60));

  const res2 = await fetch(`${baseUrl}/leads/bulk/export/${crmId}`, {
    method: "POST",
    headers: { Authorization: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      pageNumber: 1,
      pageSize: 3,
      createdDateRange: { from: twoYrsAgo, to: today },
      fields: ["leadid", "firstname", "lastname", "LoanAmount", "loanamount", "loan_amount", "loanAmount"],
    }),
  });

  if (!res2.ok) {
    const txt = await res2.text();
    console.error(`Shape API error ${res2.status}:`, txt.slice(0, 300));
    process.exit(1);
  }

  const json2    = await res2.json();
  const records2 = Object.values(json2.data || {});

  for (const r of records2) {
    console.log("\nRecord:", JSON.stringify(r, null, 2));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
