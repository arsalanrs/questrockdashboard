import { mapLendingPadStatusToStage } from "./map-lp-status-to-stage";

const NORMALIZE = (s: string) =>
  s
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[\u2013\u2014]/g, "-")
    .toLowerCase();

/**
 * Infer milestone timestamps from LP list loanStatusDate when detail/trk APIs are unavailable.
 * Only sets fields that match the loan's current LP status (statusAt = entered current milestone).
 */
export function lpMilestoneDatesFromListStatus(
  statusRaw: string | null | undefined,
  statusAt: string | null | undefined,
): Record<string, string> {
  if (!statusRaw?.trim() || !statusAt) return {};

  const stage = mapLendingPadStatusToStage(statusRaw);
  const norm = NORMALIZE(statusRaw);
  const out: Record<string, string> = {};

  if (stage === "registered") {
    out.submitted_to_processing_at = statusAt;
  }
  if (stage === "clear_to_close") {
    out.ctc_at = statusAt;
  }
  if (norm === "approved" || norm === "approved with conditions") {
    out.uw_decision_at = statusAt;
  }
  if (stage === "underwriting" && norm.includes("submitted")) {
    out.submitted_to_uw_at = statusAt;
  }

  return out;
}

export function pipedDateForDisplay(row: {
  conversion_date?: string | null;
  submitted_to_processing_at?: string | null;
  lendingpad_status_raw?: string | null;
  lendingpad_status_at?: string | null;
}): string | null {
  return (
    row.conversion_date ??
    row.submitted_to_processing_at ??
    lpStatusDateIf(row, "registered")
  );
}

export function approvedDateForDisplay(row: {
  uw_decision_at?: string | null;
  lendingpad_status_raw?: string | null;
  lendingpad_status_at?: string | null;
}): string | null {
  if (row.uw_decision_at) return row.uw_decision_at;
  const norm = NORMALIZE(row.lendingpad_status_raw ?? "");
  if (
    row.lendingpad_status_at &&
    (norm === "approved" || norm === "approved with conditions")
  ) {
    return row.lendingpad_status_at;
  }
  return null;
}

export function ctcDateForDisplay(row: {
  ctc_at?: string | null;
  lendingpad_status_raw?: string | null;
  lendingpad_status_at?: string | null;
}): string | null {
  return row.ctc_at ?? lpStatusDateIf(row, "clear_to_close");
}

function lpStatusDateIf(
  row: { lendingpad_status_raw?: string | null; lendingpad_status_at?: string | null },
  targetStage: ReturnType<typeof mapLendingPadStatusToStage>,
): string | null {
  if (!row.lendingpad_status_at || !row.lendingpad_status_raw) return null;
  const stage = mapLendingPadStatusToStage(row.lendingpad_status_raw);
  return stage === targetStage ? row.lendingpad_status_at : null;
}
