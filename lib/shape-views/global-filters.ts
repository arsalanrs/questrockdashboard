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

export function passesGlobalFilters(row: ShapeLoanRow): boolean {
  const source = row.source?.trim();
  if (source && EXCLUDED_SOURCES.has(source)) return false;

  const rt = row.record_type?.trim();
  if (rt && EXCLUDED_RECORD_TYPES.has(rt)) return false;

  return true;
}
