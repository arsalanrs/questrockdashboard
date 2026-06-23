import type { ShapeViewCategory, ShapeViewRule } from "./types";
import { LEADS_VIEWS } from "./views-leads";
import { APPLICATIONS_VIEWS } from "./views-applications";
import { bindLoansViewsToDate, LOANS_VIEWS } from "./views-loans";
import { bindAllRecordsViewsToDate, ALL_RECORDS_VIEWS } from "./views-all-records";

export type { ShapeViewCategory, ShapeLoanRow, ShapeViewRule } from "./types";
export { parseShapePipelineSearchParams } from "./parse-params";

export const SHAPE_VIEW_CATEGORIES: Array<{ key: ShapeViewCategory; label: string }> = [
  { key: "Leads", label: "Leads" },
  { key: "Applications", label: "Applications" },
  { key: "Loans", label: "Loans" },
  { key: "all", label: "All Records" },
];

/** Full view registry with date-bound extraFilters (call once per request). */
export function getShapeViews(now = new Date()): ShapeViewRule[] {
  return [
    ...LEADS_VIEWS,
    ...APPLICATIONS_VIEWS,
    ...bindLoansViewsToDate(now),
    ...bindAllRecordsViewsToDate(now),
  ];
}

export function getViewsForCategory(category: ShapeViewCategory, now = new Date()): ShapeViewRule[] {
  return getShapeViews(now).filter((v) => v.category === category);
}

export function getViewById(viewId: string, now = new Date()): ShapeViewRule | undefined {
  return getShapeViews(now).find((v) => v.id === viewId);
}

export function defaultViewIdForCategory(category: ShapeViewCategory): string {
  const map: Record<ShapeViewCategory, string> = {
    Leads: "new-leads-follow-up",
    Applications: "pre-app-sent",
    Loans: "verification-queue",
    all: "bb-help-requested",
  };
  return map[category];
}

export {
  LEADS_VIEWS,
  APPLICATIONS_VIEWS,
  LOANS_VIEWS,
  ALL_RECORDS_VIEWS,
};
