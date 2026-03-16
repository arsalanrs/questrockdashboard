/**
 * Report which LO should see what on their dashboard.
 * Data source: Shape API (bulk export) OR a Shape custom report CSV.
 *
 * Usage:
 *   node scripts/report-shape-by-lo.js [dateFrom] [dateTo]     # pull from Shape API
 *   node scripts/report-shape-by-lo.js --csv path/to/report.csv # use CSV (recommended; API often omits LO name)
 *
 * CSV default: customreportcsv_172522-0.csv in project root.
 * Requires .env.local: for API mode SHAPE_API_KEY; for stage mapping NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

const path = require("path");
const fs = require("fs");
const Papa = require("papaparse");
const { createClient } = require("@supabase/supabase-js");

const PAGE_SIZE = 50;
const PAGE_DELAY_MS = 1500;
const DEFAULT_DATE_FROM = "2026-01-01";
const DEFAULT_DATE_TO = "2026-03-16";

const SHAPE_FIELDS = [
  "leadid",
  "recordtype",
  "createdDate",
  "lastActivityDate",
  "firstname",
  "lastname",
  "email",
  "phone",
  "loanamount",
  "prState",
  "mailingState",
  "leadsource",
  "channel",
  "depursLo",
  "utmCampaign",
  "mstrstatus1",
  "status",
  "purpose",
  "loanType",
  "trkApplicationCompleted",
  "trkAppraisalRequest",
  "trkCreditReportRequest",
  "trkDateClosed",
];

const EXCLUDED_RECORD_TYPES = new Set(["Referral Partner", "Referral Partners", "Contact"]);
const EXCLUDED_SOURCES = new Set(["zWebLead - VISIT"]);
const PIPED_STAGES = new Set([
  "verification",
  "esign_out",
  "processing",
  "underwriting",
  "approval_conditions",
  "clear_to_close",
  "closing",
]);

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

function str(v) {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

function mapRecord(record) {
  const out = {};
  const pairs = [
    ["leadid", "recordId"],
    ["leadId", "recordId"],
    ["createdDate", "Created Date"],
    ["firstname", "First Name"],
    ["lastname", "Last Name"],
    ["leadsource", "Source"],
    ["recordtype", "Record Type"],
    ["depursLo", "Loan Officer User Name"],
    ["depurLo", "Loan Officer User Name"],
    ["loanOfficerUserName", "Loan Officer User Name"],
  ];
  for (const [apiKey, csvKey] of pairs) {
    if (apiKey in record) {
      const v = str(record[apiKey]);
      if (v !== undefined) out[csvKey] = v;
    }
  }
  for (const k of ["mstrstatus1", "mstrStatus1", "status", "Status"]) {
    if (k in record) {
      const v = str(record[k]);
      if (v !== undefined) {
        out["Status"] = v;
        break;
      }
    }
  }
  const leadIdRaw = record["Lead ID"] ?? record.leadid ?? record.leadId;
  if (out.recordId === undefined && leadIdRaw != null) out.recordId = String(leadIdRaw).trim();
  for (const k of Object.keys(record)) {
    if (/loan\s*officer|depur|depurs|assigned\s*lo/i.test(k) && out["Loan Officer User Name"] === undefined) {
      const v = str(record[k]);
      if (v !== undefined) {
        out["Loan Officer User Name"] = v;
        break;
      }
    }
  }
  const trk = {
    trkAppraisalRequest: "Appraisal Request Date",
    trkApplicationCompleted: "Application Completed Date",
    trkCreditReportRequest: "Credit Report Request Date",
    trkDateClosed: "Tracking Date Closed",
  };
  for (const [apiKey, csvKey] of Object.entries(trk)) {
    if (apiKey in record) {
      const v = str(record[apiKey]);
      if (v !== undefined) out[csvKey] = v;
    }
  }
  return out;
}

async function fetchShapePage(baseUrl, apiKey, crmId, dateFrom, dateTo, pageNumber) {
  const url = `${baseUrl.replace(/\/$/, "")}/leads/bulk/export/${crmId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: SHAPE_FIELDS,
      pageNumber,
      createdDateRange: { from: dateFrom, to: dateTo },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shape API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function findColumn(row, ...candidates) {
  for (const c of candidates) {
    if (row[c] !== undefined && row[c] !== null && String(row[c]).trim() !== "") return String(row[c]).trim();
  }
  const keys = Object.keys(row);
  for (const k of candidates) {
    const lower = k.toLowerCase();
    const found = keys.find((key) => key.toLowerCase() === lower);
    if (found) return String(row[found]).trim();
  }
  return "";
}

function buildRowsFromCsv(csvPath, statusToStage) {
  const csvText = fs.readFileSync(csvPath, "utf8");
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  if (parsed.errors?.length) throw new Error("CSV parse: " + parsed.errors.map((e) => e.message).join("; "));
  const rows = parsed.data;
  const allRows = [];
  for (const row of rows) {
    const recordId = findColumn(row, "recordId", "Lead ID");
    if (!recordId) continue;
    const recordType = findColumn(row, "Record Type");
    const source = findColumn(row, "Source");
    if (EXCLUDED_RECORD_TYPES.has(recordType) || EXCLUDED_SOURCES.has(source)) continue;
    const status = findColumn(row, "Status");
    const currentStage = status ? (statusToStage.get(status) ?? null) : null;
    const appraisalRaw = findColumn(row, "Appraisal Request Date");
    const hasAppraisal = appraisalRaw && appraisalRaw !== "--";
    const inCommandCenter = Boolean(hasAppraisal && currentStage && PIPED_STAGES.has(currentStage));
    const inPrePipeline = Boolean(currentStage !== "funded" && !inCommandCenter);
    allRows.push({
      recordId,
      loName: findColumn(row, "Loan Officer User Name") || null,
      status,
      currentStage: currentStage || "(unmapped)",
      firstName: findColumn(row, "First Name"),
      lastName: findColumn(row, "Last Name"),
      source: findColumn(row, "Source"),
      createdDate: findColumn(row, "Created Date"),
      appraisalDate: hasAppraisal ? appraisalRaw : null,
      inCommandCenter,
      inPrePipeline,
    });
  }
  return allRows;
}

async function main() {
  loadEnvLocal();
  const argv = process.argv.slice(2);
  const csvIdx = argv.indexOf("--csv");
  const useCsv = csvIdx !== -1;
  const csvPath = useCsv ? argv[csvIdx + 1] : null;
  const dateFrom = useCsv ? null : (argv[0] || DEFAULT_DATE_FROM);
  const dateTo = useCsv ? null : (argv[1] || DEFAULT_DATE_TO);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, supabaseKey);
  const { data: mappingRows, error: mapErr } = await supabase
    .from("stage_mapping")
    .select("source_status, normalized_stage");
  if (mapErr) {
    console.error("Failed to load stage_mapping:", mapErr.message);
    process.exit(1);
  }
  const statusToStage = new Map((mappingRows || []).map((r) => [r.source_status, r.normalized_stage]));

  let allRows;
  if (useCsv) {
    const pathToUse = csvPath || path.join(__dirname, "..", "customreportcsv_172522-0.csv");
    if (!fs.existsSync(pathToUse)) {
      console.error("CSV not found:", pathToUse);
      process.exit(1);
    }
    console.log("Using CSV: " + pathToUse + "\n");
    allRows = buildRowsFromCsv(pathToUse, statusToStage);
  } else {
    const apiKey = process.env.SHAPE_API_KEY?.trim();
    const baseUrl = (process.env.SHAPE_API_BASE_URL || "https://secure-api.setshape.com/api").replace(/\/$/, "");
    const crmId = process.env.SHAPE_CRM_ID?.trim() || "20931";
    if (!apiKey) {
      console.error("Set SHAPE_API_KEY in .env.local for API mode, or use --csv path/to/report.csv");
      process.exit(1);
    }
    console.log("Fetching from Shape API (created " + dateFrom + " to " + dateTo + ")...\n");
    allRows = [];
    for (let page = 1; ; page++) {
      const res = await fetchShapePage(baseUrl, apiKey, crmId, dateFrom, dateTo, page);
      const data = res.data || {};
      const records = Object.values(data);
      for (const rec of records) {
        const row = mapRecord(rec);
        const recordId = row.recordId != null ? String(row.recordId).trim() : null;
        if (!recordId) continue;
        const recordType = (row["Record Type"] ?? "").toString().trim();
        const source = (row["Source"] ?? "").toString().trim();
        if (EXCLUDED_RECORD_TYPES.has(recordType) || EXCLUDED_SOURCES.has(source)) continue;
        const status = (row["Status"] ?? "").toString().trim();
        const currentStage = status ? (statusToStage.get(status) ?? null) : null;
        const appraisalDate = (row["Appraisal Request Date"] ?? "").toString().trim();
        const hasAppraisal = appraisalDate && appraisalDate !== "--";
        const inCommandCenter = Boolean(hasAppraisal && currentStage && PIPED_STAGES.has(currentStage));
        const inPrePipeline = Boolean(currentStage !== "funded" && !inCommandCenter);
        allRows.push({
          recordId,
          loName: (row["Loan Officer User Name"] ?? "").toString().trim() || null,
          status,
          currentStage: currentStage || "(unmapped)",
          firstName: (row["First Name"] ?? "").toString().trim(),
          lastName: (row["Last Name"] ?? "").toString().trim(),
          source: row["Source"] ?? "",
          createdDate: row["Created Date"] ?? "",
          appraisalDate: hasAppraisal ? appraisalDate : null,
          inCommandCenter,
          inPrePipeline,
        });
      }
      if (records.length < PAGE_SIZE) break;
      await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
    }
  }

  const byLo = new Map();
  for (const row of allRows) {
    const key = row.loName || "(Unassigned)";
    if (!byLo.has(key)) byLo.set(key, []);
    byLo.get(key).push(row);
  }

  // Sort LOs by name; put Unassigned last
  const loNames = [...byLo.keys()].sort((a, b) => {
    if (a === "(Unassigned)") return 1;
    if (b === "(Unassigned)") return -1;
    return a.localeCompare(b);
  });

  console.log("=== SHAPE DATA: WHO SHOULD SEE WHAT (Dashboard) ===\n");
  if (useCsv) console.log("Source: Custom report CSV");
  else console.log("Date range: " + dateFrom + " to " + dateTo);
  console.log("Total records (after exclusions): " + allRows.length);
  console.log("");

  for (const loName of loNames) {
    const rows = byLo.get(loName);
    const commandCenter = rows.filter((r) => r.inCommandCenter);
    const prePipeline = rows.filter((r) => r.inPrePipeline);
    const other = rows.filter((r) => !r.inCommandCenter && !r.inPrePipeline);

    console.log("--- " + loName + " ---");
    console.log("  Total records assigned in Shape: " + rows.length);
    console.log("  Command Center (pipeline): " + commandCenter.length);
    console.log("  Pre-Pipeline: " + prePipeline.length);
    if (other.length) console.log("  Other (e.g. funded / no stage): " + other.length);
    console.log("");

    if (commandCenter.length) {
      console.log("  Command Center (these appear in the pipeline):");
      commandCenter.forEach((r) => {
        console.log("    • " + r.recordId + " | " + r.firstName + " " + r.lastName + " | " + r.status + " → " + r.currentStage);
      });
      console.log("");
    }

    if (prePipeline.length) {
      console.log("  Pre-Pipeline (click stage to see in side panel):");
      prePipeline.forEach((r) => {
        console.log("    • " + r.recordId + " | " + r.firstName + " " + r.lastName + " | " + r.status + " → " + r.currentStage);
      });
      console.log("");
    }
  }

  console.log("=== END REPORT ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
