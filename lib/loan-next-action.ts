import { differenceInCalendarDays } from "date-fns";

export type RichLoanDataRow = {
  front_dti?: number | null;
  back_dti?: number | null;
  ltv_ratio_percent?: number | null;
  note_rate?: number | null;
  lock_expiration_at?: string | null;
  processing_checklist_json?: Record<string, {
    completed?: boolean;
    requestDate?: string;
    receivedDate?: string;
  }> | null;
};

export type ConditionRow = {
  status: "open" | "cleared";
  title?: string;
};

export type NextActionResult = {
  priority: number;
  text: string;
} | null;

export function deriveSmartNextAction(
  statusRaw: string | null,
  currentStage: string | null,
  rich: RichLoanDataRow | null,
  conditions: ConditionRow[],
  lockExpirationDate: string | null,
): NextActionResult {
  const openConditions = conditions.filter((c) => c.status === "open").length;
  const lockDate = rich?.lock_expiration_at ?? lockExpirationDate;
  const lockDays =
    lockDate ? differenceInCalendarDays(new Date(lockDate), new Date()) : null;

  if (lockDays !== null && lockDays <= 3) {
    return {
      priority: 1,
      text: `Rate lock expires in ${lockDays} day(s) — extend lock or confirm closing date`,
    };
  }

  if (openConditions > 0 && (currentStage === "conditions" || currentStage === "approval_conditions")) {
    return {
      priority: 1,
      text: `${openConditions} condition(s) outstanding — collect docs and resubmit to UW`,
    };
  }

  const appraisal = rich?.processing_checklist_json?.appraisal;
  if (appraisal?.requestDate && !appraisal.completed) {
    const age = differenceInCalendarDays(new Date(), new Date(appraisal.requestDate));
    if (age > 7) {
      return {
        priority: 2,
        text: `Appraisal ordered ${age} days ago — follow up with appraiser`,
      };
    }
  }

  const s = (statusRaw ?? "").toLowerCase();
  if (s.includes("not contacted") || s.includes("new lead") || s.includes("attempting")) {
    return { priority: 1, text: "Make initial contact call" };
  }
  if (s.includes("pitched") && s.includes("waiting")) {
    return { priority: 2, text: "Follow up on pitch decision" };
  }
  if (s.includes("package out") || s.includes("esign")) {
    return { priority: 2, text: "Chase signed package from borrower" };
  }
  if (currentStage === "clear_to_close") {
    return { priority: 2, text: "Schedule closing and confirm wire instructions" };
  }

  return null;
}
