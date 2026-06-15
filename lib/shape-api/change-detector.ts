/**
 * Shape Change Detector
 *
 * Compares an existing loan DB row against an incoming Shape sync payload
 * and produces a list of ActivityEvents ready to insert into shape_activity_log.
 *
 * Detects:
 *   - loan_created   — no existing row found for this shape_record_id
 *   - status_changed — status_raw changed to a new value
 *   - owner_changed  — assigned_loan_officer_name changed
 *   - note_added     — notes_sidebar or recent_notes text changed
 *   - field_changed  — any other tracked field changed
 */

export type ActivityEvent = {
  loan_id: string;
  shape_record_id: number;
  change_type: "loan_created" | "status_changed" | "owner_changed" | "note_added" | "field_changed";
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  lo_name: string | null;
  borrower_name: string | null;
  synced_at?: string;
};

/** Fields that trigger a `field_changed` event when they differ. */
const TRACKED_FIELDS: Array<keyof ExistingLoanRow> = [
  "loan_amount_cents",
  "current_stage",
  "source",
  "loan_type",
  "loan_purpose",
  "credit_score_mid",
  "lendingpad_loan_uuid",
  "appraisal_payment_collected_at",
  "esign_returned_at",
  "application_completed_at",
  "submitted_to_processing_at",
  "submitted_to_uw_at",
  "ctc_at",
  "funded_at",
  "closing_scheduled_at",
];

/** Subset of the loans table columns we need for diffing. */
export type ExistingLoanRow = {
  id: string;
  shape_record_id: number;
  status_raw: string | null;
  assigned_loan_officer_name: string | null;
  notes_sidebar: string | null;
  notes_sidebar_ai_note: string | null;
  recent_notes: string | null;
  borrower_first_name: string | null;
  borrower_last_name: string | null;
  loan_amount_cents: number | null;
  current_stage: string | null;
  source: string | null;
  loan_type: string | null;
  loan_purpose: string | null;
  credit_score_mid: number | null;
  lendingpad_loan_uuid: string | null;
  appraisal_payment_collected_at: string | null;
  esign_returned_at: string | null;
  application_completed_at: string | null;
  submitted_to_processing_at: string | null;
  submitted_to_uw_at: string | null;
  ctc_at: string | null;
  funded_at: string | null;
  closing_scheduled_at: string | null;
};

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function changed(a: unknown, b: unknown): boolean {
  return str(a) !== str(b);
}

function borrowerName(row: Partial<ExistingLoanRow>): string | null {
  const parts = [row.borrower_first_name, row.borrower_last_name].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

/**
 * Diff an existing loans row against the incoming sync payload.
 * `existing` is null when this is a brand-new record.
 */
export function detectChanges(
  existing: ExistingLoanRow | null,
  incoming: Record<string, unknown>,
  loanId: string,
): ActivityEvent[] {
  const shapeRecordId = Number(incoming.shape_record_id ?? 0);
  const loName = str(incoming.assigned_loan_officer_name);
  const bName = [str(incoming.borrower_first_name), str(incoming.borrower_last_name)]
    .filter(Boolean)
    .join(" ") || null;

  const events: ActivityEvent[] = [];

  // ── Brand-new lead ──────────────────────────────────────────────────────
  if (!existing) {
    events.push({
      loan_id: loanId,
      shape_record_id: shapeRecordId,
      change_type: "loan_created",
      field_name: null,
      old_value: null,
      new_value: str(incoming.status_raw),
      lo_name: loName,
      borrower_name: bName,
    });
    return events;
  }

  const existingBorrowerName = borrowerName(existing);

  // ── Status change ───────────────────────────────────────────────────────
  if (changed(existing.status_raw, incoming.status_raw)) {
    events.push({
      loan_id: loanId,
      shape_record_id: shapeRecordId,
      change_type: "status_changed",
      field_name: "status_raw",
      old_value: str(existing.status_raw),
      new_value: str(incoming.status_raw),
      lo_name: loName,
      borrower_name: existingBorrowerName,
    });
  }

  // ── Owner change ────────────────────────────────────────────────────────
  if (changed(existing.assigned_loan_officer_name, incoming.assigned_loan_officer_name)) {
    events.push({
      loan_id: loanId,
      shape_record_id: shapeRecordId,
      change_type: "owner_changed",
      field_name: "assigned_loan_officer_name",
      old_value: str(existing.assigned_loan_officer_name),
      new_value: str(incoming.assigned_loan_officer_name),
      lo_name: loName,
      borrower_name: existingBorrowerName,
    });
  }

  // ── Note changes ────────────────────────────────────────────────────────
  const noteFields: Array<keyof ExistingLoanRow> = [
    "notes_sidebar",
    "notes_sidebar_ai_note",
    "recent_notes",
  ];
  for (const field of noteFields) {
    if (changed(existing[field], incoming[field])) {
      const newText = str(incoming[field] as unknown);
      if (newText) {
        events.push({
          loan_id: loanId,
          shape_record_id: shapeRecordId,
          change_type: "note_added",
          field_name: field,
          old_value: null,
          new_value: newText.length > 500 ? `${newText.slice(0, 500)}…` : newText,
          lo_name: loName,
          borrower_name: existingBorrowerName,
        });
        break; // one note_added event per cycle is enough
      }
    }
  }

  // ── Other tracked field changes ─────────────────────────────────────────
  for (const field of TRACKED_FIELDS) {
    // status/owner already handled above
    if ((field as string) === "status_raw" || (field as string) === "assigned_loan_officer_name") continue;
    if (changed(existing[field], incoming[field])) {
      events.push({
        loan_id: loanId,
        shape_record_id: shapeRecordId,
        change_type: "field_changed",
        field_name: field,
        old_value: str(existing[field]),
        new_value: str(incoming[field]),
        lo_name: loName,
        borrower_name: existingBorrowerName,
      });
    }
  }

  return events;
}
