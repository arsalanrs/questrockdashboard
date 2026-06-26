/**
 * Shape API field names to request in bulk export.
 *
 * KEY RULE: Shape ignores unknown field names silently — if a field comes back
 * in `fields_not_found`, volume/amount/etc will be null. We therefore request
 * BOTH the camelCase API field IDs (e.g. "LoanAmount", "loanType") AND the
 * likely display-name labels Shape uses in responses (e.g. "Loan Amount").
 *
 * Loan amount specifically: Shape's field ID is "LoanAmount" (capital L, A).
 * The all-lowercase "loanamount" is NOT recognised and returns fields_not_found.
 * We also pull "borpurchasePrice" (purchase price for purchase loans).
 */
export const SHAPE_BULK_EXPORT_FIELDS = [
  // ── Identity ─────────────────────────────────────────────────────────────
  "leadid",
  "leadId",
  "recordtype",
  "Record Type",
  "createdDate",
  "Created Date",
  "lastActivityDate",
  "Last Activity Date",

  // ── Borrower contact ─────────────────────────────────────────────────────
  "firstname",
  "First Name",
  "lastname",
  "Last Name",
  "email",
  "Email",
  "phone",
  "Phone",
  "Mobile Phone",
  "Home Phone",
  "Work Phone",
  "Birth Date",
  "Marital Status",

  // ── Co-borrower ───────────────────────────────────────────────────────────
  "Co Borrower First Name",
  "Co Borrower Last Name",
  "Co Borrower Email",
  "Co Borrower Phone",

  // ── Address ───────────────────────────────────────────────────────────────
  "mailingState",
  "Mailing State",
  "Mailing City",
  "Mailing Zip",
  "Mailing Address",
  "prState",
  "Property State",
  "Property City",
  "Property Zip",
  "Property Address",
  "Subject Property Type",
  "Occupancy Type",

  // ── Lead source / attribution ─────────────────────────────────────────────
  "leadsource",
  "Source",
  "channel",
  "Channel",
  "utmCampaign",

  // ── User assignment departments (LO → LI → LP → PO → Closer) ───────────────
  // Shape maps API keys to display columns (e.g. depursLo → Loan Officer User Name).
  "depursLo",
  "depursLi",
  "depursLp",
  "depursPo",
  "depursCl",
  "Loan Officer User Name",
  "loanOfficerUserName",
  "LOA User Name",
  "Loan Interviewer User Name",
  "LI User Name",
  "Loan Processor User Name",
  "LP User Name",
  "Processor User Name",
  "PO User Name",
  "Closer User Name",

  // ── Status / pipeline ─────────────────────────────────────────────────────
  "mstrstatus1",
  "status",
  "Status",
  "Shape File Status",
  "Lead Status",
  "LendingPad Status",
  "Portal Status",
  "POS Status",
  "portalStatus",
  "posStatus",
  "Last Status Change Date",
  "Status Change Date",
  "Conversion Date",

  // ── Loan terms ────────────────────────────────────────────────────────────
  // Loan amount — request both the correct camelCase ID and display label variants.
  // "loanamount" (all-lowercase) is NOT a valid Shape field — use "LoanAmount".
  "LoanAmount",
  "loanAmount",
  "Loan Amount",
  "borLoanAmount",

  // Purchase price / down payment (for purchase loans)
  "borpurchasePrice",
  "Purchase Price",
  "downpmtamount2",
  "Down Payment Amount",

  // Estimated appraised value
  "loan_estAppraisalVal",
  "Estimated Appraisal Value",

  // Loan type / purpose
  "loanType",
  "Loan Type",
  "purpose",
  "Loan Purpose",
  "Documentation Type",
  "Is Self Employed",

  // ── Underwriting — rates ──────────────────────────────────────────────────
  "Note Rate",
  "noteRate",
  "Original Rate",
  "originalRate",
  "APR",

  // ── Underwriting — value / balance / LTV ──────────────────────────────────
  "Property Value",
  "propertyValue",
  "Appraised Value",
  "Current Loan Balance",
  "currentLoanBalance",
  "LTV",
  "ltv",
  "CLTV",
  "cltv",

  // ── Underwriting — credit / DTI ───────────────────────────────────────────
  "Credit Score",
  "creditScore",
  "borcreditscore",
  "FICO",
  "fico",
  "DTI",
  "dti",

  // ── Veteran / VA ──────────────────────────────────────────────────────────
  "Is Veteran",
  "isVeteran",

  // ── ARM ───────────────────────────────────────────────────────────────────
  "ARM First Reset Date",
  "armFirstResetDate",
  "ARM Margin",
  "armMargin",
  "ARM Index",
  "armIndex",

  // ── Compliance / exceptions ───────────────────────────────────────────────
  "HMDA Denial Reason",
  "hmdaDenialReason",
  "Do Not Contact",
  "doNotContact",
  "Last Contacted",
  "Last Contact Date",

  // ── Historical linkage ────────────────────────────────────────────────────
  "Insellerate Ref ID",
  "insellerateRefId",

  // ── LendingPad link ───────────────────────────────────────────────────────
  "lendingPadLoanId",
  "Custom Field - LendingPad Loan ID",

  // ── Milestone / tracker dates — every pipeline stage ─────────────────────
  "trkApplicationCompleted",
  "trkCreditReportRequest",
  "trkAppraisalRequest",
  "trkAppraisalReceived",
  "trkAppraisalPaymentCollected",
  "trkTitleOrdered",
  "trkInsuranceOrdered",
  "trkEsignRequested",
  "trkEsignReturned",
  "trkSubmittedToProcessing",
  "trkProcessingCompleted",
  "trkSubmittedToUw",
  "trkUwDecision",
  "trkConditionsReceived",
  "trkConditionsSubmitted",
  "trkPreCdSent",
  "trkPreCdApproved",
  "trkCtc",
  "trkCtcDate",
  "trkClosingScheduled",
  "trkDateClosed",
  "trkFunded",
  "Funded Date",
  "Closing Scheduled Date",
  "Lock Expiration Date",

  // ── Contingency dates ─────────────────────────────────────────────────────
  "Finance Contingency Date",
  "financeContingencyDate",
  "Appraisal Contingency Date",
  "appraisalContingencyDate",

  // ── Notes (three sources) ────────────────────────────────────────────────
  "notes_sidebar",
  "Notes Sidebar",
  "notes_sidebar_ai_note",
  "Notes Sidebar AI Note",
  "recent_notes",
  "Recent Note",
];

/**
 * Lean field list for paged sync (avoids Vercel 10–30s timeouts).
 * Shape CRM 20931 returns display-name response keys; api ids are enough in the request.
 * Includes dept assignment + Loan Officer User Name (required for LO data on this account).
 */
export const SHAPE_BULK_EXPORT_FIELDS_SYNC: readonly string[] = [
  "leadid",
  "recordtype",
  "createdDate",
  "lastActivityDate",
  "firstname",
  "lastname",
  "email",
  "phone",
  "depursLo",
  "depursLi",
  "depursLp",
  "depursPo",
  "depursCl",
  "Loan Officer User Name",
  "LOA User Name",
  "mstrstatus1",
  "Lead Status",
  "leadsource",
  "channel",
  "utmCampaign",
  "mailingState",
  "prState",
  "LoanAmount",
  "borpurchasePrice",
  "downpmtamount2",
  "loan_estAppraisalVal",
  "purpose",
  "loanType",
  "borcreditscore",
  "Custom Field - LendingPad Loan ID",
  "Portal Status",
  "portalStatus",
  "LendingPad Status",
  "Conversion Date",
  "Last Status Change Date",
  "notes_sidebar",
  "notes_sidebar_ai_note",
  "recent_notes",
  "trkApplicationCompleted",
  "trkCreditReportRequest",
  "trkAppraisalRequest",
  "trkAppraisalReceived",
  "trkAppraisalPaymentCollected",
  "trkEsignRequested",
  "trkEsignReturned",
  "trkSubmittedToProcessing",
  "trkProcessingCompleted",
  "trkSubmittedToUw",
  "trkUwDecision",
  "trkConditionsReceived",
  "trkConditionsSubmitted",
  "trkPreCdSent",
  "trkPreCdApproved",
  "trkCtc",
  "trkClosingScheduled",
  "trkDateClosed",
  "trkFunded",
  "Funded Date",
  "Closing Scheduled Date",
];
