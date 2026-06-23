import type { SupabaseClient } from "@supabase/supabase-js";
import { startOfDay, subDays } from "date-fns";
import { passesGlobalFilters } from "./global-filters";
import {
  defaultViewIdForCategory,
  getShapeViews,
  getViewById,
  getViewsForCategory,
  type ShapeViewCategory,
} from "./index";
import { rowMatchesStatuses } from "./status-normalize";
import type { ShapeLoanRow, ShapeViewRule, ShapeViewSortField } from "./types";

export const SHAPE_LOAN_SELECT =
  "id,shape_record_id,record_type,source,status_raw,portal_status_raw,lendingpad_status_raw,borrower_first_name,borrower_last_name,borrower_email,borrower_phone,assigned_loan_officer_user_id,assigned_loan_officer_name,lead_created_at,application_completed_at,conversion_date,shape_last_updated_at,last_status_change_at,last_contacted_at,funded_at,closed_at,lendingpad_loan_uuid,current_stage,loan_amount_cents";

export const DEFAULT_WINDOW_DAYS = 90;

export type FetchShapeLoansOptions = {
  /** ISO timestamp — rows with lead_created_at OR shape_last_updated_at >= this. */
  windowStartIso: string;
  assignedLoUserId?: string | null;
  limit?: number;
};

function sortValue(row: ShapeLoanRow, field: ShapeViewSortField): number {
  let iso: string | null = null;
  switch (field) {
    case "created":
      iso = row.lead_created_at;
      break;
    case "conversion":
      iso = row.conversion_date ?? row.application_completed_at;
      break;
    case "last_status_change":
      iso = row.last_status_change_at ?? row.shape_last_updated_at ?? row.lead_created_at;
      break;
  }
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export function sortLoansForView(loans: ShapeLoanRow[], view: ShapeViewRule): ShapeLoanRow[] {
  const { field, dir } = view.sort;
  const mult = dir === "asc" ? 1 : -1;
  return [...loans].sort((a, b) => (sortValue(a, field) - sortValue(b, field)) * mult);
}

export function loanMatchesView(row: ShapeLoanRow, view: ShapeViewRule): boolean {
  if (!passesGlobalFilters(row)) return false;
  if (view.deferred) return false;

  if (view.recordTypes !== "all") {
    const rt = row.record_type?.trim();
    if (!rt || !view.recordTypes.includes(rt as "Leads" | "Applications" | "Loans")) {
      return false;
    }
  }

  const hasStatusRules = view.statuses.length > 0 || (view.portalStatuses?.length ?? 0) > 0;
  if (hasStatusRules && !rowMatchesStatuses(row, view.statuses, view.portalStatuses)) {
    return false;
  }

  if (view.extraFilter && !view.extraFilter(row)) return false;

  return true;
}

export function filterLoansForView(loans: ShapeLoanRow[], viewId: string, now = new Date()): ShapeLoanRow[] {
  const view = getViewById(viewId, now);
  if (!view) return [];
  return sortLoansForView(loans.filter((r) => loanMatchesView(r, view)), view);
}

export function countLoansForView(loans: ShapeLoanRow[], viewId: string, now = new Date()): number {
  const view = getViewById(viewId, now);
  if (!view) return 0;
  if (view.deferred) return 0;
  return loans.filter((r) => loanMatchesView(r, view)).length;
}

export function countLoansByView(loans: ShapeLoanRow[], now = new Date()): Record<string, number> {
  const views = getShapeViews(now);
  const out: Record<string, number> = {};
  for (const view of views) {
    out[view.id] = view.deferred ? 0 : loans.filter((r) => loanMatchesView(r, view)).length;
  }
  return out;
}

export function windowStartIso(days = DEFAULT_WINDOW_DAYS): string {
  const today = startOfDay(new Date());
  return subDays(today, days).toISOString();
}

/** Fetch loans in the default 90-day window (RLS applies via client). */
export async function fetchShapeLoansWindow(
  supabase: SupabaseClient,
  options: FetchShapeLoansOptions,
): Promise<{ loans: ShapeLoanRow[]; error: string | null }> {
  const limit = options.limit ?? 2000;
  let q = supabase
    .from("loans")
    .select(SHAPE_LOAN_SELECT)
    .or(`lead_created_at.gte.${options.windowStartIso},shape_last_updated_at.gte.${options.windowStartIso}`)
    .limit(limit);

  if (options.assignedLoUserId) {
    q = q.eq("assigned_loan_officer_user_id", options.assignedLoUserId);
  }

  const { data, error } = await q;
  if (error) return { loans: [], error: error.message };

  const loans = ((data ?? []) as ShapeLoanRow[]).filter(passesGlobalFilters);
  return { loans, error: null };
}

export {
  defaultViewIdForCategory,
  getShapeViews,
  getViewById,
  getViewsForCategory,
  type ShapeViewCategory,
};
