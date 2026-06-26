import type { ShapeLoanRow } from "./types";
import { normalizeRecordType } from "./record-type-normalize";

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

export function passesGlobalFilters(row: ShapeLoanRow): boolean {
  const source = row.source?.trim();
  if (source && EXCLUDED_SOURCES.has(source)) return false;

  const rt = row.record_type?.trim();
  if (rt && EXCLUDED_RECORD_TYPES.has(rt)) return false;

  if (isSampleRecord(row)) return false;

  return true;
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
