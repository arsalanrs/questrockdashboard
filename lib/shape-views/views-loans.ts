import { differenceInCalendarDays, subDays } from "date-fns";
import type { ShapeLoanRow, ShapeViewRule } from "./types";

const MS_PER_DAY = 86_400_000;

function daysSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return differenceInCalendarDays(now, d);
}

function lastActivityAt(row: ShapeLoanRow): string | null {
  return row.last_status_change_at ?? row.shape_last_updated_at;
}

function stalledDays(row: ShapeLoanRow, now: Date, minDays: number): boolean {
  const ref = lastActivityAt(row);
  if (!ref) return false;
  const days = daysSince(ref, now);
  return days != null && days >= minDays;
}

function fundedWithinDays(row: ShapeLoanRow, now: Date, days: number): boolean {
  const ref = row.funded_at ?? row.closed_at;
  if (!ref) return false;
  const d = new Date(ref);
  if (Number.isNaN(d.getTime())) return false;
  return d >= subDays(now, days);
}

function anniversaryWindow(row: ShapeLoanRow, now: Date, months: number, windowDays = 14): boolean {
  const ref = row.funded_at ?? row.closed_at;
  if (!ref) return false;
  const funded = new Date(ref);
  if (Number.isNaN(funded.getTime())) return false;
  const target = new Date(funded);
  target.setMonth(target.getMonth() + months);
  const diff = Math.abs(differenceInCalendarDays(now, target));
  return diff <= windowDays;
}

export const LOANS_VIEWS: ShapeViewRule[] = [
  {
    id: "verification-queue",
    label: "Verification Queue",
    category: "Loans",
    recordTypes: ["Loans"],
    statuses: ["Verification", "Verification Docs Requested", "Verification Docs Received"],
    sort: { field: "created", dir: "desc" },
  },
  {
    id: "package-out-queue",
    label: "Package Out Queue",
    category: "Loans",
    recordTypes: ["Loans"],
    statuses: [
      "Pitched - Advance to eSign",
      "Pitched - Advance",
      "Pre-Piped",
      "Package Out",
      "Package Signed Not Piped",
      "Piped",
    ],
    sort: { field: "last_status_change", dir: "asc" },
  },
  // Pipeline Visibility sub-views
  {
    id: "pv-help-requested",
    label: "Help Requested",
    category: "Loans",
    recordTypes: ["Loans"],
    statuses: ["Help Requested", "Launch File Help Requested"],
    sort: { field: "last_status_change", dir: "desc" },
  },
  {
    id: "pv-waiting-appraisal",
    label: "Waiting on Appraisal",
    category: "Loans",
    recordTypes: ["Loans"],
    statuses: ["Waiting on Appraisal", "Appraisal Ordered"],
    sort: { field: "last_status_change", dir: "desc" },
  },
  {
    id: "pv-processing",
    label: "Processing",
    category: "Loans",
    recordTypes: ["Loans"],
    statuses: ["Processing", "Registered", "Submitted To Processing"],
    sort: { field: "last_status_change", dir: "desc" },
  },
  {
    id: "pv-underwriting",
    label: "Underwriting",
    category: "Loans",
    recordTypes: ["Loans"],
    statuses: ["Submitted to UW", "Submitted To UW", "Underwriting"],
    sort: { field: "last_status_change", dir: "desc" },
  },
  {
    id: "pv-rate-lock",
    label: "Rate Lock",
    category: "Loans",
    recordTypes: ["Loans"],
    statuses: ["Rate Lock", "Rate Locked"],
    sort: { field: "last_status_change", dir: "desc" },
  },
  {
    id: "pv-conditions",
    label: "Conditions",
    category: "Loans",
    recordTypes: ["Loans"],
    statuses: [
      "Approved with Conditions",
      "Conditions Submitted",
      "Incomplete (ReSubmission)",
    ],
    sort: { field: "last_status_change", dir: "desc" },
  },
  {
    id: "pv-ctc",
    label: "Clear to Close (Pipeline)",
    category: "Loans",
    recordTypes: ["Loans"],
    statuses: ["Clear to Close"],
    sort: { field: "last_status_change", dir: "desc" },
  },
  {
    id: "pv-funded-30d",
    label: "Funded (Last 30 Days)",
    category: "Loans",
    recordTypes: ["Loans"],
    statuses: ["Funded", "Closed", "Purchased"],
    sort: { field: "last_status_change", dir: "desc" },
    extraFilter: (row) => fundedWithinDays(row, new Date(), 30),
  },
  {
    id: "pv-funded-1yr",
    label: "Funded (Last 1 Year)",
    category: "Loans",
    recordTypes: ["Loans"],
    statuses: ["Funded", "Closed", "Purchased"],
    sort: { field: "last_status_change", dir: "desc" },
    extraFilter: (row) => fundedWithinDays(row, new Date(), 365),
  },
  {
    id: "closing-queue",
    label: "Closing Queue",
    category: "Loans",
    recordTypes: ["Loans"],
    statuses: ["Clear to Close"],
    sort: { field: "last_status_change", dir: "desc" },
  },
  {
    id: "loan-anniversaries-6mo",
    label: "6-Month Anniversaries",
    category: "Loans",
    recordTypes: ["Loans"],
    statuses: ["Funded", "Closed", "Purchased"],
    sort: { field: "conversion", dir: "desc" },
    extraFilter: (row) => anniversaryWindow(row, new Date(), 6),
  },
  {
    id: "loan-anniversaries-1yr",
    label: "1-Year Anniversaries",
    category: "Loans",
    recordTypes: ["Loans"],
    statuses: ["Funded", "Closed", "Purchased"],
    sort: { field: "conversion", dir: "desc" },
    extraFilter: (row) => anniversaryWindow(row, new Date(), 12),
  },
  {
    id: "leads-to-advance",
    label: "Leads to Advance",
    category: "Loans",
    recordTypes: ["Loans"],
    statuses: ["Advanced"],
    sort: { field: "last_status_change", dir: "desc" },
  },
];

/** Re-bind extraFilter closures to a fixed `now` for consistent server render. */
export function bindLoansViewsToDate(now: Date): ShapeViewRule[] {
  return LOANS_VIEWS.map((view) => {
    if (!view.extraFilter) return view;
    const orig = view.extraFilter;
    return {
      ...view,
      extraFilter: (row: ShapeLoanRow) => {
        if (view.id === "pv-funded-30d") return fundedWithinDays(row, now, 30);
        if (view.id === "pv-funded-1yr") return fundedWithinDays(row, now, 365);
        if (view.id === "loan-anniversaries-6mo") return anniversaryWindow(row, now, 6);
        if (view.id === "loan-anniversaries-1yr") return anniversaryWindow(row, now, 12);
        return orig(row);
      },
    };
  });
}

export { stalledDays, lastActivityAt, MS_PER_DAY };
