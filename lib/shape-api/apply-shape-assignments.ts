import type { ShapeKpiCsvRow } from "@/lib/import/shape-kpi";
import {
  applyShapeDeptAssignment,
  nonEmptyDeptValue,
  parseDepursLoValue,
} from "@/lib/shape-api/parse-depurs-lo-value";
import { SHAPE_ASSIGNMENT_DEPT_FIELDS } from "@/lib/shape-api/shape-dept-fields";

function str(value: unknown): string | undefined {
  if (value == null) return undefined;
  const s = String(value).trim();
  return s || undefined;
}

/**
 * Map Shape bulk-export assignment fields → CSV-like LO columns.
 * Processes departments in priority order (LO → LI → LP → PO → Closer).
 */
export function applyShapeAssignmentFields(
  record: Record<string, unknown>,
  out: Partial<ShapeKpiCsvRow>,
): void {
  for (const dept of SHAPE_ASSIGNMENT_DEPT_FIELDS) {
    const raw = nonEmptyDeptValue(record[dept.apiKey]);
    if (raw !== undefined) {
      applyShapeDeptAssignment(raw, out, {
        deptIdColumn: dept.idColumn,
        fillPrimaryLoColumns: true,
      });
    }
  }

  if (out["Loan Officer User Name"] === undefined) {
    for (const dept of SHAPE_ASSIGNMENT_DEPT_FIELDS) {
      for (const displayKey of dept.displayKeys) {
        const v = str(record[displayKey]);
        if (v !== undefined) {
          out["Loan Officer User Name"] = v;
          const parsed = parseDepursLoValue(v);
          if (parsed.email && out["Loan Officer Email"] === undefined) {
            out["Loan Officer Email"] = parsed.email;
          }
          return;
        }
      }
    }
  }
}
