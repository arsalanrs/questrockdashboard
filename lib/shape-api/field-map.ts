import type { ShapeKpiCsvRow } from "@/lib/import/shape-kpi";

/** Map Shape API field names to the CSV-like keys used by the existing import pipeline. */
const API_TO_CSV: Record<string, string> = {
  leadid: "recordId",
  leadId: "recordId",
  "Lead ID": "Lead ID",
  createdDate: "Created Date",
  created_date: "Created Date",
  "Created Date": "Created Date",
  lastActivityDate: "Date Loan Last Updated",
  last_activity_date: "Date Loan Last Updated",
  "Last Activity Date": "Date Loan Last Updated",
  firstname: "First Name",
  firstName: "First Name",
  "First Name": "First Name",
  lastname: "Last Name",
  lastName: "Last Name",
  "Last Name": "Last Name",
  email: "Email",
  "Email": "Email",
  phone: "Phone",
  "Phone": "Phone",
  // Shape returns phone as "Mobile Phone" for this account
  "Mobile Phone": "Phone",
  loanamount: "Loan Amount",
  loan_amount: "Loan Amount",
  "Loan Amount": "Loan Amount",
  prState: "Property State",
  property_state: "Property State",
  "Property State": "Property State",
  mailingState: "Mailing State",
  mailing_state: "Mailing State",
  "Mailing State": "Mailing State",
  leadsource: "Source",
  lead_source: "Source",
  source: "Source",
  "Source": "Source",
  channel: "Channel",
  depursLo: "Loan Officer User Name",
  depurLo: "Loan Officer User Name",
  loanOfficerUserName: "Loan Officer User Name",
  // Shape returns the LO field as "LOA User Name" (confirmed from account Preview)
  "LOA User Name": "Loan Officer User Name",
  utmCampaign: "Custom Field - UTM Campaign",
  utm_campaign: "Custom Field - UTM Campaign",
  "Custom Field - UTM Campaign": "Custom Field - UTM Campaign",
  recordtype: "Record Type",
  "Record Type": "Record Type",
  purpose: "Loan Purpose",
  "Loan Purpose": "Loan Purpose",
  loanType: "Loan Type",
  loan_type: "Loan Type",
  "Loan Type": "Loan Type",
};

/** Status field name in Shape API (account-specific; override via env or config). */
// "Shape File Status" is the display-name key this account uses (confirmed from Preview)
const STATUS_FIELD_NAMES = ["Shape File Status", "mstrstatus1", "mstrStatus1", "status", "Status"];

function str(value: unknown): string | undefined {
  if (value == null) return undefined;
  const s = String(value).trim();
  return s || undefined;
}

/**
 * Maps a single Shape API lead record to the CSV-like row shape expected by
 * the existing stage_mapping and loan payload logic (run-shape-kpi-import).
 */
export function mapApiRecordToCsvLike(record: Record<string, unknown>): ShapeKpiCsvRow {
  const out: ShapeKpiCsvRow = {};

  for (const [apiKey, csvKey] of Object.entries(API_TO_CSV)) {
    if (apiKey in record) {
      const v = str(record[apiKey]);
      if (v !== undefined) out[csvKey] = v;
    }
  }

  // Status: try known API status field names (account-specific)
  for (const statusKey of STATUS_FIELD_NAMES) {
    if (statusKey in record) {
      const v = str(record[statusKey]);
      if (v !== undefined) {
        out["Status"] = v;
        break;
      }
    }
  }

  // recordId must be set for the row to be used (used as shape_record_id)
  const leadIdRaw = record["Lead ID"] ?? record.leadid ?? record.leadId;
  if (out["recordId"] === undefined && leadIdRaw != null) {
    out["recordId"] = String(leadIdRaw).trim();
  }
  if (out["Lead ID"] === undefined && out["recordId"] !== undefined) {
    out["Lead ID"] = out["recordId"];
  }

  // Record Type (Applications, Loans, Leads, Referral Partners) for sync filter
  const recordType = record["Record Type"] ?? record.recordtype;
  if (recordType != null) {
    const v = str(recordType);
    if (v !== undefined) out["Record Type"] = v;
  }

  // Loan Officer: if not set by API_TO_CSV, try any key that looks like LO name (API field names vary)
  if (out["Loan Officer User Name"] === undefined) {
    for (const key of Object.keys(record)) {
      if (/loan\s*officer|depur|depurs|assigned\s*lo/i.test(key)) {
        const v = str(record[key]);
        if (v !== undefined) {
          out["Loan Officer User Name"] = v;
          break;
        }
      }
    }
  }

  // Tracking/milestone dates (trk*); add more as discovered
  const trkMap: Record<string, string> = {
    trkApplicationCompleted: "Application Completed Date",
    trkAppraisalRequest: "Appraisal Request Date",
    trkCreditReportRequest: "Credit Report Request Date",
    trkDateClosed: "Tracking Date Closed",
  };
  for (const [apiKey, csvKey] of Object.entries(trkMap)) {
    if (apiKey in record) {
      const v = str(record[apiKey]);
      if (v !== undefined) out[csvKey] = v;
    }
  }

  return out;
}
