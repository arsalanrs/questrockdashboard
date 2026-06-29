export type ShapeRecordType = "Leads" | "Applications" | "Loans";

export type ShapeViewCategory = ShapeRecordType | "all";

export type ShapeViewSortField = "created" | "conversion" | "last_status_change";

export type ShapeLoanRow = {
  id: string;
  shape_record_id: number | null;
  record_type: string | null;
  source: string | null;
  status_raw: string | null;
  portal_status_raw: string | null;
  lendingpad_status_raw: string | null;
  lendingpad_status_at: string | null;
  borrower_first_name: string | null;
  borrower_last_name: string | null;
  borrower_email: string | null;
  borrower_phone: string | null;
  assigned_loan_officer_user_id: string | null;
  assigned_loan_officer_name: string | null;
  lead_created_at: string | null;
  application_completed_at: string | null;
  conversion_date: string | null;
  shape_last_updated_at: string | null;
  last_status_change_at: string | null;
  last_contacted_at: string | null;
  funded_at: string | null;
  closed_at: string | null;
  lendingpad_loan_uuid: string | null;
  current_stage: string | null;
  loan_amount_cents: number | null;
};

export type ShapeViewRule = {
  id: string;
  label: string;
  category: ShapeViewCategory;
  recordTypes: ShapeRecordType[] | "all";
  /** Normalized Shape status strings (after prefix strip). */
  statuses: string[];
  /** Optional POS / portal column match (OR-combined with statuses). */
  portalStatuses?: string[];
  sort: { field: ShapeViewSortField; dir: "asc" | "desc" };
  extraFilter?: (row: ShapeLoanRow) => boolean;
  /** View not yet supported — show placeholder count. */
  deferred?: boolean;
  deferredReason?: string;
};
