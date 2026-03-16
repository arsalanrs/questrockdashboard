/**
 * Shape API field names to request in bulk export.
 * This account returns fields using their display-name keys (e.g. "LOA User Name",
 * "Shape File Status") rather than internal field IDs (e.g. depursLo, mstrstatus1).
 * Confirmed from Preview Shape API on 2026-03-11.
 */
export const SHAPE_BULK_EXPORT_FIELDS = [
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
  "depursLo",       // Shape may return this as "LOA User Name" display key
  "utmCampaign",
  "mstrstatus1",    // Shape may return this as "Shape File Status" display key
  "status",
  "purpose",
  "loanType",
  "trkApplicationCompleted",
  "trkAppraisalRequest",
  "trkCreditReportRequest",
  "trkDateClosed",
];
