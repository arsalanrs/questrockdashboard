import { addDays, subDays, subHours } from "date-fns";

const FIRST_NAMES = [
  "Ava",
  "Olivia",
  "Sophia",
  "Isabella",
  "Mia",
  "Amelia",
  "Ethan",
  "Noah",
  "Liam",
  "Mason",
  "James",
  "Benjamin",
];

const LAST_NAMES = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez"];

const STATES = ["Georgia", "Florida", "Texas", "Tennessee", "North Carolina", "South Carolina", "Alabama", "Maryland"];

const CONDITION_TITLES = [
  "Updated bank statement (most recent)",
  "Explanation letter for large deposit",
  "Proof of earnest money",
  "Updated paystub",
  "Hazard insurance binder",
  "Signed letter of explanation (credit inquiry)",
  "Verification of employment",
  "Appraisal revision request",
];

export const PIPELINE: Array<
  "registered" | "processing" | "submission" | "underwriting" | "conditions" | "clear_to_close" | "closing" | "funded"
> = ["registered", "processing", "submission", "underwriting", "conditions", "clear_to_close", "closing", "funded"];

function pick<T>(arr: T[]) {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function int(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function makeBorrower() {
  return { first: pick(FIRST_NAMES), last: pick(LAST_NAMES) };
}

export function makeState() {
  return pick(STATES);
}

export function makeLoanAmountCents() {
  const dollars = int(150_000, 1_500_000);
  return dollars * 100;
}

export function makeStageEvents(now: Date, currentStage: (typeof PIPELINE)[number]) {
  const stageIdx = Math.max(0, PIPELINE.indexOf(currentStage));

  // Start the timeline somewhere in the past; later stages tend to imply older files.
  let cursor = subDays(now, int(3 + stageIdx * 2, 10 + stageIdx * 6));
  const events: Array<{ stage: (typeof PIPELINE)[number]; entered_at: string }> = [];

  for (let i = 0; i <= stageIdx; i++) {
    const stage = PIPELINE[i]!;
    cursor = subHours(cursor, int(1, 10));
    events.push({ stage, entered_at: cursor.toISOString() });
    cursor = addDays(cursor, int(0, 4));
  }

  return events;
}

export function makeClosingDate(now: Date, currentStage: (typeof PIPELINE)[number]) {
  if (currentStage === "funded") return subDays(now, int(0, 20)).toISOString().slice(0, 10);
  if (currentStage === "closing") return addDays(now, int(0, 7)).toISOString().slice(0, 10);
  if (currentStage === "clear_to_close") return addDays(now, int(1, 10)).toISOString().slice(0, 10);
  if (currentStage === "conditions" || currentStage === "underwriting") return addDays(now, int(7, 25)).toISOString().slice(0, 10);
  return addDays(now, int(10, 45)).toISOString().slice(0, 10);
}

export function makeConditions(currentStage: (typeof PIPELINE)[number]) {
  const shouldHaveOpen =
    currentStage === "underwriting" || currentStage === "conditions" || currentStage === "submission" || currentStage === "processing";
  const count = shouldHaveOpen ? int(0, 5) : 0;
  const titles = new Set<string>();
  while (titles.size < count) titles.add(pick(CONDITION_TITLES));
  return [...titles].map((title) => ({ title, status: "open" as const }));
}

