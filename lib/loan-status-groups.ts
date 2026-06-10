/* ------------------------------------------------------------------ */
/*  Questrock Loan Status Groups                                       */
/*  Maps Shape CRM statuses to dashboard categories and stages         */
/* ------------------------------------------------------------------ */

/* ── Pre-Pipeline Categories ─────────────────────────────────────── */

export const NOT_CONTACTED_STATUSES = [
  "New Lead",
  "New Lead – Reapplied",
  "New Lead - Reapplied",
  "Attempting Contact",
  "Not Contacted",
  "Missed Appt - Rescheduling",
  "Missed Appt – Rescheduling",
  "No Response - Ghosted",
  "No Response – Ghosted",
] as const;

export const CONTACTED_STATUSES = [
  "First Call Appointment Scheduled",
  "Contacted - Gathering Application",
  "Contacted",
  "Pre-Application Sent",
  "Pre-Application Started",
  "Pre-Application Completed",
  "App Sent",
  "App Started",
  "App Completed",
  "Verification Docs Requested",
  "Verification Docs Received",
  "Pitch Appointment Scheduled",
  "Pitched - Follow Up",
  "Pitched & Waiting",
  "Pitched - Prep Package Out",
  "Pitched - Advance",
  "Pre-Qualified",
  "Pre-Approved",
  "Contract Received",
  "Package Out",
  "Package Back",
  "Package Signed Not Piped",
  "Piped",
  "Appraisal Ordered",
  "Appraisal Received",
  "Registered",
  "Processing",
  "Submitted to UW",
  "Approved with Conditions",
  "Conditions Submitted",
  "Incomplete (ReSubmission)",
  "Clear to Close",
  "Closed",
  "Funded",
  "Purchased",
  "Long Term Nurture",
  "Not Interested",
  "Did Not Advance",
  "Turndown",
  "VISIT",
  "VISIT-Bounced",
  "Denied - Credit Repair",
  "Denied - Down Payment",
  "Denied - Mortgage History",
  "Denied - No Benefit",
  "Denied - No Equity",
  "Denied - Income",
  "Denied - Other",
] as const;

export const BAD_LEAD_DNC_STATUSES = [
  "Bad Lead",
  "Bad Contact Info",
  "Do Not Call List",
  "Denied after Piped",
] as const;

export type PrePipelineCategory = "not_contacted" | "contacted" | "bad_lead_dnc";

const NOT_CONTACTED_SET = new Set<string>(NOT_CONTACTED_STATUSES);
const CONTACTED_SET = new Set<string>(CONTACTED_STATUSES);
const BAD_LEAD_DNC_SET = new Set<string>(BAD_LEAD_DNC_STATUSES);

export function categorizePrePipeline(statusRaw: string | null): PrePipelineCategory {
  if (!statusRaw) return "not_contacted";
  if (NOT_CONTACTED_SET.has(statusRaw)) return "not_contacted";
  if (BAD_LEAD_DNC_SET.has(statusRaw)) return "bad_lead_dnc";
  return "contacted";
}

export const PRE_PIPELINE_CATEGORIES = [
  { key: "not_contacted" as const, label: "Not Contacted", color: "#f59e0b" },
  { key: "contacted" as const, label: "Contacted", color: "#3b82f6" },
  { key: "bad_lead_dnc" as const, label: "Bad Lead / DNC", color: "#ef4444" },
] as const;

/* ── Command Center: Pitch Queue ─────────────────────────────────── */

export const PITCH_QUEUE_STATUSES = [
  "Pre-Application Completed",
  "App Completed",
  "Verification Docs Requested",
  "Verification Docs Received",
  "Pitch Appointment Scheduled",
  "Pitched - Follow Up",
  "Pitched & Waiting",
  "Pitched - Prep Package Out",
  "Pitched - Advance",
] as const;

export const PITCH_QUEUE_SET = new Set<string>(PITCH_QUEUE_STATUSES);

/* ── Command Center: Micro Stages ────────────────────────────────── */

export type MicroStageKey =
  | "verification"
  | "esign_out"
  | "processing"
  | "underwriting"
  | "approval"
  | "ctc"
  | "closed";

export const MICRO_STAGES: Array<{
  key: MicroStageKey;
  label: string;
  turnTime: string;
  subStatuses: readonly string[];
  instructions: string;
  nextAction: string;
}> = [
  {
    key: "verification",
    label: "Verification",
    turnTime: "Up to 48 hrs",
    subStatuses: [
      "Pre-Application Completed",
      "App Completed",
      "Verification Docs Requested",
      "Verification Docs Received",
      "Pitch Appointment Scheduled",
      "Pitched - Follow Up",
      "Pitched & Waiting",
      "Pre-Qualified",
      "Pre-Approved",
    ],
    instructions:
      "Review borrower's verification documents. Confirm income, assets, and identity. Ensure all required docs are collected before pitching.",
    nextAction: "Complete verification and send eSign package to borrower.",
  },
  {
    key: "esign_out",
    label: "eSign Out",
    turnTime: "3 hrs / 24 hrs",
    subStatuses: [
      "Pitched - Prep Package Out",
      "Pitched - Advance",
      "Contract Received",
      "Package Out",
      "Package Signed Not Piped",
    ],
    instructions:
      "eSign package has been sent. Follow up with borrower to sign within 3 hours if during business hours, 24 hours otherwise.",
    nextAction: "Confirm signed package received and move to Processing.",
  },
  {
    key: "processing",
    label: "Processing",
    turnTime: "LO: 48 hrs / Proc: 24 hrs",
    subStatuses: [
      "Package Back",
      "Piped",
      "Appraisal Ordered",
      "Appraisal Received",
      "Registered",
      "Processing",
    ],
    instructions:
      "Package is being processed. Ensure appraisal is ordered, all conditions are being gathered, and file is ready for submission.",
    nextAction: "Submit complete file to underwriting.",
  },
  {
    key: "underwriting",
    label: "Underwriting Que",
    turnTime: "Up to 72 hrs",
    subStatuses: ["Submitted to UW"],
    instructions:
      "File is in underwriter review. Monitor for any prior-to-doc conditions. Respond promptly to underwriter questions.",
    nextAction: "Await underwriter decision — approval, suspension, or denial.",
  },
  {
    key: "approval",
    label: "Approval",
    turnTime: "LO: 48 hrs / Proc: 24 hrs",
    subStatuses: [
      "Approved with Conditions",
      "Conditions Submitted",
      "Incomplete (ReSubmission)",
    ],
    instructions:
      "Loan is approved with conditions. Clear all outstanding conditions with borrower and submit back to UW for final sign-off.",
    nextAction: "Get all conditions cleared and obtain Clear to Close.",
  },
  {
    key: "ctc",
    label: "CTC",
    turnTime: "Pre-CD: 4 hrs / LO: 1 hr",
    subStatuses: ["Clear to Close"],
    instructions:
      "Clear to Close received. Send pre-closing disclosure, schedule closing, and confirm wire instructions with title company.",
    nextAction: "Schedule and confirm closing date with all parties.",
  },
  {
    key: "closed",
    label: "Closed",
    turnTime: "—",
    subStatuses: ["Closed", "Funded", "Purchased"],
    instructions: "Loan has closed or funded. Ensure all post-closing docs are received.",
    nextAction: "Confirm funding and send congratulations to borrower.",
  },
];

const statusToMicro = new Map<string, MicroStageKey>();
const statusToMicroLower = new Map<string, MicroStageKey>();
for (const stage of MICRO_STAGES) {
  for (const s of stage.subStatuses) {
    statusToMicro.set(s, stage.key);
    statusToMicroLower.set(s.trim().toLowerCase(), stage.key);
  }
}

export function getMicroStage(statusRaw: string | null): MicroStageKey | null {
  if (!statusRaw) return null;
  const t = statusRaw.trim();
  return statusToMicro.get(t) ?? statusToMicroLower.get(t.toLowerCase()) ?? null;
}

/**
 * Maps DB `current_stage` (loan_pipeline_stage) → Command Center micro bucket.
 * Used when `status_raw` is from LendingPad (or missing) and does not match Shape strings.
 */
const PIPELINE_STAGE_TO_MICRO: Partial<Record<string, MicroStageKey>> = {
  application: "verification",
  verification: "verification",
  esign_out: "esign_out",
  registered: "processing",
  processing: "processing",
  submission: "underwriting",
  underwriting: "underwriting",
  conditions: "approval",
  approval_conditions: "approval",
  clear_to_close: "ctc",
  closing: "closed",
  funded: "closed",
};

export function getPipelineMicroStage(
  statusRaw: string | null,
  currentStage: string | null,
): MicroStageKey | null {
  const fromShape = getMicroStage(statusRaw);
  if (fromShape) return fromShape;
  if (!currentStage) return null;
  return PIPELINE_STAGE_TO_MICRO[currentStage] ?? null;
}

/* ── Command Center: Macro Stages ────────────────────────────────── */

export type MacroStageKey = "verification_macro" | "validation" | "final_approval" | "closing_macro";

export const MACRO_STAGES: Array<{
  key: MacroStageKey;
  label: string;
  microKeys: MicroStageKey[];
}> = [
  { key: "verification_macro", label: "VERIFICATION", microKeys: ["verification", "esign_out"] },
  { key: "validation", label: "VALIDATION", microKeys: ["processing", "underwriting"] },
  { key: "final_approval", label: "FINAL APPROVAL", microKeys: ["approval"] },
  { key: "closing_macro", label: "CLOSING", microKeys: ["ctc"] },
];

/* ── All pipeline statuses (used to determine CC vs Pre-Pipeline) ── */

const ALL_CC_STATUSES = new Set<string>();
const ALL_CC_STATUSES_LOWER = new Set<string>();
for (const stage of MICRO_STAGES) {
  for (const s of stage.subStatuses) {
    ALL_CC_STATUSES.add(s);
    ALL_CC_STATUSES_LOWER.add(s.trim().toLowerCase());
  }
}

/** Shape-only: true when status_raw is a known Questrock Command Center status string. */
export function isCommandCenterStatus(statusRaw: string | null): boolean {
  if (!statusRaw) return false;
  const t = statusRaw.trim();
  return ALL_CC_STATUSES.has(t) || ALL_CC_STATUSES_LOWER.has(t.toLowerCase());
}

/** Includes LP (and other) loans whose `current_stage` maps into the Command Center micro pipeline. */
export function isCommandCenterPipelineStatus(
  statusRaw: string | null,
  currentStage: string | null,
): boolean {
  return getPipelineMicroStage(statusRaw, currentStage) != null;
}

/** Loans that are closed/funded for pre-pipeline exclusion (LP often uses different casing). */
export function isTerminalRetailStatus(statusRaw: string | null, currentStage: string | null): boolean {
  if (currentStage === "funded") return true;
  const s = (statusRaw ?? "").trim().toLowerCase();
  if (!s) return false;
  return s === "funded" || s === "purchased" || s === "closed";
}

/* ── Document Checklists ─────────────────────────────────────────── */

export const DOC_CHECKLISTS: Record<string, { title: string; items: string[] }> = {
  verification: {
    title: "Verification Documents",
    items: [
      "Government-issued photo ID (front & back)",
      "Last 2 years W-2s",
      "Last 2 years federal tax returns (all pages)",
      "Last 30 days pay stubs",
      "Last 2 months bank statements (all pages)",
      "Last quarterly retirement/investment statements",
      "Social Security card or ITIN letter",
      "Divorce decree / child support order (if applicable)",
      "Gift letter + donor bank statements (if applicable)",
      "Landlord contact info or 12 months cancelled rent checks",
      "Business tax returns + P&L (if self-employed)",
    ],
  },
  esign_out: {
    title: "Submission Documents",
    items: [
      "Signed initial loan application (1003)",
      "Signed disclosures package",
      "Authorization to pull credit",
      "4506-C signed (IRS transcript request)",
      "Borrower authorization letter",
      "Anti-steering disclosure",
      "eConsent agreement",
      "State-specific disclosures",
      "Hazard insurance binder",
      "Title commitment / preliminary title report",
      "Purchase contract (if purchase)",
      "Appraisal order confirmation",
    ],
  },
};

/* ── Leaderboard exclusions ──────────────────────────────────────── */

// Owners/executives are excluded from the LO leaderboard since they don't
// work a standard pipeline. Branch Builders (Bastian, Tashawna) and
// managers (Jason) ARE included since they originate loans.
export const LEADERBOARD_EXCLUDED_NAMES = ["nikk", "ray", "bill"];

export function isExcludedFromLeaderboard(fullName: string | null): boolean {
  if (!fullName) return true;
  const lower = fullName.toLowerCase();
  return LEADERBOARD_EXCLUDED_NAMES.some((n) => lower.includes(n));
}
