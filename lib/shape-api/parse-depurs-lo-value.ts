import { isPlausibleLoName } from "@/lib/import/plausible-lo-name";
import type { ShapeKpiCsvRow } from "@/lib/import/shape-kpi";
import { parseShapeDepursLoId } from "@/lib/shape-api/lo-roster";

export type DepursLoParsed = {
  id: number | null;
  email: string | null;
  name: string | null;
};

/** Shape department fields may be a numeric user id, email, or display name. */
export function parseDepursLoValue(raw: unknown): DepursLoParsed {
  if (raw == null) return { id: null, email: null, name: null };
  const s = String(raw).trim();
  if (!s) return { id: null, email: null, name: null };

  const id = parseShapeDepursLoId(s);
  if (id != null) return { id, email: null, name: null };

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
    return { id: null, email: s.toLowerCase(), name: null };
  }

  if (isPlausibleLoName(s)) {
    return { id: null, email: null, name: s };
  }

  return { id: null, email: null, name: null };
}

export function nonEmptyDeptValue(raw: unknown): unknown | undefined {
  if (raw == null) return undefined;
  const s = String(raw).trim();
  return s ? raw : undefined;
}

/**
 * Store dept-specific id and optionally fill primary LO columns (first non-empty wins).
 */
export function applyShapeDeptAssignment(
  raw: unknown,
  out: Partial<ShapeKpiCsvRow>,
  options: { deptIdColumn: string; fillPrimaryLoColumns?: boolean },
): void {
  const parsed = parseDepursLoValue(raw);
  if (parsed.id != null && out[options.deptIdColumn] === undefined) {
    out[options.deptIdColumn] = String(parsed.id);
  }
  if (!options.fillPrimaryLoColumns) return;
  if (parsed.id != null && out["Shape Depurs LO Id"] === undefined) {
    out["Shape Depurs LO Id"] = String(parsed.id);
  }
  if (parsed.email && out["Loan Officer Email"] === undefined) {
    out["Loan Officer Email"] = parsed.email;
  }
  if (parsed.name && out["Loan Officer User Name"] === undefined) {
    out["Loan Officer User Name"] = parsed.name;
  }
}

/** @deprecated Use applyShapeDeptAssignment */
export function applyDepursLoFields(raw: unknown, out: Partial<ShapeKpiCsvRow>): void {
  applyShapeDeptAssignment(raw, out, { deptIdColumn: "Shape Depurs LO Id", fillPrimaryLoColumns: true });
}

/** @deprecated Use applyShapeDeptAssignment */
export function applyDepursLiFields(raw: unknown, out: Partial<ShapeKpiCsvRow>): void {
  applyShapeDeptAssignment(raw, out, { deptIdColumn: "Shape Depurs LI Id", fillPrimaryLoColumns: true });
}
