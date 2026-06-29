#!/usr/bin/env node
/**
 * Exhaustive LendingPad API probe — list, detail, conditions, documents, and unknown paths.
 *
 * Usage:
 *   node scripts/probe-lendingpad.mjs                    # list first loan from first officer
 *   node scripts/probe-lendingpad.mjs <loan-uuid>        # probe specific loan
 *   node scripts/probe-lendingpad.mjs --list-only      # dump raw list row keys only
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

function basicAuth(user, pass) {
  return `Basic ${Buffer.from(`${user}:${pass}`, "utf8").toString("base64")}`;
}

function queryParams(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") sp.set(k, String(v));
  }
  const q = sp.toString();
  return q ? `?${q}` : "";
}

async function lpGet(ctx, path) {
  const url = `${ctx.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: ctx.auth, Accept: "application/json" },
    signal: AbortSignal.timeout(45_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text.trim() ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text.slice(0, 500) };
  }
  return { ok: res.ok, status: res.status, path, json, textLen: text.length };
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

function dateLikeKeys(keys) {
  return [...keys].filter((k) =>
    /date|time|at$|deadline|contingenc|closing|lock|fund|ctc|piped|credit|appraisal|uw|processing|milestone|critical/i.test(k),
  );
}

function parseOfficers() {
  const raw = process.env.LENDINGPAD_OFFICERS_JSON?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((o) => ({
        name: String(o.officerName ?? o.officer_name ?? "").trim(),
        listUserId: String(o.listUserId ?? o.list_user_id ?? "").trim(),
      }))
      .filter((o) => o.listUserId);
  } catch {
    return [];
  }
}

async function main() {
  loadEnvLocal();
  const baseUrl = (process.env.LENDINGPAD_API_URL || "https://api.lendingpad.com").replace(/\/$/, "");
  const username = process.env.LENDINGPAD_USERNAME?.trim();
  const password = process.env.LENDINGPAD_PASSWORD?.trim();
  const contactId = process.env.LENDINGPAD_CONTACT_ID?.trim();
  const companyId = process.env.LENDINGPAD_COMPANY_ID?.trim();
  if (!username || !password || !contactId || !companyId) {
    console.error("Missing LENDINGPAD_* in .env.local");
    process.exit(1);
  }

  const ctx = {
    baseUrl,
    auth: basicAuth(username, password),
    contactId,
    companyId,
  };

  const listOnly = process.argv.includes("--list-only");
  const loanArg = process.argv.find((a) => /^[0-9a-f-]{36}$/i.test(a));
  let loanUuid = loanArg ?? null;

  const officers = parseOfficers();
  const listUserId = officers[0]?.listUserId || process.env.LENDINGPAD_LIST_USER_ID?.trim();
  if (!listUserId) {
    console.error("No LENDINGPAD_OFFICERS_JSON or LENDINGPAD_LIST_USER_ID");
    process.exit(1);
  }

  console.log(`LendingPad probe — ${baseUrl}`);
  console.log(`Officer: ${officers[0]?.name || "(env)"} user=${listUserId}\n`);

  const listQ = queryParams({
    contact: contactId,
    company: companyId,
    user: listUserId,
    skip: 0,
    take: 5,
  });
  const listRes = await lpGet(ctx, `/integrations/list/loans${listQ}`);
  console.log(`LIST /integrations/list/loans → ${listRes.status} (${listRes.textLen} bytes)`);

  let listRows = [];
  if (listRes.ok && listRes.json) {
    const data = listRes.json;
    if (Array.isArray(data)) listRows = data;
    else if (data?.data && Array.isArray(data.data)) listRows = data.data;
    else if (data?.loans && Array.isArray(data.loans)) listRows = data.loans;
    else {
      for (const v of Object.values(data)) {
        if (Array.isArray(v)) {
          listRows = v;
          break;
        }
      }
    }
  }

  if (!listRows.length) {
    console.log("  No loans in list response");
    console.log("  Raw:", JSON.stringify(listRes.json)?.slice(0, 800));
    process.exit(1);
  }

  const firstRow = listRows[0];
  const listKeys = collectKeys(firstRow);
  console.log(`  First loan: ${firstRow.id || firstRow.loanId || "(no id)"} — ${firstRow.borrower?.firstName || ""} ${firstRow.borrower?.lastName || ""}`);
  console.log(`  List row keys (${listKeys.size}):`);
  console.log(`    ${[...listKeys].sort().join(", ")}`);
  const dateKeys = dateLikeKeys(listKeys);
  if (dateKeys.length) {
    console.log(`\n  Date-like keys on list row:`);
    for (const k of dateKeys.sort()) {
      const parts = k.split(".");
      let v = firstRow;
      for (const p of parts) v = v?.[p];
      console.log(`    ${k}: ${JSON.stringify(v)}`);
    }
  }

  if (!loanUuid) loanUuid = String(firstRow.id ?? firstRow.loanId ?? firstRow.guid ?? "").trim();
  if (!loanUuid) {
    console.error("Could not resolve loan UUID");
    process.exit(1);
  }

  if (listOnly) {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, "lp-list-first-row.json"), JSON.stringify(firstRow, null, 2));
    console.log(`\nWrote data/probe-results/lp-list-first-row.json`);
    return;
  }

  console.log(`\nProbing loan UUID: ${loanUuid}\n`);

  const periodEnd = new Date();
  const periodStart = new Date();
  periodStart.setUTCFullYear(periodStart.getUTCFullYear() - 5);
  const ymd = (d) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  const creationPeriod = `${ymd(periodStart)}-${ymd(periodEnd)}`;

  const loanQ = queryParams({ contact: contactId, company: companyId, loan: loanUuid });
  const paths = [
    `/integrations/loans/detail${loanQ}`,
    `/integrations/loans${loanQ}`,
    `/integrations/loans/${loanUuid}${queryParams({ contact: contactId, company: companyId })}`,
    `/integrations/loans/conditions${loanQ}`,
    `/integrations/loans/documents${loanQ}&creationPeriod=${creationPeriod}`,
    `/integrations/loans/milestones${loanQ}`,
    `/integrations/loans/tasks${loanQ}`,
    `/integrations/loans/fees${loanQ}`,
    `/integrations/loans/timeline${loanQ}`,
    `/integrations/loans/closingdisclosure${loanQ}`,
    `/integrations/loans/closing-disclosure${loanQ}`,
    `/integrations/loans/criticaldates${loanQ}`,
    `/integrations/loans/critical-dates${loanQ}`,
    `/integrations/loans/processingdates${loanQ}`,
    `/integrations/loans/processing-dates${loanQ}`,
    `/integrations/loans/dates${loanQ}`,
    `/integrations/loans/notes${loanQ}`,
    `/integrations/loans/events${loanQ}`,
    `/integrations/loans/history${loanQ}`,
    `/integrations/loans/lock${loanQ}`,
    `/integrations/loans/locks${loanQ}`,
  ];

  mkdirSync(OUT_DIR, { recursive: true });
  const summary = [];

  for (const path of paths) {
    const res = await lpGet(ctx, path);
    const shortPath = path.split("?")[0];
    const keys = res.ok && res.json ? collectKeys(res.json) : new Set();
    const status = res.ok ? "OK" : `FAIL ${res.status}`;
    console.log(`${status.padEnd(12)} ${shortPath} (${res.textLen} bytes, ${keys.size} keys)`);

    if (res.ok && res.json) {
      const safeName = shortPath.replace(/\//g, "_").replace(/^_/, "");
      writeFileSync(join(OUT_DIR, `lp-${safeName}.json`), JSON.stringify(res.json, null, 2));
      const dk = dateLikeKeys(keys);
      if (dk.length) {
        console.log(`             date keys: ${dk.slice(0, 15).join(", ")}${dk.length > 15 ? "…" : ""}`);
      }
      summary.push({ path: shortPath, status: res.status, keyCount: keys.size, dateKeys: dk, keys: [...keys].sort() });
    }
  }

  writeFileSync(join(OUT_DIR, "lp-probe-summary.json"), JSON.stringify({ loanUuid, listUserId, summary }, null, 2));
  writeFileSync(join(OUT_DIR, "lp-list-first-row.json"), JSON.stringify(firstRow, null, 2));
  console.log(`\nWrote probe results to data/probe-results/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
