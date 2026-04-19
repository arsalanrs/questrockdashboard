/**
 * Shape API field names to request in bulk export.
 *
 * This account returns fields using their display-name keys (e.g. "LOA User Name",
 * "Shape File Status") rather than internal field IDs (e.g. depursLo, mstrstatus1).
 * We request both the API-style lowercase ids AND the likely display-name keys — Shape
 * ignores unknown fields and the field-map (API_TO_CSV) tolerates either shape.
 *
 * Verified from Preview Shape API; extended 2026-04-18 to pull every underwriting,
 * milestone, and contact detail the signal + doc-health engines need.
 */
export const SHAPE_BULK_EXPORT_FIELDS = [
  // Identity
  "leadid",
  "recordtype",
  "createdDate",
  "lastActivityDate",

  // Borrower contact
  "firstname",
  "lastname",
  "email",
  "phone",
  "Mobile Phone",
  "Home Phone",
  "Work Phone",
  "Birth Date",
  "Marital Status",

  // Co-borrower
  "Co Borrower First Name",
  "Co Borrower Last Name",
  "Co Borrower Email",
  "Co Borrower Phone",

  // Address
  "mailingState",
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

  // Lead source / attribution
  "leadsource",
  "channel",
  "utmCampaign",

  // Loan officer
  "depursLo",
  "LOA User Name",
  "Loan Officer Email",

  // Status / pipeline
  "mstrstatus1",
  "status",
  "Shape File Status",
  "Lead Status",
  "LendingPad Status",

  // Loan terms
  "loanamount",
  "loanType",
  "purpose",
  "Documentation Type",
  "Is Self Employed",

  // Underwriting — rates
  "Note Rate",
  "noteRate",
  "Original Rate",
  "originalRate",
  "APR",

  // Underwriting — value / balance / LTV
  "Property Value",
  "propertyValue",
  "Appraised Value",
  "Current Loan Balance",
  "currentLoanBalance",
  "LTV",
  "ltv",
  "CLTV",
  "cltv",

  // Underwriting — credit / DTI
  "Credit Score",
  "creditScore",
  "FICO",
  "fico",
  "DTI",
  "dti",

  // Veteran / VA
  "Is Veteran",
  "isVeteran",

  // ARM
  "ARM First Reset Date",
  "armFirstResetDate",
  "ARM Margin",
  "armMargin",
  "ARM Index",
  "armIndex",

  // Compliance / exceptions
  "HMDA Denial Reason",
  "hmdaDenialReason",
  "Do Not Contact",
  "doNotContact",
  "Last Contacted",
  "Last Contact Date",

  // Historical linkage
  "Insellerate Ref ID",
  "insellerateRefId",

  // LendingPad link
  "lendingPadLoanId",
  "Custom Field - LendingPad Loan ID",

  // Milestone / tracker dates — every pipeline stage
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
];
