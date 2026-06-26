import { differenceInDays, differenceInHours, parseISO } from "date-fns";
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

export type VerificationTrack = "Verification A" | "Verification B";

export type SlaStatus = "OK" | "CAUTION" | "ALERT";

export type ClassifiedLead = LoDashboardLoanRow & {
  displayStatus: string;
  hotTouchpointLabel: string | null;
  leadPhase: TurntimePhaseKey;
  verificationTrack: VerificationTrack;
  contactAttempts: number;
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

const GREEN_STATUSES = new Set(["App Sent", "App Started", "App Completed", "Advanced"]);

const CLOSED_FAMILY = new Set(["Closed", "Funded", "Purchased"]);

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

export function getVerificationTrack(row: Pick<LoDashboardLoanRow, "track" | "documentation_type" | "loan_type">): VerificationTrack {
  const doc = row.documentation_type?.toLowerCase() ?? "";
  const loanType = row.loan_type ?? "";
  if (row.track === "slow") return "Verification B";
  if (SLOW_DOC_HINTS.some((hint) => doc.includes(hint))) return "Verification B";
  if (["Construction", "Fix & Flip", "Rehab", "DSCR"].includes(loanType)) return "Verification B";
  return "Verification A";
}

export function inferLeadPhase(row: LoDashboardLoanRow): TurntimePhaseKey {
  const status = normalizeStatus(row.status_raw);
  if (!status) return "verificationA";
  if (GREEN_STATUSES.has(status) || status.includes("App")) return "packageOutA";
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
  for (let years = 2; years <= 10; years += 1) {
    windows.push({ label: `${years} year touchpoint`, target: years * 365, tolerance: 21 });
  }

  for (const window of windows) {
    if (Math.abs(daysSince - window.target) <= window.tolerance) return window.label;
  }
  return null;
}

export function isHotLead(row: LoDashboardLoanRow, now = new Date()): boolean {
  const status = normalizeStatus(row.status_raw);
  if (status === "New Lead") return true;
  return getHotTouchpointLabel(row, now) !== null;
}

export function isGreenLead(row: LoDashboardLoanRow): boolean {
  const status = normalizeStatus(row.status_raw);
  return status != null && GREEN_STATUSES.has(status);
}

export function isUncontactedLead(row: LoDashboardLoanRow): boolean {
  return contactAttemptsFor(row) === 0;
}

export function isLeadWorkspaceRow(row: LoDashboardLoanRow, now = new Date()): boolean {
  const rt = normalizeRecordType(row.record_type);
  if (rt === "Leads" || rt === "Applications") return true;
  if (isHotLead(row, now) || isGreenLead(row) || isUncontactedLead(row)) return true;
  // Shape CRM file without an active LP pipeline row — still a lead for the LO.
  if (row.shape_record_id && !isLoanWorkspaceRow(row)) return true;
  return false;
}

export function isLoanWorkspaceRow(row: LoDashboardLoanRow): boolean {
  if (row.lendingpad_loan_uuid) {
    const status = normalizeStatus(row.status_raw) ?? normalizeStatus(row.lendingpad_status_raw);
    if (status && TERMINAL_PIPELINE_STATUSES.has(status)) return false;
    return true;
  }
  const rt = row.record_type?.trim();
  if (rt !== "Loans") return false;
  const status = normalizeStatus(row.status_raw) ?? normalizeStatus(row.lendingpad_status_raw);
  if (status && TERMINAL_PIPELINE_STATUSES.has(status)) return false;
  return true;
}

function toClassifiedLead(row: LoDashboardLoanRow, now: Date): ClassifiedLead {
  return {
    ...row,
    displayStatus: displayLeadStatus(row.status_raw),
    hotTouchpointLabel: getHotTouchpointLabel(row, now),
    leadPhase: inferLeadPhase(row),
    verificationTrack: getVerificationTrack(row),
    contactAttempts: contactAttemptsFor(row),
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

function packageOutKey(row: LoDashboardLoanRow): "packageOutA" | "packageOutB" {
  return row.is_brokered ? "packageOutB" : "packageOutA";
}

function verificationKey(row: LoDashboardLoanRow): "verificationA" | "verificationB" {
  return getVerificationTrack(row) === "Verification B" ? "verificationB" : "verificationA";
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
  const applicable = milestonesForVerificationTrack(getVerificationTrack(row)).map((m) => m.key);

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

    const milestone = milestonesForVerificationTrack(getVerificationTrack(row)).find((m) => m.key === key);
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
  if (getVerificationTrack(row) === "Verification A") progress.verificationB = "open";
  if (getVerificationTrack(row) === "Verification B") progress.verificationA = "open";

  return progress;
}

export function computeLoanSLA(row: LoDashboardLoanRow, now = new Date()): { sla: SlaStatus; turntimeLabel: string } {
  const active = activeMilestoneKey(row);
  const milestone = milestonesForVerificationTrack(getVerificationTrack(row)).find((m) => m.key === active);
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

function nextActionFor(row: LoDashboardLoanRow): string {
  const status = normalizeStatus(row.status_raw) ?? normalizeStatus(row.lendingpad_status_raw);
  const { turntimeLabel } = computeLoanSLA(row);
  if (status?.includes("Underwriting") || status?.includes("UW")) {
    return `Escalate underwriting review — ${turntimeLabel.toLowerCase()}.`;
  }
  if (status?.includes("Clear to Close")) {
    return "Confirm final cash to close and signing time.";
  }
  if (status?.includes("Processing") || status?.includes("Validation")) {
    return "Collect outstanding conditions and update borrower.";
  }
  return `Advance ${milestoneLabelFor(row).toLowerCase()} — ${turntimeLabel.toLowerCase()}.`;
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
