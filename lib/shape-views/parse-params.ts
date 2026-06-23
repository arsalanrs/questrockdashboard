import type { ShapeViewCategory } from "@/lib/shape-views";
import { defaultViewIdForCategory, getViewById } from "@/lib/shape-views";

const VALID_CATEGORIES = new Set<string>(["Leads", "Applications", "Loans", "all"]);

export function parseShapePipelineSearchParams(
  searchParams: Record<string, string | undefined>,
  now = new Date(),
): { category: ShapeViewCategory; viewId: string } {
  const rawCategory = searchParams.category ?? "Leads";
  const category: ShapeViewCategory = VALID_CATEGORIES.has(rawCategory)
    ? (rawCategory as ShapeViewCategory)
    : "Leads";

  const viewParam = searchParams.view;
  const viewId =
    viewParam && getViewById(viewParam, now)
      ? viewParam
      : defaultViewIdForCategory(category);

  return { category, viewId };
}
