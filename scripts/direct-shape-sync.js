/**
 * Direct Shape → Supabase sync (no web server needed, no timeout).
 * Applies the correct field mappings discovered from the Shape API preview.
 *
 * Usage:
 *   node scripts/direct-shape-sync.js                  # last 2 years
 *   node scripts/direct-shape-sync.js 2024-01-01 2026-03-16
 *
 * Requires .env.local: SHAPE_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

const path = require("path");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

const PAGE_SIZE = 50;
const PAGE_DELAY_MS = 1500;

const EXCLUDED_RECORD_TYPES = new Set(["Referral Partner", "Referral Partners", "Contact"]);
const EXCLUDED_SOURCES = new Set(["zWebLead - VISIT"]);

const SHAPE_FIELDS = [
  "leadid", "recordtype", "createdDate", "lastActivityDate",
  "firstname", "lastname", "email", "phone",
  "loanamount", "prState", "mailingState", "leadsource",
  "channel", "depursLo", "utmCampaign", "mstrstatus1", "status",
  "purpose", "loanType",
  "trkApplicationCompleted", "trkAppraisalRequest",
  "trkCreditReportRequest", "trkDateClosed",
];

// API field name → normalized CSV key
const API_TO_CSV = {
  leadid: "recordId", leadId: "recordId",
  "Lead ID": "Lead ID",
  createdDate: "Created Date", "Created Date": "Created Date",
  lastActivityDate: "Date Loan Last Updated", "Last Activity Date": "Date Loan Last Updated",
  firstname: "First Name", firstName: "First Name", "First Name": "First Name",
  lastname: "Last Name", lastName: "Last Name", "Last Name": "Last Name",
  email: "Email", "Email": "Email",
  phone: "Phone", "Phone": "Phone", "Mobile Phone": "Phone",
  loanamount: "Loan Amount", "Loan Amount": "Loan Amount",
  prState: "Property State", "Property State": "Property State",
  mailingState: "Mailing State", "Mailing State": "Mailing State",
  leadsource: "Source", source: "Source", "Source": "Source",
  channel: "Channel", "Channel": "Channel",
  depursLo: "Loan Officer User Name",
  depurLo: "Loan Officer User Name",
  loanOfficerUserName: "Loan Officer User Name",
  "LOA User Name": "Loan Officer User Name",   // actual key this Shape account uses
  utmCampaign: "Custom Field - UTM Campaign", "Custom Field - UTM Campaign": "Custom Field - UTM Campaign",
  recordtype: "Record Type", "Record Type": "Record Type",
  purpose: "Loan Purpose", "Loan Purpose": "Loan Purpose",
  loanType: "Loan Type", loan_type: "Loan Type", "Loan Type": "Loan Type",
};

const STATUS_FIELD_NAMES = ["Shape File Status", "mstrstatus1", "mstrStatus1", "status", "Status"];

const TRK_MAP = {
  trkApplicationCompleted: "Application Completed Date",
  trkAppraisalRequest: "Appraisal Request Date",
  trkCreditReportRequest: "Credit Report Request Date",
  trkDateClosed: "Tracking Date Closed",
};

function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) { console.error("Missing .env.local"); process.exit(1); }
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("="); if (eq === -1) continue;
    const k = t.slice(0, eq).trim(); const v = t.slice(eq + 1).trim();
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}

function str(v) {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

function mapRecord(record) {
  const out = {};
  for (const [apiKey, csvKey] of Object.entries(API_TO_CSV)) {
    if (apiKey in record) {
      const v = str(record[apiKey]);
      if (v !== undefined) out[csvKey] = v;
    }
  }
  for (const k of STATUS_FIELD_NAMES) {
    if (k in record) {
      const v = str(record[k]);
      if (v !== undefined) { out["Status"] = v; break; }
    }
  }
  const leadIdRaw = record["Lead ID"] ?? record.leadid ?? record.leadId;
  if (!out.recordId && leadIdRaw != null) out.recordId = String(leadIdRaw).trim();
  if (!out["Lead ID"] && out.recordId) out["Lead ID"] = out.recordId;
  const rt = record["Record Type"] ?? record.recordtype;
  if (rt != null) { const v = str(rt); if (v) out["Record Type"] = v; }
  for (const [apiKey, csvKey] of Object.entries(TRK_MAP)) {
    if (apiKey in record) { const v = str(record[apiKey]); if (v) out[csvKey] = v; }
  }
  // Fallback: scan for LO key by pattern if still unset
  if (!out["Loan Officer User Name"]) {
    for (const k of Object.keys(record)) {
      if (/loan\s*officer|depur|depurs|loa\s+user|assigned\s*lo/i.test(k)) {
        const v = str(record[k]);
        if (v) { out["Loan Officer User Name"] = v; break; }
      }
    }
  }
  return out;
}

const TIMESTAMP_FORMATS = [
  { regex: /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}) (AM|PM)$/i, fn: (m) => {
    let h = parseInt(m[4]);
    if (m[6].toUpperCase() === "PM" && h !== 12) h += 12;
    if (m[6].toUpperCase() === "AM" && h === 12) h = 0;
    return new Date(parseInt(m[3]), parseInt(m[1])-1, parseInt(m[2]), h, parseInt(m[5])).toISOString();
  }},
  { regex: /^(\d{4})-(\d{2})-(\d{2})/, fn: (m) => new Date(m[0]).toISOString() },
];

function parseMaybeTimestamp(value) {
  const v = (value ?? "").trim();
  if (!v || v === "--") return null;
  for (const { regex, fn } of TIMESTAMP_FORMATS) {
    const m = v.match(regex);
    if (m) { try { return fn(m); } catch {} }
  }
  const d = new Date(v);
  if (!isNaN(d.getTime())) return d.toISOString();
  return null;
}

function parseLoanAmountCents(value) {
  const raw = (value ?? "").toString().trim() || null;
  if (!raw) return { loan_amount_raw: null, loan_amount_cents: null };
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const n = parseFloat(cleaned);
  if (!isNaN(n) && n > 0) return { loan_amount_raw: raw, loan_amount_cents: Math.round(n * 100) };
  return { loan_amount_raw: raw, loan_amount_cents: null };
}

const SLOW_TRACK_TYPES = new Set(["Construction", "Fix & Flip", "Rehab"]);
function deriveTrack(loanType) {
  if (!loanType) return null;
  return SLOW_TRACK_TYPES.has(loanType) ? "slow" : "fast";
}

function twoYearsAgoIso() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 2);
  return d.toISOString().slice(0, 10);
}

async function main() {
  loadEnvLocal();

  const dateFrom = process.argv[2] || twoYearsAgoIso();
  const dateTo = process.argv[3] || new Date().toISOString().slice(0, 10);

  const apiKey = process.env.SHAPE_API_KEY?.trim();
  const baseUrl = (process.env.SHAPE_API_BASE_URL || "https://secure-api.setshape.com/api").replace(/\/$/, "");
  const crmId = process.env.SHAPE_CRM_ID?.trim() || "20931";
  if (!apiKey) { console.error("Set SHAPE_API_KEY in .env.local"); process.exit(1); }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // Load stage mappings
  const { data: mappingRows, error: mapErr } = await supabase.from("stage_mapping").select("source_status,normalized_stage");
  if (mapErr) { console.error("stage_mapping:", mapErr.message); process.exit(1); }
  const statusToStage = new Map((mappingRows || []).map(r => [r.source_status, r.normalized_stage]));

  // Load users for LO name → user id lookup
  const { data: users, error: usersErr } = await supabase.from("users").select("id,full_name");
  if (usersErr) { console.error("users:", usersErr.message); process.exit(1); }
  const nameToUserId = new Map((users || []).map(u => [String(u.full_name).trim().toLowerCase(), u.id]));
  console.log(`Loaded ${nameToUserId.size} users for LO lookup`);

  // Create import batch
  const { data: batch, error: batchErr } = await supabase.from("import_batches")
    .insert({ source: "shape_api_sync", source_filename: null, imported_by: null })
    .select("id").single();
  if (batchErr) { console.error("import_batches:", batchErr.message); process.exit(1); }
  const importBatchId = batch.id;

  console.log(`Syncing Shape → Supabase (${dateFrom} to ${dateTo})...`);

  let totalProcessed = 0, totalSkipped = 0, totalLoans = 0, pages = 0;
  const unmappedStatuses = new Set();
  const allLoansPayload = [];
  const allRawPayload = [];

  for (let pageNumber = 1; ; pageNumber++) {
    const res = await fetch(`${baseUrl}/leads/bulk/export/${crmId}`, {
      method: "POST",
      headers: { Authorization: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: SHAPE_FIELDS,
        pageNumber,
        createdDateRange: { from: dateFrom, to: dateTo },
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`Shape API error ${res.status}:`, text.slice(0, 200));
      process.exit(1);
    }
    const json = await res.json();
    const records = Object.values(json.data || {});
    pages++;
    process.stdout.write(`  Page ${pageNumber}: ${records.length} records\r`);

    for (const record of records) {
      const row = mapRecord(record);
      const recordId = Number(String(row.recordId ?? "").trim());
      if (!Number.isFinite(recordId)) continue;

      totalProcessed++;
      allRawPayload.push({ import_batch_id: importBatchId, record_id: recordId, row });

      const recordType = (row["Record Type"] ?? "").toString().trim();
      const source = (row["Source"] ?? "").toString().trim();
      if (EXCLUDED_RECORD_TYPES.has(recordType) || EXCLUDED_SOURCES.has(source)) {
        totalSkipped++;
        continue;
      }

      const statusRaw = (row["Status"] ?? "").toString().trim() || null;
      const currentStage = statusRaw ? (statusToStage.get(statusRaw) ?? null) : null;
      if (statusRaw && !statusToStage.has(statusRaw)) unmappedStatuses.add(statusRaw);

      const loName = (row["Loan Officer User Name"] ?? "").toString().trim() || null;
      const assignedLoUserId = loName ? (nameToUserId.get(loName.toLowerCase()) ?? null) : null;

      const { loan_amount_raw, loan_amount_cents } = parseLoanAmountCents(row["Loan Amount"]);
      const loanType = (row["Loan Type"] ?? "").trim() || null;
      const appraisalTs = parseMaybeTimestamp(row["Appraisal Request Date"]);

      allLoansPayload.push({
        import_batch_id: importBatchId,
        shape_record_id: recordId,
        shape_lead_id: Number(String(row["Lead ID"] ?? "").trim()) || null,
        lead_created_at: parseMaybeTimestamp(row["Created Date"]),
        record_type: (row["Record Type"] ?? "").trim() || null,
        borrower_first_name: (row["First Name"] ?? "").trim() || null,
        borrower_last_name: (row["Last Name"] ?? "").trim() || null,
        borrower_email: (row["Email"] ?? "").trim() || null,
        borrower_phone: (row["Phone"] ?? "").trim() || null,
        mailing_state: (row["Mailing State"] ?? "").trim() || null,
        property_state: (row["Property State"] ?? "").trim() || null,
        loan_amount_raw,
        loan_amount_cents,
        status_raw: statusRaw,
        current_stage: currentStage,
        source: (row["Source"] ?? "").trim() || null,
        utm_campaign: (row["Custom Field - UTM Campaign"] ?? "").trim() || null,
        channel: (row["Channel"] ?? "").trim() || null,
        loan_type: loanType,
        loan_purpose: (row["Loan Purpose"] ?? "").trim() || null,
        track: deriveTrack(loanType),
        application_completed_at: parseMaybeTimestamp(row["Application Completed Date"]),
        credit_report_requested_at: parseMaybeTimestamp(row["Credit Report Request Date"]),
        appraisal_requested_at: appraisalTs,
        appraisal_ordered_at: appraisalTs,
        closed_at: parseMaybeTimestamp(row["Tracking Date Closed"]),
        assigned_loan_officer_name: loName,
        assigned_loan_officer_user_id: assignedLoUserId,
      });
    }

    if (records.length < PAGE_SIZE) break;
    await new Promise(r => setTimeout(r, PAGE_DELAY_MS));
  }

  console.log(`\nFetched ${pages} pages, ${totalProcessed} records (${totalSkipped} skipped)`);
  console.log(`Writing ${allLoansPayload.length} loans and ${allRawPayload.length} raw records...`);

  // Write raw
  for (let i = 0; i < allRawPayload.length; i += 500) {
    const { error } = await supabase.from("raw_shape_kpi_leads").insert(allRawPayload.slice(i, i + 500));
    if (error) { console.error("raw insert:", error.message); process.exit(1); }
  }

  // Write loans
  for (let i = 0; i < allLoansPayload.length; i += 500) {
    const { error } = await supabase.from("loans").upsert(allLoansPayload.slice(i, i + 500), { onConflict: "shape_record_id" });
    if (error) { console.error("loans upsert:", error.message); process.exit(1); }
  }

  totalLoans = allLoansPayload.length;
  console.log(`Done. Loans upserted: ${totalLoans}`);
  if (unmappedStatuses.size) {
    console.log("Unmapped statuses:", [...unmappedStatuses].sort().join(", "));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
