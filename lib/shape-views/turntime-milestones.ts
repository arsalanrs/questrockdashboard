export type TurntimePhaseKey =
  | "verificationA"
  | "verificationB"
  | "packageOutA"
  | "packageOutB"
  | "validation"
  | "underwriting"
  | "ctc";

export type MilestoneProgressState = "complete" | "in-progress" | "stalled" | "open";

export type TurntimeMilestone = {
  key: TurntimePhaseKey;
  title: string;
  detail: string;
  time: string;
  /** SLA ceiling in hours for active milestone alerts. */
  slaHours: number;
};

export const TURNTIME_MILESTONES: readonly TurntimeMilestone[] = [
  {
    key: "verificationA",
    title: "Verification A",
    detail: "Bank Statement, Full Doc, DSCR",
    time: "2-72 hours",
    slaHours: 72,
  },
  {
    key: "verificationB",
    title: "Verification B",
    detail: "Extended verification",
    time: "72-120 hours",
    slaHours: 120,
  },
  {
    key: "packageOutA",
    title: "Package Out A",
    detail: "In House",
    time: "30 minutes - 4 hours",
    slaHours: 4,
  },
  {
    key: "packageOutB",
    title: "Package Out B",
    detail: "Brokered",
    time: "Up to 24 hours",
    slaHours: 24,
  },
  {
    key: "validation",
    title: "Validation",
    detail: "File validation",
    time: "48 hours",
    slaHours: 48,
  },
  {
    key: "underwriting",
    title: "Underwriting",
    detail: "Credit decision",
    time: "Up to 72 hours",
    slaHours: 72,
  },
  {
    key: "ctc",
    title: "CTC",
    detail: "Must be CTC 24 hours before closing",
    time: "24 hours",
    slaHours: 24,
  },
] as const;

export const NEUTRAL_MILESTONE_PROGRESS: Record<TurntimePhaseKey, MilestoneProgressState> = {
  verificationA: "open",
  verificationB: "open",
  packageOutA: "open",
  packageOutB: "open",
  validation: "open",
  underwriting: "open",
  ctc: "open",
};

export function milestonesForVerificationTrack(
  verificationTrack: "Verification A" | "Verification B" | "All",
): TurntimeMilestone[] {
  if (verificationTrack === "Verification A") {
    return TURNTIME_MILESTONES.filter((step) => step.key !== "verificationB");
  }
  if (verificationTrack === "Verification B") {
    return TURNTIME_MILESTONES.filter((step) => step.key !== "verificationA");
  }
  return [...TURNTIME_MILESTONES];
}

export function phaseLabel(phaseKey: TurntimePhaseKey | "all"): string {
  if (phaseKey === "all") return "All phases";
  return TURNTIME_MILESTONES.find((step) => step.key === phaseKey)?.title ?? "All phases";
}
