import type { ShapeKpiCsvRow } from "@/lib/import/shape-kpi";
import { applyShapeAssignmentFields } from "@/lib/shape-api/apply-shape-assignments";
import { parseShapeDepursLoId } from "@/lib/shape-api/lo-roster";

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
  "Home Phone": "Home Phone",
  "Work Phone": "Work Phone",
  "Birth Date": "Birth Date",
  birthDate: "Birth Date",
  "Marital Status": "Marital Status",
  maritalStatus: "Marital Status",
  // Co-borrower
  "Co Borrower First Name": "Co Borrower First Name",
  coBorrowerFirstName: "Co Borrower First Name",
  "Co Borrower Last Name": "Co Borrower Last Name",
  coBorrowerLastName: "Co Borrower Last Name",
  "Co Borrower Email": "Co Borrower Email",
  coBorrowerEmail: "Co Borrower Email",
  "Co Borrower Phone": "Co Borrower Phone",
  coBorrowerPhone: "Co Borrower Phone",

  // Loan amount — every casing variant Shape might use as a response key.
  // NOTE: Shape's actual field ID is "LoanAmount" (camelCase). The all-lowercase
  // "loanamount" appears in fields_not_found and returns no data.
  LoanAmount: "Loan Amount",
  loanAmount: "Loan Amount",
  loanamount: "Loan Amount",
  loan_amount: "Loan Amount",
  borLoanAmount: "Loan Amount",
  "Loan Amount": "Loan Amount",

  // Purchase price (purchase loans) — fall back to this if Loan Amount is absent
  borpurchasePrice: "Purchase Price",
  "Purchase Price": "Purchase Price",
  downpmtamount2: "Down Payment Amount",
  "Down Payment Amount": "Down Payment Amount",
  loan_estAppraisalVal: "Estimated Appraisal Value",
  "Estimated Appraisal Value": "Estimated Appraisal Value",
  prState: "Property State",
  property_state: "Property State",
  "Property State": "Property State",
  "Property City": "Property City",
  propertyCity: "Property City",
  "Property Zip": "Property Zip",
  propertyZip: "Property Zip",
  "Property Address": "Property Address",
  propertyAddress: "Property Address",
  "Subject Property Type": "Subject Property Type",
  subjectPropertyType: "Subject Property Type",
  "Occupancy Type": "Occupancy Type",
  occupancyType: "Occupancy Type",
  mailingState: "Mailing State",
  mailing_state: "Mailing State",
  "Mailing State": "Mailing State",
  "Mailing City": "Mailing City",
  "Mailing Zip": "Mailing Zip",
  "Mailing Address": "Mailing Address",
  leadsource: "Source",
  lead_source: "Source",
  source: "Source",
  "Source": "Source",
  channel: "Channel",
  // depursLo / depursLi handled separately — value may be id, email, or display name.
  loanOfficerUserName: "Loan Officer User Name",
  "LOA User Name": "Loan Officer User Name",
  "Loan Officer User Name": "Loan Officer User Name",
  "Loan Interviewer User Name": "Loan Officer User Name",
  "LI User Name": "Loan Officer User Name",
  "Loan Officer Email": "Loan Officer Email",
  loanOfficerEmail: "Loan Officer Email",
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
  "Documentation Type": "Documentation Type",
  documentationType: "Documentation Type",
  "Is Self Employed": "Is Self Employed",
  isSelfEmployed: "Is Self Employed",
  lendingPadLoanId: "Custom Field - LendingPad Loan ID",
  lending_pad_loan_id: "Custom Field - LendingPad Loan ID",
  "LendingPad Loan ID": "Custom Field - LendingPad Loan ID",
  "Custom Field - LendingPad Loan ID": "Custom Field - LendingPad Loan ID",
  "LendingPad Status": "LendingPad Status",
  lendingPadStatus: "LendingPad Status",
  "Portal Status": "Portal Status",
  "POS Status": "Portal Status",
  portalStatus: "Portal Status",
  posStatus: "Portal Status",
  "Conversion Date": "Conversion Date",
  conversionDate: "Conversion Date",
  "Last Status Change Date": "Last Status Change Date",
  "Status Change Date": "Last Status Change Date",
  "E-Sign Returned Date": "E-Sign Returned Date",
  "Appraisal Payment Collected Date": "Appraisal Payment Collected Date",

  // Underwriting (Phase 2 fields).
  "Note Rate": "Note Rate",
  noteRate: "Note Rate",
  note_rate: "Note Rate",
  "Original Rate": "Original Rate",
  originalRate: "Original Rate",
  APR: "APR",
  apr: "APR",
  "Property Value": "Property Value",
  propertyValue: "Property Value",
  "Appraised Value": "Property Value",
  "Current Loan Balance": "Current Loan Balance",
  currentLoanBalance: "Current Loan Balance",
  "LTV": "LTV",
  ltv: "LTV",
  "CLTV": "CLTV",
  cltv: "CLTV",
  "Credit Score": "Credit Score",
  creditScore: "Credit Score",
  borcreditscore: "Credit Score",
  "FICO": "Credit Score",
  fico: "Credit Score",
  "DTI": "DTI",
  dti: "DTI",
  "Is Veteran": "Is Veteran",
  isVeteran: "Is Veteran",
  veteran: "Is Veteran",
  "ARM First Reset Date": "ARM First Reset Date",
  armFirstResetDate: "ARM First Reset Date",
  "ARM Margin": "ARM Margin",
  armMargin: "ARM Margin",
  "ARM Index": "ARM Index",
  armIndex: "ARM Index",
  "HMDA Denial Reason": "HMDA Denial Reason",
  hmdaDenialReason: "HMDA Denial Reason",
  "Do Not Contact": "Do Not Contact",
  doNotContact: "Do Not Contact",
  "Last Contacted": "Last Contacted",
  lastContacted: "Last Contacted",
  last_contacted: "Last Contacted",
  "Last Contact Date": "Last Contacted",
  "Insellerate Ref ID": "Insellerate Ref ID",
  insellerateRefId: "Insellerate Ref ID",
  "Funded Date": "Funded Date",
  fundedDate: "Funded Date",
  trkFunded: "Funded Date",
  "Closing Scheduled Date": "Closing Scheduled Date",
  "Lock Expiration Date": "Lock Expiration Date",

  // Contingency dates
  "Finance Contingency Date": "Finance Contingency Date",
  financeContingencyDate: "Finance Contingency Date",
  "Appraisal Contingency Date": "Appraisal Contingency Date",
  appraisalContingencyDate: "Appraisal Contingency Date",

  // Notes fields
  "notes_sidebar": "Notes Sidebar",
  "Notes Sidebar": "Notes Sidebar",
  "notes_sidebar_ai_note": "Notes Sidebar AI Note",
  "Notes Sidebar AI Note": "Notes Sidebar AI Note",
  "recent_notes": "Recent Note",
  "Recent Note": "Recent Note",
  game_plan_notes: "Game Plan Notes",
  "Game Plan Notes": "Game Plan Notes",
  initial_contact_attempted: "Initial Contact Attempted",
  "Initial Contact Attempted": "Initial Contact Attempted",
};

/** Status field name in Shape API (account-specific; override via env or config). */
// "Shape File Status" is the display-name key this account uses (confirmed from Preview)
const STATUS_FIELD_NAMES = [
  "Shape File Status",
  "Lead Status",
  "mstrstatus1",
  "mstrStatus1",
  "status",
  "Status",
];

const PORTAL_STATUS_FIELD_NAMES = [
  "Portal Status",
  "POS Status",
  "portalStatus",
  "posStatus",
];

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

  for (const portalKey of PORTAL_STATUS_FIELD_NAMES) {
    if (portalKey in record) {
      const v = str(record[portalKey]);
      if (v !== undefined) {
        out["Portal Status"] = v;
        break;
      }
    }
  }

  if (out["Portal Status"] === undefined) {
    for (const key of Object.keys(record)) {
      if (/portal\s*status|pos\s*status|portalregistration/i.test(key)) {
        const v = str(record[key]);
        if (v !== undefined) {
          out["Portal Status"] = v;
          break;
        }
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

  // Loan Amount: robust fallback scan — Shape may return this under many key variants.
  // If the explicit API_TO_CSV map already captured it, skip. Otherwise scan all keys.
  if (out["Loan Amount"] === undefined) {
    for (const key of Object.keys(record)) {
      if (/^(loan\s*amount|LoanAmount|loanAmount|borLoanAmount|bor.*loan.*amount|loan.*amount)$/i.test(key)) {
        const v = str(record[key]);
        if (v !== undefined) {
          out["Loan Amount"] = v;
          break;
        }
      }
    }
  }

  // Purchase Price: fallback for purchase loans where loan amount may come from borpurchasePrice
  if (out["Purchase Price"] === undefined) {
    for (const key of Object.keys(record)) {
      if (/purchase\s*price|borpurchase|bor.*purchase/i.test(key)) {
        const v = str(record[key]);
        if (v !== undefined) {
          out["Purchase Price"] = v;
          break;
        }
      }
    }
  }

  // User assignment departments (LO → LI → LP → PO → Closer); Shape may return display-name keys.
  applyShapeAssignmentFields(record, out);

  if (out["Shape Depurs LO Id"] === undefined) {
    for (const key of ["lead_owner_id", "leadOwnerId"]) {
      if (key in record) {
        const id = parseShapeDepursLoId(record[key]);
        if (id != null) {
          out["Shape Depurs LO Id"] = String(id);
          break;
        }
      }
    }
  }

  if (out["Loan Officer User Name"] === undefined) {
    for (const key of ["LOA User Name", "loanOfficerUserName", "Loan Officer User Name"]) {
      if (key in record) {
        const v = str(record[key]);
        if (v !== undefined) {
          out["Loan Officer User Name"] = v;
          break;
        }
      }
    }
  }

  // Do not fuzzy-scan depurs* keys — loanType/loanAmount matched /loa/ and polluted LO assignment.

  if (out["E-Sign Returned Date"] === undefined) {
    for (const key of Object.keys(record)) {
      if (/e[-\s]?sign.*return|signed.*package|package.*signed|esign.*complete/i.test(key)) {
        const v = str(record[key]);
        if (v !== undefined) {
          out["E-Sign Returned Date"] = v;
          break;
        }
      }
    }
  }

  if (out["Appraisal Payment Collected Date"] === undefined) {
    for (const key of Object.keys(record)) {
      if (/appraisal.*payment|payment.*appraisal|appraisal.*fee.*paid|skin\s*in\s*the\s*game/i.test(key)) {
        const v = str(record[key]);
        if (v !== undefined) {
          out["Appraisal Payment Collected Date"] = v;
          break;
        }
      }
    }
  }

  // LendingPad loan UUID (custom field name varies by Shape account)
  if (out["Custom Field - LendingPad Loan ID"] === undefined) {
    for (const key of Object.keys(record)) {
      if (/lending\s*pad.*loan|lp\s*loan.*uuid|lendingpad.*id/i.test(key)) {
        const v = str(record[key]);
        if (v !== undefined) {
          out["Custom Field - LendingPad Loan ID"] = v;
          break;
        }
      }
    }
  }

  // Tracking/milestone dates (trk*); every pipeline stage mapped.
  const trkMap: Record<string, string> = {
    trkApplicationCompleted: "Application Completed Date",
    trkCreditReportRequest: "Credit Report Request Date",
    trkAppraisalRequest: "Appraisal Request Date",
    trkAppraisalReceived: "Appraisal Received Date",
    trkAppraisalPaymentCollected: "Appraisal Payment Collected Date",
    trkTitleOrdered: "Title Ordered Date",
    trkInsuranceOrdered: "Insurance Ordered Date",
    trkEsignRequested: "E-Sign Requested Date",
    trkEsignReturned: "E-Sign Returned Date",
    trkSubmittedToProcessing: "Submitted To Processing Date",
    trkProcessingCompleted: "Processing Completed Date",
    trkSubmittedToUw: "Submitted To UW Date",
    trkUwDecision: "UW Decision Date",
    trkConditionsReceived: "Conditions Received Date",
    trkConditionsSubmitted: "Conditions Submitted Date",
    trkPreCdSent: "Pre CD Sent Date",
    trkPreCdApproved: "Pre CD Approved Date",
    trkCtc: "CTC Date",
    trkCtcDate: "CTC Date",
    trkClosingScheduled: "Closing Scheduled Date",
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
