#!/usr/bin/env node
/**
 * Live bulk export preview: fields_not_found + depursLo LO coverage.
 * Run: node scripts/preview-shape-bulk-lo.mjs
 * Requires .env.local: SHAPE_API_KEY
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
  if (start === -1) throw new Error("Could not parse SHAPE_BULK_EXPORT_FIELDS");
  const slice = src.slice(start);
  const end = slice.indexOf("];");
  const block = slice.slice(0, end);
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function classifyDepursLo(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "empty";
  if (/^\d+$/.test(s) && Number(s) > 0 && Number(s) <= 999) return "numeric_id";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return "email";
  return "display_name";
}

async function searchLead(apiKey, crmId, leadId) {
  const res = await fetch(`https://secure-api.setshape.com/api/search/lead/${crmId}`, {
    method: "POST",
    headers: { Authorization: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ lead_id: leadId }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  const data = json.data ?? json;
  return Array.isArray(data) ? data[0] : data;
}

async function main() {
  loadEnvLocal();
  const apiKey = process.env.SHAPE_API_KEY?.trim();
  const baseUrl = (process.env.SHAPE_API_BASE_URL || "https://secure-api.setshape.com/api").replace(/\/$/, "");
  const crmId = process.env.SHAPE_CRM_ID?.trim() || "20931";
  const leadIdArg = process.argv.find((a) => /^\d+$/.test(a));
  if (!apiKey) {
    console.error("Set SHAPE_API_KEY in .env.local");
    process.exit(1);
  }

  if (leadIdArg) {
    console.log(`Search API — lead ${leadIdArg}`);
    const lead = await searchLead(apiKey, crmId, Number(leadIdArg));
    if (!lead) {
      console.log("  No lead returned");
    } else {
      console.log("  Keys:", Object.keys(lead).sort().join(", "));
      console.log("  AssignedUsers:", JSON.stringify(lead.AssignedUsers ?? lead.assignedUsers ?? null));
      console.log("  depursLo:", lead.depursLo ?? "(absent)");
      console.log("  LOA User Name:", lead["LOA User Name"] ?? "(absent)");
      console.log("  Name:", lead.firstname, lead.lastname, "| status:", lead.mstrstatus1 ?? lead["Lead Status"]);
    }
    console.log("");
  }

  const fields = loadBulkExportFields();
  const to = process.argv.includes("--wide")
    ? "2026-06-25"
    : new Date().toISOString().slice(0, 10);
  const from = process.argv.includes("--wide")
    ? "2025-12-01"
    : new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);

  console.log(`Shape bulk export preview — CRM ${crmId}`);
  console.log(`URL: ${baseUrl}/leads/bulk/export/${crmId}`);
  console.log(`Date range: ${from} → ${to}`);
  console.log(`Fields requested: ${fields.length}\n`);

  const res = await fetch(`${baseUrl}/leads/bulk/export/${crmId}`, {
    method: "POST",
    headers: { Authorization: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      fields,
      pageNumber: 1,
      createdDateRange: { from, to },
    }),
  });

  if (!res.ok) {
    console.error(`Shape API error ${res.status}:`, (await res.text()).slice(0, 500));
    process.exit(1);
  }

  const json = await res.json();
  const records = Object.values(json.data || {});

  console.log(`Records on page 1: ${records.length}`);
  console.log(`API message: ${json.message ?? "(none)"}\n`);

  if (records.length > 0) {
    const first = records[0];
    const keys = Object.keys(first).sort();
    console.log(`Raw keys on first record (${keys.length}): ${keys.join(", ")}\n`);
    const loish = keys.filter((k) => /depur|lo|officer|assign|owner|status/i.test(k));
    if (loish.length) {
      console.log("  LO/status-like raw values on first record:");
      for (const k of loish) {
        console.log(`    ${k}: ${JSON.stringify(first[k])}`);
      }
      console.log("");
    }
  }

  const notFound = json.fields_not_found ?? [];
  const loNotFound = notFound.filter((f) => /lo|depur|officer|assign/i.test(f));
  const otherNotFound = notFound.filter((f) => !/lo|depur|officer|assign/i.test(f));

  if (notFound.length === 0) {
    console.log("✅ fields_not_found: (empty) — all requested fields recognized");
  } else {
    console.log(`⚠️  fields_not_found: ${notFound.length} total`);
    if (loNotFound.length) {
      console.log("\n  LO-related (should be empty after fix):");
      loNotFound.forEach((f) => console.log(`    - ${f}`));
    } else {
      console.log("  ✅ No LO-related fields in fields_not_found");
    }
    if (otherNotFound.length) {
      console.log("\n  Other unrecognized fields:");
      otherNotFound.forEach((f) => console.log(`    - ${f}`));
    }
  }

  if (!records.length) {
    console.log("\nNo records returned for date range.");
    return;
  }

  const withDepursLo = records.filter((r) => String(r.depursLo ?? "").trim());
  const withDepursLi = records.filter((r) => String(r.depursLi ?? "").trim());
  const withLoaUserName = records.filter((r) => String(r["LOA User Name"] ?? r.loanOfficerUserName ?? "").trim());
  const withLoOfficerName = records.filter((r) =>
    String(r["Loan Officer User Name"] ?? r.loanOfficerUserName ?? "").trim(),
  );
  const withLiUserName = records.filter((r) =>
    String(r["Loan Interviewer User Name"] ?? r["LI User Name"] ?? "").trim(),
  );
  const emptyDepursLo = records.length - withDepursLo.length;
  const byKind = { numeric_id: 0, email: 0, display_name: 0, empty: 0 };

  for (const r of records) {
    const raw =
      r.depursLo ??
      r.depursLi ??
      r["LOA User Name"] ??
      r["Loan Officer User Name"] ??
      r["Loan Interviewer User Name"] ??
      r["LI User Name"] ??
      r.loanOfficerUserName ??
      "";
    byKind[classifyDepursLo(raw)] += 1;
  }

  console.log("\n--- LO / LI assignment coverage (page 1) ---");
  console.log(`  depursLo key non-empty:              ${withDepursLo.length} / ${records.length}`);
  console.log(`  depursLi key non-empty:              ${withDepursLi.length} / ${records.length}`);
  console.log(`  LOA User Name non-empty:             ${withLoaUserName.length} / ${records.length}`);
  console.log(`  Loan Officer User Name non-empty:    ${withLoOfficerName.length} / ${records.length}`);
  console.log(`  Loan Interviewer User Name non-empty: ${withLiUserName.length} / ${records.length}`);
  console.log(`  Combined format breakdown (depursLo or LOA User Name):`);
  console.log(`    numeric id:   ${byKind.numeric_id}`);
  console.log(`    email:        ${byKind.email}`);
  console.log(`    display name: ${byKind.display_name}`);
  console.log(`    empty:        ${byKind.empty}`);

  const loExamples = [];
  for (const r of records) {
    const depurs = String(r.depursLo ?? "").trim();
    const depursLi = String(r.depursLi ?? "").trim();
    const loa = String(r["LOA User Name"] ?? "").trim();
    const liName = String(r["Loan Interviewer User Name"] ?? r["LI User Name"] ?? "").trim();
    const officerName = String(r["Loan Officer User Name"] ?? r.loanOfficerUserName ?? "").trim();
    if (depurs || depursLi || loa || liName || officerName) {
      loExamples.push({
        leadid: r.leadid ?? r["Lead ID"],
        depursLo: depurs || "(empty)",
        depursLi: depursLi || "(empty)",
        loaUserName: loa || "(empty)",
        liUserName: liName || "(empty)",
        officerName: officerName || "(empty)",
        name: `${r.firstname ?? r["First Name"] ?? ""} ${r.lastname ?? r["Last Name"] ?? ""}`.trim(),
        status: r.mstrstatus1 ?? r["Lead Status"] ?? r.status ?? "",
      });
    }
  }

  if (loExamples.length) {
    console.log("\n  Records with LO data (up to 10):");
    for (const ex of loExamples.slice(0, 10)) {
      console.log(
        `    lead ${ex.leadid} (${ex.name}): Officer="${ex.officerName}" depursLo="${ex.depursLo}" depursLi="${ex.depursLi}" status="${ex.status}"`,
      );
    }
  } else {
    console.log("\n  ⚠️  No LO data on any record in this page (depursLo omitted when empty; LOA User Name blank).");
  }

  const distinctLoa = [...new Set(withLoaUserName.map((r) => String(r["LOA User Name"]).trim()))].sort();
  const distinctDepursLo = [...new Set(withDepursLo.map((r) => String(r.depursLo).trim()))].sort();
  if (distinctDepursLo.length) {
    console.log(`\n  Distinct depursLo values: ${distinctDepursLo.join(", ")}`);
  }
  if (distinctLoa.length) {
    console.log(`  Distinct LOA User Name values: ${distinctLoa.join(", ")}`);
  }

  const statuses = [
    ...new Set(
      records
        .map((r) => String(r.mstrstatus1 ?? r["Lead Status"] ?? r.status ?? "").trim())
        .filter(Boolean),
    ),
  ].sort();
  console.log(`\n  Distinct status on page (${statuses.length}): ${statuses.slice(0, 10).join(" | ")}${statuses.length > 10 ? " …" : ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
