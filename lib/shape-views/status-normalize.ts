/**
 * Normalize Shape status strings for view matching.
 * Nikk's saved views use prefixed labels like "Lead Status - App Sent";
 * bulk export often stores short strings like "App Sent".
 */

const STATUS_PREFIX_RE =
  /^(?:Lead\s+Status|POS\s+Status|Portal\s+Status|Shape\s+File\s+Status|LendingPad\s+Status)\s*[-–—]\s*/i;

/** Unicode en-dash / em-dash → ASCII hyphen for consistent matching. */
function dashNormalize(s: string): string {
  return s.replace(/[\u2013\u2014]/g, "-").replace(/\s+/g, " ").trim();
}

/** Known aliases: alternate spellings → canonical short status. */
const STATUS_ALIASES: Record<string, string> = {
  "New Lead – Reapplied": "New Lead - Reapplied",
  "Missed Appt – Rescheduling": "Missed Appt - Rescheduling",
  "No Response – Ghosted": "No Response - Ghosted",
  "Pitched and Waiting": "Pitched & Waiting",
  "Submitted to UW": "Submitted to UW",
  "Submitted To UW": "Submitted to UW",
  "Clear To Close": "Clear to Close",
  "Package Signed - Not Piped": "Package Signed Not Piped",
  "Launch File Help Requested": "Help Requested",
  "Pitched - Advance to eSign": "Pitched - Advance to eSign",
  "Pitched - Advance To eSign": "Pitched - Advance to eSign",
  "Pre Approval": "Pre-Approved",
  "Application Taken": "App Completed",
};

export function normalizeStatus(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let s = dashNormalize(String(raw));
  if (!s) return null;
  s = s.replace(STATUS_PREFIX_RE, "").trim();
  if (!s) return null;
  return STATUS_ALIASES[s] ?? s;
}

export function normalizeStatusSet(statuses: string[]): Set<string> {
  const out = new Set<string>();
  for (const s of statuses) {
    const n = normalizeStatus(s);
    if (n) out.add(n);
  }
  return out;
}

export function rowMatchesStatuses(
  row: { status_raw?: string | null; portal_status_raw?: string | null; lendingpad_status_raw?: string | null },
  statuses: string[],
  portalStatuses?: string[],
): boolean {
  const want = normalizeStatusSet(statuses);
  const wantPortal = portalStatuses?.length ? normalizeStatusSet(portalStatuses) : null;

  const statusNorm = normalizeStatus(row.status_raw);
  const portalNorm = normalizeStatus(row.portal_status_raw);
  const lpNorm = normalizeStatus(row.lendingpad_status_raw);

  if (want.size > 0) {
    if (statusNorm && want.has(statusNorm)) return true;
    if (portalNorm && want.has(portalNorm)) return true;
    if (lpNorm && want.has(lpNorm)) return true;
  }

  if (wantPortal && wantPortal.size > 0) {
    if (portalNorm && wantPortal.has(portalNorm)) return true;
    if (statusNorm && wantPortal.has(statusNorm)) return true;
  }

  return want.size === 0 && (!wantPortal || wantPortal.size === 0);
}
