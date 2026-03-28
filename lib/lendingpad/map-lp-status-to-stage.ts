/**
 * Map LendingPad loanStatus.name (Web API guide + LOS UI) → public.loan_pipeline_stage.
 * Keys are normalized: trim, collapse whitespace, ASCII lowercase.
 */
type Stage =
  | "lead"
  | "application"
  | "verification"
  | "esign_out"
  | "registered"
  | "processing"
  | "submission"
  | "underwriting"
  | "conditions"
  | "approval_conditions"
  | "clear_to_close"
  | "closing"
  | "funded";

const NORMALIZE = (s: string) =>
  s
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[\u2013\u2014]/g, "-")
    .toLowerCase();

/** LP loanStatus.name (and close variants) → dashboard stage */
const LP_STATUS_TO_STAGE: Record<string, Stage> = {
  // Early pipeline (guide + screenshots)
  lead: "lead",
  prospect: "lead",
  "pre qualify": "application",
  "pre-qualify": "application",
  "pre approval": "application",
  "pre-approval": "application",
  "application taken": "application",
  processing: "processing",
  registered: "registered",
  "initial submission": "submission",
  "broker initial submission": "submission",
  approved: "underwriting",
  "approved with conditions": "approval_conditions",
  suspended: "underwriting",
  "pre deny": "underwriting",
  "condition submission": "conditions",
  "conditions submitted": "conditions",
  "broker condition submission": "conditions",
  "incomplete (resubmission)": "approval_conditions",
  incomplete: "approval_conditions",
  rescinded: "conditions",
  "clear to close": "clear_to_close",
  cleartoclose: "clear_to_close",
  closed: "closing",
  funded: "funded",
  purchased: "funded",
  "in shipping": "closing",
  "post closing": "funded",
  servicing: "funded",
  // Shape-aligned UW labels when LP echoes them
  "submitted to uw": "underwriting",
};

export function mapLendingPadStatusToStage(statusRaw: string | null | undefined): Stage | null {
  if (!statusRaw?.trim()) return null;
  const key = NORMALIZE(statusRaw);
  return LP_STATUS_TO_STAGE[key] ?? null;
}
