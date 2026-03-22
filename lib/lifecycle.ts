/**
 * QuestRock loan lifecycle (PDF): Verification → Validation → Close → Fund.
 * Validation Launch = signed package + appraisal payment (see DB validation_launched_at).
 */

export type LifecyclePhase = "verification" | "validation" | "close" | "fund";

export type LifecycleLoanInput = {
  current_stage: string | null | undefined;
  validation_launched_at: string | null | undefined;
};

export function computeLifecyclePhase(loan: LifecycleLoanInput): LifecyclePhase {
  const stage = (loan.current_stage ?? "").trim();
  if (stage === "funded") return "fund";
  if (stage === "clear_to_close" || stage === "closing") return "close";
  if (loan.validation_launched_at) return "validation";
  return "verification";
}

export const LIFECYCLE_PHASE_LABEL: Record<LifecyclePhase, string> = {
  verification: "Verification",
  validation: "Validation",
  close: "Close",
  fund: "Funded",
};
