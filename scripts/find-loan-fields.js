/**
 * Tries a broad list of field name guesses against the Shape API
 * and prints every one that comes back with a non-empty value.
 *
 * Usage:  node scripts/find-loan-fields.js
 */

const path = require("path");
const fs   = require("fs");

function loadEnv() {
  const p = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(p)) { console.error("Missing .env.local"); process.exit(1); }
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("="); if (eq === -1) continue;
    const k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim();
    if (k && !process.env[k]) process.env[k] = v;
  }
}

async function shapeFetch(body) {
  const apiKey  = process.env.SHAPE_API_KEY.trim();
  const crmId   = process.env.SHAPE_CRM_ID?.trim() || "20931";
  const baseUrl = "https://secure-api.setshape.com/api";
  const res = await fetch(`${baseUrl}/leads/bulk/export/${crmId}`, {
    method:  "POST",
    headers: { Authorization: apiKey, "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Shape ${res.status}: ${t.slice(0,200)}`); }
  return res.json();
}

async function main() {
  loadEnv();

  const today   = new Date().toISOString().slice(0, 10);
  const from    = "2024-01-01";
  const base    = { pageNumber: 1, pageSize: 50, createdDateRange: { from, to: today } };

  // ── PASS 1: every plausible "money" field name ───────────────────────
  const MONEY_FIELDS = [
    // amount variants
    "LoanAmount", "loanamount", "loan_amount", "loanAmount",
    "TotalLoanAmount", "totalLoanAmount", "total_loan_amount", "totalloanamount",
    "RequestedLoanAmount", "requestedLoanAmount", "requested_loan_amount",
    "MortgageAmount", "mortgageAmount", "mortgage_amount",
    "PurchasePrice", "purchasePrice", "purchase_price",
    "LoanBalance", "loanBalance", "loan_balance",
    "OriginalLoanAmount", "originalLoanAmount",
    "HomeValue", "homeValue", "home_value",
    "AppraisedValue", "appraisedValue", "appraised_value",
    "PropertyValue", "propertyValue", "property_value",
    "SalePrice", "salePrice", "sale_price",
    "ListPrice", "listPrice", "list_price",
    "LoanSize", "loanSize",
    "Amount", "amount",
    "Price", "price",
    "Value", "value",
    // common Shape custom field patterns
    "cf_loan_amount", "customfield_loanamount",
    "loanAmt", "LoanAmt",
  ];

  console.log(`\nFetching 50 records with ${MONEY_FIELDS.length} money-field candidates...\n`);

  const json    = await shapeFetch({ ...base, fields: ["leadid", "firstname", "lastname", ...MONEY_FIELDS] });
  const records = Object.values(json.data || {});

  if (records.length === 0) { console.log("No records returned."); process.exit(0); }

  // Collect every key that came back, and for each key count non-empty values
  const keyCounts = new Map(); // key → { total, nonEmpty, samples }
  for (const r of records) {
    for (const [k, v] of Object.entries(r)) {
      if (k === "Lead ID" || k === "First Name" || k === "Last Name") continue;
      if (!keyCounts.has(k)) keyCounts.set(k, { total: 0, nonEmpty: 0, samples: [] });
      const s = keyCounts.get(k);
      s.total++;
      const vs = String(v ?? "").trim();
      if (vs && vs !== "0" && vs !== "0.00") {
        s.nonEmpty++;
        if (s.samples.length < 3) s.samples.push(vs);
      }
    }
  }

  console.log("=".repeat(65));
  console.log("FIELDS RETURNED BY SHAPE  (non-empty count / 50 records)");
  console.log("=".repeat(65));
  for (const [k, s] of [...keyCounts.entries()].sort((a, b) => b[1].nonEmpty - a[1].nonEmpty)) {
    const bar = s.nonEmpty > 0 ? ` ◀  ${s.nonEmpty} non-empty  →  ${s.samples.join(", ")}` : "  (all empty)";
    console.log(`  ${k.padEnd(42)}${bar}`);
  }

  // ── PASS 2: check a page of records in a PIPELINE status specifically ─
  // Pipeline loans are more likely to have an amount entered
  console.log("\n" + "=".repeat(65));
  console.log("PASS 2: same fields but filtering to active pipeline statuses");
  console.log("=".repeat(65));

  const json2    = await shapeFetch({
    ...base,
    fields:  ["leadid", "firstname", "lastname", "mstrstatus1", ...MONEY_FIELDS],
    filters: [{ field: "mstrstatus1", operator: "in", value: ["Processing","Registered","Submitted to UW","Approved with Conditions","Clear to Close","Closed","Funded","Purchased"] }],
  });
  const records2 = Object.values(json2.data || {});
  console.log(`Records returned with pipeline filter: ${records2.length}`);

  const keyCounts2 = new Map();
  for (const r of records2) {
    for (const [k, v] of Object.entries(r)) {
      if (!keyCounts2.has(k)) keyCounts2.set(k, { nonEmpty: 0, samples: [] });
      const s = keyCounts2.get(k);
      const vs = String(v ?? "").trim();
      if (vs && vs !== "0" && vs !== "0.00" && k !== "Lead ID" && k !== "First Name" && k !== "Last Name") {
        s.nonEmpty++;
        if (s.samples.length < 3) s.samples.push(vs);
      }
    }
  }

  for (const [k, s] of [...keyCounts2.entries()].sort((a, b) => b.nonEmpty - a.nonEmpty)) {
    if (s.nonEmpty > 0) {
      console.log(`  ${k.padEnd(42)} ◀  ${s.nonEmpty} non-empty  →  ${s.samples.join(", ")}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
