import { differenceInDays, differenceInHours, differenceInMinutes, parseISO } from "date-fns";
import { normalizeStatus } from "./status-normalize";
import { normalizeRecordType } from "./record-type-normalize";
import {
  milestonesForVerificationTrack,
  NEUTRAL_MILESTONE_PROGRESS,
  phaseLabel,
  type MilestoneProgressState,
  type TurntimePhaseKey,
} from "./turntime-milestones";
import type { ShapeLoanRow } from "./types";

export type { TurntimePhaseKey, MilestoneProgressState };
export { phaseLabel, milestonesForVerificationTrack, NEUTRAL_MILESTONE_PROGRESS };

export type LoDashboardLoanRow = ShapeLoanRow & {
  loan_type: string | null;
  loan_purpose: string | null;
  property_state: string | null;
  mailing_state: string | null;
  track: string | null;
  documentation_type: string | null;
  is_brokered: boolean | null;
  notes_sidebar: string | null;
  notes_sidebar_ai_note: string | null;
  recent_notes: string | null;
  game_plan_notes: string | null;
  initial_contact_attempted: boolean | null;
  credit_report_requested_at: string | null;
  verification_started_at: string | null;
  verification_completed_at: string | null;
  submitted_to_processing_at: string | null;
  processing_completed_at: string | null;
  submitted_to_uw_at: string | null;
  uw_decision_at: string | null;
  ctc_at: string | null;
  closing_date: string | null;
  lock_expiration_date: string | null;
  finance_contingency_date: string | null;
  appraisal_contingency_date: string | null;
  credit_score_mid: number | null;
};

export type VerificationTrack = "Verification A" | "Verification B" | "Pending";

export type SlaStatus = "OK" | "CAUTION" | "ALERT";

export type ClassifiedLead = LoDashboardLoanRow & {
  displayStatus: string;
  hotTouchpointLabel: string | null;
  leadPhase: TurntimePhaseKey;
  leadPhaseLabel: string;
  verificationTrack: VerificationTrack;
  contactAttempts: number;
  leadSla: SlaStatus | null;
};

export type PipelineLoanRow = LoDashboardLoanRow & {
  sla: SlaStatus;
  turntimeLabel: string;
  milestoneLabel: string;
  verificationTrack: VerificationTrack;
  progress: Record<TurntimePhaseKey, MilestoneProgressState>;
  lockDaysLabel: string;
  nextAction: string;
  notesPreview: string;
};

const GREEN_STATUSES = new Set(["App Completed", "Advanced"]);

const CLOSED_FAMILY = new Set(["Closed", "Funded", "Purchased"]);

/** Shape CRM statuses that are pre-pipeline (not yet Application Taken). */
const PRE_APP_LEAD_STATUSES = new Set([
  "New Lead",
  "Not Contacted",
  "Attempting Contact",
  "Contacted",
  "App Sent",
  "App Started",
]);

/** LP list statuses before Application Taken when no pipeline dates exist. */
const PRE_APP_LP_STATUSES = new Set(["Lead", "Prospect", "Pre-Approved", "Pre Approval", "Pre Qualify"]);

const VERIFICATION_B_LOAN_TYPES = new Set([
  "Commercial",
  "Construction",
  "Fix & Flip",
  "Rehab",
  "DSCR",
  "Hard Money",
  "Ground Up",
  "Ground Up Construction",
]);

const TERMINAL_PIPELINE_STATUSES = new Set([
  "Closed",
  "Funded",
  "Purchased",
  "Denied - Credit Repair",
  "Denied - Down Payment",
  "Denied - Mortgage History",
  "Denied - No Benefit",
  "Denied - No Equity",
  "Denied - Income",
  "Denied - Other",
  "Turndown",
  "Not Interested",
  "Did Not Advance",
  "Bad Lead",
]);

const SLOW_DOC_HINTS = ["bank statement", "full doc", "dscr", "asset", "1099"];

function parseTs(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = parseISO(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function borrowerDisplayName(row: Pick<LoDashboardLoanRow, "borrower_first_name" | "borrower_last_name">): string {
  return [row.borrower_first_name, row.borrower_last_name].filter(Boolean).join(" ") || "—";
}

export function displayLeadStatus(statusRaw: string | null): string {
  const normalized = normalizeStatus(statusRaw);
  if (!normalized) return "—";
  if (CLOSED_FAMILY.has(normalized)) return "Closed";
  return normalized;
}

export function getVerificationTrack(
  row: Pick<LoDashboardLoanRow, "track" | "documentation_type" | "loan_type" | "status_raw" | "verification_started_at" | "verification_completed_at">,
): VerificationTrack {
  if (!hasEnteredVerification(row)) return "Pending";

  const doc = row.documentation_type?.toLowerCase() ?? "";
  const loanType = row.loan_type ?? "";
  if (row.track === "slow") return "Verification B";
  if (SLOW_DOC_HINTS.some((hint) => doc.includes(hint))) return "Verification B";
  if (VERIFICATION_B_LOAN_TYPES.has(loanType)) return "Verification B";
  if (["Construction", "Fix & Flip", "Rehab", "DSCR"].includes(loanType)) return "Verification B";
  return "Verification A";
}

function hasEnteredVerification(
  row: Pick<LoDashboardLoanRow, "status_raw" | "verification_started_at" | "verification_completed_at">,
): boolean {
  if (row.verification_started_at || row.verification_completed_at) return true;
  const status = normalizeStatus(row.status_raw);
  if (!status) return false;
  return status.includes("Verification") || status.includes("Package") || status.includes("Validation");
}

export function leadPhaseLabelFor(row: LoDashboardLoanRow): string {
  const status = normalizeStatus(row.status_raw);
  if (status === "New Lead" || status === "Not Contacted" || status === "Attempting Contact") {
    return "New Lead";
  }
  if (status && GREEN_STATUSES.has(status)) return status;
  return phaseLabel(inferLeadPhase(row));
}

export function inferLeadPhase(row: LoDashboardLoanRow): TurntimePhaseKey {
  const status = normalizeStatus(row.status_raw);
  if (!status || status === "New Lead" || status === "Not Contacted" || status === "Attempting Contact") {
    return "verificationA";
  }
  if (GREEN_STATUSES.has(status)) return "packageOutA";
  if (status.includes("Verification")) return getVerificationTrack(row) === "Verification B" ? "verificationB" : "verificationA";
  if (status.includes("Package")) return row.is_brokered ? "packageOutB" : "packageOutA";
  if (status.includes("Validation") || status.includes("Processing")) return "validation";
  if (status.includes("UW") || status.includes("Underwriting")) return "underwriting";
  if (status.includes("Clear to Close") || status === "CTC") return "ctc";
  if (CLOSED_FAMILY.has(status)) return "ctc";
  return "verificationA";
}

function contactAttemptsFor(row: LoDashboardLoanRow): number {
  if (row.last_contacted_at) return 1;
  if (row.initial_contact_attempted) return 1;
  return 0;
}

export function getHotTouchpointLabel(row: LoDashboardLoanRow, now = new Date()): string | null {
  const status = normalizeStatus(row.status_raw);
  if (!status || !CLOSED_FAMILY.has(status)) return null;

  const anchor =
    parseTs(row.funded_at) ??
    parseTs(row.closed_at) ??
    parseTs(row.last_status_change_at);
  if (!anchor) return null;

  const daysSince = differenceInDays(now, anchor);
  const windows: Array<{ label: string; target: number; tolerance: number }> = [
    { label: "6 month touchpoint", target: 182, tolerance: 21 },
    { label: "1 year touchpoint", target: 365, tolerance: 21 },
  ];

  for (const window of windows) {
    if (Math.abs(daysSince - window.target) <= window.tolerance) return window.label;
  }
  return null;
}

export function isShapeCrmFile(row: LoDashboardLoanRow): boolean {
  const rt = normalizeRecordType(row.record_type);
  if (rt === "Leads" || rt === "Applications") return true;
  return Boolean(row.shape_record_id) && !isActiveLpPipeline(row);
}

export function isActiveLpPipeline(row: LoDashboardLoanRow): boolean {
  if (!row.lendingpad_loan_uuid) return false;
  return isPipelineEligible(row);
}

function isTerminalPipelineStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return TERMINAL_PIPELINE_STATUSES.has(status);
}

export function isPipelineEligible(row: LoDashboardLoanRow): boolean {
  const status = normalizeStatus(row.lendingpad_status_raw) ?? normalizeStatus(row.status_raw);

  if (isTerminalPipelineStatus(status)) return false;

  if (row.lendingpad_loan_uuid) {
    const hasPipelineActivity =
      Boolean(row.conversion_date) ||
      Boolean(row.application_completed_at) ||
      Boolean(row.submitted_to_processing_at) ||
      Boolean(row.processing_completed_at) ||
      Boolean(row.verification_started_at) ||
      Boolean(row.submitted_to_uw_at);

    if (status && PRE_APP_LP_STATUSES.has(status) && !hasPipelineActivity) return false;
    if (status && PRE_APP_LEAD_STATUSES.has(status) && !hasPipelineActivity) return false;

    return true;
  }

  const rt = normalizeRecordType(row.record_type);
  if (rt !== "Loans") return false;
  if (status && PRE_APP_LEAD_STATUSES.has(status)) return false;

  return true;
}

export function isHotLead(row: LoDashboardLoanRow, now = new Date()): boolean {
  const status = normalizeStatus(row.status_raw);
  const lpStatus = normalizeStatus(row.lendingpad_status_raw);

  if (status === "New Lead" && isShapeCrmFile(row) && !isActiveLpPipeline(row)) return true;

  const closedStatus = lpStatus ?? status;
  if (closedStatus && CLOSED_FAMILY.has(closedStatus)) {
    return getHotTouchpointLabel(row, now) !== null;
  }
  return false;
}

export function isGreenLead(row: LoDashboardLoanRow): boolean {
  if (!isShapeCrmFile(row) || isActiveLpPipeline(row)) return false;
  const status = normalizeStatus(row.status_raw);
  return status != null && GREEN_STATUSES.has(status);
}

export function isUncontactedLead(row: LoDashboardLoanRow): boolean {
  if (!isShapeCrmFile(row)) return false;
  return normalizeStatus(row.status_raw) === "Not Contacted";
}

export function computeLeadSLA(row: LoDashboardLoanRow, now = new Date()): SlaStatus | null {
  if (normalizeStatus(row.status_raw) !== "New Lead") return null;
  if (row.last_contacted_at || row.initial_contact_attempted) return null;

  const created = parseTs(row.lead_created_at);
  if (!created) return null;

  const minutes = differenceInMinutes(now, created);
  if (minutes > 5) return "ALERT";
  if (minutes >= 4) return "CAUTION";
  return "OK";
}

export function isLeadWorkspaceRow(row: LoDashboardLoanRow, now = new Date()): boolean {
  if (isHotLead(row, now) || isGreenLead(row) || isUncontactedLead(row)) return true;
  if (isShapeCrmFile(row) && !isLoanWorkspaceRow(row)) return true;
  return false;
}

export function isLoanWorkspaceRow(row: LoDashboardLoanRow): boolean {
  return isPipelineEligible(row);
}

function toClassifiedLead(row: LoDashboardLoanRow, now: Date): ClassifiedLead {
  return {
    ...row,
    displayStatus: displayLeadStatus(row.status_raw),
    hotTouchpointLabel: getHotTouchpointLabel(row, now),
    leadPhase: inferLeadPhase(row),
    leadPhaseLabel: leadPhaseLabelFor(row),
    verificationTrack: getVerificationTrack(row),
    contactAttempts: contactAttemptsFor(row),
    leadSla: computeLeadSLA(row, now),
  };
}

export function classifyLeads(rows: LoDashboardLoanRow[], now = new Date()) {
  const leadRows = rows.filter((row) => isLeadWorkspaceRow(row, now)).map((row) => toClassifiedLead(row, now));

  return {
    all: leadRows,
    hot: leadRows.filter((row) => isHotLead(row, now)),
    green: leadRows.filter((row) => isGreenLead(row)),
    uncontacted: leadRows.filter((row) => isUncontactedLead(row)),
  };
}

function milestoneTrackFor(row: LoDashboardLoanRow): "Verification A" | "Verification B" {
  const track = getVerificationTrack(row);
  return track === "Verification B" ? "Verification B" : "Verification A";
}

function packageOutKey(row: LoDashboardLoanRow): "packageOutA" | "packageOutB" {
  return row.is_brokered ? "packageOutB" : "packageOutA";
}

function verificationKey(row: LoDashboardLoanRow): "verificationA" | "verificationB" {
  const track = getVerificationTrack(row);
  return track === "Verification B" ? "verificationB" : "verificationA";
}

function activeMilestoneKey(row: LoDashboardLoanRow): TurntimePhaseKey {
  if (row.ctc_at) return "ctc";
  if (row.submitted_to_uw_at && !row.uw_decision_at) return "underwriting";
  if (row.processing_completed_at || row.submitted_to_processing_at) {
    if (row.verification_completed_at && !row.submitted_to_uw_at) return "validation";
    return packageOutKey(row);
  }
  if (row.verification_started_at && !row.verification_completed_at) return verificationKey(row);

  const stage = row.current_stage?.toLowerCase() ?? "";
  const status = normalizeStatus(row.status_raw) ?? normalizeStatus(row.lendingpad_status_raw) ?? "";

  if (status.includes("Clear to Close") || stage.includes("ctc")) return "ctc";
  if (status.includes("UW") || status.includes("Underwriting") || stage.includes("underwriting")) return "underwriting";
  if (status.includes("Validation") || status.includes("Processing") || stage.includes("validation")) return "validation";
  if (status.includes("Package") || stage.includes("package")) return packageOutKey(row);
  if (status.includes("Verification") || stage.includes("verification")) return verificationKey(row);

  return verificationKey(row);
}

function milestoneStartAt(row: LoDashboardLoanRow, key: TurntimePhaseKey): Date | null {
  switch (key) {
    case "verificationA":
    case "verificationB":
      return parseTs(row.verification_started_at) ?? parseTs(row.lead_created_at);
    case "packageOutA":
    case "packageOutB":
      return parseTs(row.verification_completed_at) ?? parseTs(row.submitted_to_processing_at);
    case "validation":
      return parseTs(row.submitted_to_processing_at) ?? parseTs(row.processing_completed_at);
    case "underwriting":
      return parseTs(row.submitted_to_uw_at);
    case "ctc":
      return parseTs(row.ctc_at) ?? parseTs(row.uw_decision_at);
    default:
      return null;
  }
}

function milestoneCompletedAt(row: LoDashboardLoanRow, key: TurntimePhaseKey): Date | null {
  switch (key) {
    case "verificationA":
    case "verificationB":
      return parseTs(row.verification_completed_at);
    case "packageOutA":
    case "packageOutB":
      return parseTs(row.submitted_to_processing_at);
    case "validation":
      return parseTs(row.processing_completed_at) ?? parseTs(row.submitted_to_uw_at);
    case "underwriting":
      return parseTs(row.uw_decision_at);
    case "ctc":
      return parseTs(row.closing_date) ?? parseTs(row.closed_at);
    default:
      return null;
  }
}

export function deriveMilestoneProgress(
  row: LoDashboardLoanRow,
  now = new Date(),
): Record<TurntimePhaseKey, MilestoneProgressState> {
  const progress: Record<TurntimePhaseKey, MilestoneProgressState> = { ...NEUTRAL_MILESTONE_PROGRESS };
  const active = activeMilestoneKey(row);
  const applicable = milestonesForVerificationTrack(milestoneTrackFor(row)).map((m) => m.key);

  for (const key of applicable) {
    const completed = milestoneCompletedAt(row, key);
    if (completed) {
      progress[key] = "complete";
      continue;
    }

    const started = milestoneStartAt(row, key);
    if (!started) {
      progress[key] = "open";
      continue;
    }

    const milestone = milestonesForVerificationTrack(milestoneTrackFor(row)).find((m) => m.key === key);
    const slaHours = milestone?.slaHours ?? 48;
    const hours = differenceInHours(now, started);

    if (key === active) {
      if (hours > slaHours) progress[key] = "stalled";
      else if (hours >= slaHours - 4) progress[key] = "stalled";
      else progress[key] = "in-progress";
    } else if (hours > slaHours) {
      progress[key] = "stalled";
    } else {
      progress[key] = "in-progress";
    }
  }

  // Hide non-applicable verification track
  const track = getVerificationTrack(row);
  if (track === "Verification A" || track === "Pending") progress.verificationB = "open";
  if (track === "Verification B") progress.verificationA = "open";

  return progress;
}

export function computeLoanSLA(row: LoDashboardLoanRow, now = new Date()): { sla: SlaStatus; turntimeLabel: string } {
  const active = activeMilestoneKey(row);
  const milestone = milestonesForVerificationTrack(milestoneTrackFor(row)).find((m) => m.key === active);
  const slaHours = milestone?.slaHours ?? 48;
  const started = milestoneStartAt(row, active);
  const completed = milestoneCompletedAt(row, active);

  if (completed) {
    return { sla: "OK", turntimeLabel: `${phaseLabel(active)} complete` };
  }

  if (!started) {
    return { sla: "OK", turntimeLabel: `Awaiting ${phaseLabel(active).toLowerCase()}` };
  }

  const hours = differenceInHours(now, started);
  const hoursLeft = slaHours - hours;

  if (hours > slaHours) {
    const overdue = hours - slaHours;
    return {
      sla: "ALERT",
      turntimeLabel: `${phaseLabel(active)} overdue by ${overdue}h`,
    };
  }

  if (hoursLeft <= 4) {
    return {
      sla: "CAUTION",
      turntimeLabel: `${phaseLabel(active)} due in ${Math.max(hoursLeft, 0)}h`,
    };
  }

  return {
    sla: "OK",
    turntimeLabel: `${phaseLabel(active)} due in ${hoursLeft}h`,
  };
}

function milestoneLabelFor(row: LoDashboardLoanRow): string {
  const active = activeMilestoneKey(row);
  return phaseLabel(active);
}

function lockDaysLabel(row: LoDashboardLoanRow, now = new Date()): string {
  const exp = parseTs(row.lock_expiration_date);
  if (!exp) return "Unlocked";
  const days = differenceInDays(exp, now);
  if (days < 0) return "Expired";
  return String(days);
}

function notesPreview(row: LoDashboardLoanRow): string {
  return row.game_plan_notes?.trim() || row.recent_notes?.trim() || row.notes_sidebar?.trim() || "—";
}

/** Strip HTML tags and collapse whitespace — Shape notes come back with <p> wrapping. */
function stripHtmlTags(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Returns true when the text looks like raw Shape form metadata rather than
 * a human note — e.g. POST body dumps, raw timestamps, field-value pairs.
 */
function isJunkNote(text: string): boolean {
  // Form POST metadata (Shape stores raw API payload in some note fields)
  if (/post_method\s*:/i.test(text)) return true;
  if (/sourcehdn\s*:/i.test(text)) return true;
  if (/crmrefld\s*:/i.test(text)) return true;
  if (/leadtype\s*:/i.test(text)) return true;
  if (/pageurl\s*:/i.test(text)) return true;
  if (/shapeportal/i.test(text)) return true;
  // Raw ISO timestamp dumps like "date: 2026-06-11T14:14:53.843Z investment_property: Y"
  if (/date:\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/i.test(text)) return true;
  if (/investment_property\s*:/i.test(text)) return true;
  if (/loan_type\s*:/i.test(text)) return true;
  if (/property_picked\s*:/i.test(text)) return true;
  // Shape internal IDs appended at the end (e.g. "PITCH SCHEDULED: Name 49317")
  if (/[A-Z\s]+:\s*\w[\w\s]+\d{4,6}\s*$/.test(text) && text.split(" ").length < 6) return true;
  return false;
}

/** Trim a clean note to a short readable snippet (≤ 130 chars). */
function trimNote(plain: string, maxLen = 130): string {
  const sentences = plain.match(/[^.!?\n]+[.!?]*/g) ?? [];
  const two = sentences.slice(0, 2).join(" ").trim();
  const result = two.length > 8 ? two : plain.trim();
  return result.length > maxLen ? result.slice(0, maxLen - 1) + "…" : result;
}

/** Pull the best human-readable next-action text from available note fields. */
function bestNextActionNote(row: LoDashboardLoanRow): string | null {
  // Priority 1: notes_sidebar_ai_note — only if it's a real note (not form junk)
  const aiRaw = row.notes_sidebar_ai_note?.trim();
  if (aiRaw) {
    const plain = stripHtmlTags(aiRaw);
    if (plain.length > 8 && !isJunkNote(plain)) {
      return trimNote(plain);
    }
  }

  // Priority 2: recent_notes (LO call notes, transcript summaries)
  const recentRaw = row.recent_notes?.trim();
  if (recentRaw) {
    const plain = stripHtmlTags(recentRaw);
    if (plain.length > 8 && !isJunkNote(plain)) {
      return trimNote(plain);
    }
  }

  // Priority 3: game_plan_notes
  const gameRaw = row.game_plan_notes?.trim();
  if (gameRaw) {
    const plain = stripHtmlTags(gameRaw);
    if (plain.length > 8 && !isJunkNote(plain)) {
      return trimNote(plain, 100);
    }
  }

  return null;
}

function nextActionFor(row: LoDashboardLoanRow): string {
  const note = bestNextActionNote(row);
  if (note) return note;

  const status = normalizeStatus(row.status_raw) ?? normalizeStatus(row.lendingpad_status_raw);
  const { turntimeLabel } = computeLoanSLA(row);

  if (status?.includes("Clear to Close") || status === "CTC") return "Confirm cash to close + signing time.";
  if (status?.includes("Underwriting") || status?.includes("UW")) return `Chase UW decision — ${turntimeLabel.toLowerCase()}.`;
  if (status?.includes("Processing") || status?.includes("Validation")) return "Clear outstanding conditions.";
  if (status?.includes("Package")) return "Submit package to processing.";
  return `${milestoneLabelFor(row)} — ${turntimeLabel.toLowerCase()}.`;
}

export function buildPipelineLoans(rows: LoDashboardLoanRow[], now = new Date()): PipelineLoanRow[] {
  return rows
    .filter(isLoanWorkspaceRow)
    .map((row) => {
      const { sla, turntimeLabel } = computeLoanSLA(row, now);
      return {
        ...row,
        sla,
        turntimeLabel,
        milestoneLabel: milestoneLabelFor(row),
        verificationTrack: getVerificationTrack(row),
        progress: deriveMilestoneProgress(row, now),
        lockDaysLabel: lockDaysLabel(row, now),
        nextAction: nextActionFor(row),
        notesPreview: notesPreview(row),
      };
    })
    .sort((a, b) => {
      const rank = { ALERT: 0, CAUTION: 1, OK: 2 };
      const bySla = rank[a.sla] - rank[b.sla];
      if (bySla !== 0) return bySla;
      return (b.loan_amount_cents ?? 0) - (a.loan_amount_cents ?? 0);
    });
}

export function formatShortDate(iso: string | null | undefined): string {
  const d = parseTs(iso ?? null);
  if (!d) return "—";
  return d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
}

export function formatMoney(cents: number | null | undefined): string {
  if (!cents) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function stateForRow(row: LoDashboardLoanRow): string {
  return row.property_state ?? row.mailing_state ?? "—";
}
