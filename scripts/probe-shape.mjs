#!/usr/bin/env node
/**
 * Exhaustive Shape CRM API probe — search lead, bulk export, field directory, notes/activity.
 *
 * Usage:
 *   node scripts/probe-shape.mjs [leadId]
 *   node scripts/probe-shape.mjs 58335
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "data", "probe-results");

function loadEnvLocal() {
  const envPath = join(__dirname, "..", ".env.local");
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}

function loadBulkExportFields() {
  const src = readFileSync(join(__dirname, "..", "lib/shape-api/fields.ts"), "utf8");
  const start = src.indexOf("export const SHAPE_BULK_EXPORT_FIELDS = [");
  const end = src.indexOf("];", start);
  const block = src.slice(start, end);
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

async function shapeFetch(url, apiKey, options = {}) {
  const res = await fetch(url, {
    method: options.method || "GET",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(45_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text.trim() ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text.slice(0, 500) };
  }
  return { ok: res.ok, status: res.status, url, json, textLen: text.length };
}

function collectKeys(obj, prefix = "", out = new Set()) {
  if (obj == null) return out;
  if (Array.isArray(obj)) {
    if (obj[0] && typeof obj[0] === "object") collectKeys(obj[0], `${prefix}[]`, out);
    return out;
  }
  if (typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    out.add(key);
    if (v && typeof v === "object" && !Array.isArray(v)) collectKeys(v, key, out);
    else if (Array.isArray(v) && v[0] && typeof v[0] === "object") collectKeys(v[0], `${key}[]`, out);
  }
  return out;
}

function noteLikeKeys(keys) {
  return [...keys].filter((k) => /note|sidebar|recent|game|plan|ai|transcript|comment/i.test(k));
}

function dateLikeKeys(keys) {
  return [...keys].filter((k) =>
    /date|time|trk|contingenc|closing|lock|fund|ctc|credit|appraisal|uw|processing|milestone|contact/i.test(k),
  );
}

async function main() {
  loadEnvLocal();
  const apiKey = process.env.SHAPE_API_KEY?.trim();
  const crmId = process.env.SHAPE_CRM_ID?.trim() || "20931";
  const bulkBase = (process.env.SHAPE_API_BASE_URL || "https://secure.setshape.com/api").replace(/\/$/, "");
  const apiBase = "https://secure-api.setshape.com/api";

  if (!apiKey) {
    console.error("Set SHAPE_API_KEY in .env.local");
    process.exit(1);
  }

  const leadIdArg = process.argv.find((a) => /^\d+$/.test(a));
  mkdirSync(OUT_DIR, { recursive: true });
  const summary = [];

  console.log(`Shape CRM probe — CRM ${crmId}\n`);

  // 1. Bulk export page 1 (full field list)
  const fields = loadBulkExportFields();
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
  const bulkRes = await shapeFetch(`${bulkBase}/leads/bulk/export/${crmId}`, apiKey, {
    method: "POST",
    body: { fields, pageNumber: 1, createdDateRange: { from, to } },
  });
  console.log(`BULK export → ${bulkRes.status} (${bulkRes.textLen} bytes)`);
  const records = bulkRes.ok ? Object.values(bulkRes.json?.data || {}) : [];
  console.log(`  Records: ${records.length}, fields_not_found: ${(bulkRes.json?.fields_not_found || []).length}`);

  let sampleLeadId = leadIdArg ? Number(leadIdArg) : null;
  if (!sampleLeadId && records.length) {
    sampleLeadId = Number(records[0].leadid ?? records[0]["Lead ID"] ?? 0) || null;
  }

  if (records.length) {
    const first = records[0];
    const keys = collectKeys(first);
    writeFileSync(join(OUT_DIR, "shape-bulk-first-record.json"), JSON.stringify(first, null, 2));
    console.log(`  First record keys (${keys.size}): ${[...keys].sort().slice(0, 40).join(", ")}…`);
    const nk = noteLikeKeys(keys);
    const dk = dateLikeKeys(keys);
    if (nk.length) console.log(`  Note-like: ${nk.join(", ")}`);
    if (dk.length) console.log(`  Date-like (${dk.length}): ${dk.slice(0, 20).join(", ")}…`);
    summary.push({ endpoint: "bulk/export", keys: [...keys].sort(), noteKeys: nk, dateKeys: dk });
  }

  if (!sampleLeadId) {
    console.log("\nNo lead ID for search probe — pass leadId as arg");
    return;
  }

  console.log(`\nSearch / activity probes for lead ${sampleLeadId}:\n`);

  // 2. Search lead (full record)
  const searchRes = await shapeFetch(`${apiBase}/search/lead/${crmId}`, apiKey, {
    method: "POST",
    body: { lead_id: sampleLeadId },
  });
  console.log(`SEARCH lead → ${searchRes.status}`);
  if (searchRes.ok && searchRes.json) {
    const data = searchRes.json.data ?? searchRes.json;
    const lead = Array.isArray(data) ? data[0] : data;
    if (lead) {
      const keys = collectKeys(lead);
      writeFileSync(join(OUT_DIR, "shape-search-lead.json"), JSON.stringify(lead, null, 2));
      console.log(`  Keys (${keys.size}): ${[...keys].sort().join(", ")}`);
      const nk = noteLikeKeys(keys);
      const dk = dateLikeKeys(keys);
      if (nk.length) {
        console.log(`  Note fields:`);
        for (const k of nk) console.log(`    ${k}: ${JSON.stringify(lead[k])?.slice(0, 120)}`);
      }
      if (dk.length) {
        console.log(`  Date fields (sample):`);
        for (const k of dk.slice(0, 25)) console.log(`    ${k}: ${JSON.stringify(lead[k])}`);
      }
      summary.push({ endpoint: "search/lead", keys: [...keys].sort(), noteKeys: nk, dateKeys: dk });
    }
  }

  // 3. Probe candidate endpoints
  const candidates = [
    `${apiBase}/leads/${sampleLeadId}`,
    `${apiBase}/leads/${crmId}/${sampleLeadId}`,
    `${apiBase}/lead/${sampleLeadId}`,
    `${apiBase}/leads/${sampleLeadId}/notes`,
    `${apiBase}/leads/${sampleLeadId}/activity`,
    `${apiBase}/leads/${sampleLeadId}/timeline`,
    `${apiBase}/notes?lead_id=${sampleLeadId}`,
    `${apiBase}/notes/${sampleLeadId}`,
    `${apiBase}/activity/${sampleLeadId}`,
    `${bulkBase}/leads/${sampleLeadId}`,
    `${bulkBase}/leads/${sampleLeadId}/notes`,
    `${bulkBase}/fields`,
    `${bulkBase}/customfields`,
    `${bulkBase}/leads/fields`,
    `${bulkBase}/account/fields`,
    `${apiBase}/fields`,
    `${apiBase}/customfields`,
    `${apiBase}/leads/fields`,
    `${apiBase}/account/fields`,
    `${apiBase}/account/${crmId}/fields`,
  ];

  for (const url of candidates) {
    const res = await shapeFetch(url, apiKey, { method: url.includes("search") ? "POST" : "GET" });
    const short = url.replace(apiBase, "").replace(bulkBase, "[bulk]");
    const status = res.ok ? "OK" : `FAIL ${res.status}`;
    const keys = res.ok && res.json ? collectKeys(res.json) : new Set();
    console.log(`${status.padEnd(12)} ${short} (${res.textLen} bytes, ${keys.size} keys)`);
    if (res.ok && res.json && keys.size > 0) {
      const safe = short.replace(/[^a-z0-9]+/gi, "_").replace(/^_/, "");
      writeFileSync(join(OUT_DIR, `shape-${safe}.json`), JSON.stringify(res.json, null, 2));
      summary.push({ endpoint: short, keyCount: keys.size, keys: [...keys].sort().slice(0, 50) });
    }
  }

  // 4. Extra field probe — request fields we might be missing
  const extraFields = [
    "game_plan_notes",
    "gamePlanNotes",
    "Game Plan Notes",
    "initial_contact_attempted",
    "Initial Contact Attempted",
    "last_contacted",
    "Last Contacted",
    "Last Contact Date",
    "notes_sidebar",
    "notes_sidebar_ai_note",
    "recent_notes",
    "trkTitleOrdered",
    "trkInsuranceOrdered",
    "trkPreCdSent",
    "trkPreCdApproved",
    "Finance Contingency Date",
    "Appraisal Contingency Date",
    "Lock Expiration Date",
    "Closing Scheduled Date",
    "trkAppraisalRequest",
    "trkCreditReportRequest",
  ];
  const extraRes = await shapeFetch(`${bulkBase}/leads/bulk/export/${crmId}`, apiKey, {
    method: "POST",
    body: {
      fields: extraFields,
      pageNumber: 1,
      createdDateRange: { from, to },
    },
  });
  console.log(`\nEXTRA fields probe → ${extraRes.status}`);
  if (extraRes.ok) {
    const notFound = extraRes.json?.fields_not_found || [];
    const found = extraFields.filter((f) => !notFound.includes(f));
    console.log(`  Found (${found.length}): ${found.join(", ")}`);
    console.log(`  Not found (${notFound.length}): ${notFound.join(", ")}`);
    if (records.length || Object.values(extraRes.json?.data || {}).length) {
      const rec = Object.values(extraRes.json?.data || {})[0] || records[0];
      if (rec) {
        console.log(`  Sample values on first record:`);
        for (const f of found) {
          const v = rec[f];
          if (v != null && String(v).trim()) console.log(`    ${f}: ${JSON.stringify(v).slice(0, 100)}`);
        }
      }
    }
    writeFileSync(join(OUT_DIR, "shape-extra-fields-probe.json"), JSON.stringify(extraRes.json, null, 2));
  }

  writeFileSync(join(OUT_DIR, "shape-probe-summary.json"), JSON.stringify(summary, null, 2));
  console.log(`\nWrote probe results to data/probe-results/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
