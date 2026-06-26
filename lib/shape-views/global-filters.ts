import type { ShapeLoanRow } from "./types";

/** Nikk global source exclusions — also enforced in Shape sync. */
export const EXCLUDED_SOURCES = new Set([
  "zWebLead - VISIT",
  "zWebLead - Visit",
  "zCRM Import",
  "Test Lead",
  "Inbound Shape Call",
]);

export const EXCLUDED_RECORD_TYPES = new Set([
  "Referral Partner",
  "Referral Partners",
  "Contact",
]);

function isQuestMailSource(source: string | null | undefined): boolean {
  if (!source) return false;
  const s = source.trim().toLowerCase();
  return s.includes("questmail") || s.includes("quest mail");
}

/** Concierge desk / VA pool — not shown on LO command center. */
export function isConciergeLoName(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = name.trim().toLowerCase().replace(/\s+/g, " ");
  return n === "concierge" || n === "concierge desk" || n.startsWith("concierge ");
}

/** QuestMail routed to concierge — hidden from dashboard views. */
export function isConciergeQuestMailRow(row: {
  source?: string | null;
  assigned_loan_officer_name?: string | null;
}): boolean {
  return isQuestMailSource(row.source) && isConciergeLoName(row.assigned_loan_officer_name);
}

/** Demo / test leads — exclude from dashboard views. */
export function isSampleRecord(row: {
  borrower_first_name?: string | null;
  borrower_last_name?: string | null;
  source?: string | null;
}): boolean {
  const parts = [row.borrower_first_name, row.borrower_last_name, row.source]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return parts.includes("sample");
}

export function passesGlobalFilters(row: ShapeLoanRow): boolean {
  const source = row.source?.trim();
  if (source && EXCLUDED_SOURCES.has(source)) return false;

  const rt = row.record_type?.trim();
  if (rt && EXCLUDED_RECORD_TYPES.has(rt)) return false;

  if (isSampleRecord(row)) return false;
  if (isConciergeQuestMailRow(row)) return false;

  return true;
}
