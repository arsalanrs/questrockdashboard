/**
 * Shape API field names to request in bulk export.
 * Account-specific: confirm in Shape Settings > Marketing Sources > Campaign Source Post URL Instructions.
 * Status field may be mstrstatus1 or another; add/remove as needed.
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
