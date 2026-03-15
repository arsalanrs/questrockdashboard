/**
 * Fetches one page of leads from Shape bulk export API and writes the raw
 * response to data/shape-export-sample.json so you can see how Shape stores data.
 *
 * Run from project root: node scripts/fetch-shape-to-file.js
 * Requires .env.local with SHAPE_API_KEY (and optionally SHAPE_API_BASE_URL, SHAPE_CRM_ID).
 */

const fs = require("fs");
const path = require("path");

function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) {
    console.error("Missing .env.local. Create it with SHAPE_API_KEY=your-key");
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
    if (key && !process.env[key]) process.env[key] = value;
  }
}

const SHAPE_FIELDS = [
  "leadid",
  "recordtype",
  "firstname",
  "lastname",
  "email",
  "phone",
  "createdDate",
  "lastActivityDate",
  "leadsource",
  "loanamount",
  "prState",
  "mstrstatus1",
  "creditScore",
  "purpose",
  "loanType",
  "leadreferenceid",
];

async function main() {
  loadEnvLocal();
  const baseUrl = (process.env.SHAPE_API_BASE_URL || "https://secure-api.setshape.com/api").replace(
    /\/$/,
    ""
  );
  const apiKey = process.env.SHAPE_API_KEY?.trim();
  if (!apiKey) {
    console.error("SHAPE_API_KEY is required in .env.local");
    process.exit(1);
  }
  const crmId = process.env.SHAPE_CRM_ID?.trim() || "20931";

  const to = new Date();
  const createdDateRange = {
    from: "2024-01-01",
    to: to.toISOString().slice(0, 10),
  };

  const body = {
    createdDateRange,
    fields: SHAPE_FIELDS,
    pageNumber: 1,
  };

  const headers = {
    Authorization: apiKey,
    "Content-Type": "application/json",
  };

  const url = `${baseUrl}/leads/bulk/export/${crmId}`;
  console.log("POST", url);
  console.log("Fetching Shape bulk export (page 1)...");
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error("Shape API error:", res.status, res.statusText);
    console.error(text.slice(0, 500));
    process.exit(1);
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    console.error("Response was not JSON:", text.slice(0, 300));
    process.exit(1);
  }

  const outDir = path.join(__dirname, "..", "data");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "shape-export-sample.json");
  fs.writeFileSync(outPath, JSON.stringify(json, null, 2), "utf8");
  console.log("Wrote:", outPath);
  const dataKeys = json.data ? Object.keys(json.data) : [];
  console.log("Records in this page:", dataKeys.length);
  if (json.fields_not_found?.length) {
    console.log("Fields not found:", json.fields_not_found.join(", "));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
