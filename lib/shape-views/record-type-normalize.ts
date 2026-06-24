/** Canonical Shape record types used in view rules. */
export type CanonicalRecordType = "Leads" | "Applications" | "Loans";

const RECORD_TYPE_ALIASES: Record<string, CanonicalRecordType> = {
  Lead: "Leads",
  Leads: "Leads",
  Application: "Applications",
  Applications: "Applications",
  Loan: "Loans",
  Loans: "Loans",
};

export function normalizeRecordType(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  return RECORD_TYPE_ALIASES[s] ?? s;
}

export function recordTypeMatches(
  raw: string | null | undefined,
  allowed: CanonicalRecordType[] | "all",
): boolean {
  if (allowed === "all") return true;
  const norm = normalizeRecordType(raw);
  if (!norm) return false;
  return allowed.includes(norm as CanonicalRecordType);
}

/** Pre-app / POS statuses for Nikk's All Pre-Applications view. */
export const PRE_APPLICATION_STATUSES = [
  "App Sent",
  "App Started",
  "App Completed",
  "Portal Registration Complete",
  "Verification Docs Requested",
  "Verification Docs Received",
  "Pre-Application Sent",
  "Pre-Application Started",
  "Pre-Application Completed",
  "Pre Approval",
  "Pre-Qualified",
  "Pre-Approved",
  "Application Taken",
] as const;

export function isPreApplicationStatus(statusRaw: string | null | undefined, portalRaw?: string | null): boolean {
  const statuses = [statusRaw, portalRaw].filter(Boolean) as string[];
  for (const s of statuses) {
    if (PRE_APPLICATION_STATUSES.includes(s as (typeof PRE_APPLICATION_STATUSES)[number])) return true;
    if (/^app (sent|started|completed)$/i.test(s)) return true;
    if (/pre[- ]?application/i.test(s)) return true;
  }
  return false;
}
