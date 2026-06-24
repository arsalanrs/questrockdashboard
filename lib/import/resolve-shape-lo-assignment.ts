import { normalizeLoName } from "@/lib/import/build-loan-payload";
import { isPlausibleLoName } from "@/lib/import/plausible-lo-name";
import { resolveLoUserId, type LoUserRow } from "@/lib/import/resolve-lo-user-id";
import {
  looksLikeShapeDepursLoId,
  parseShapeDepursLoId,
  resolveDepursLoIdToName,
} from "@/lib/shape-api/lo-roster";
import type { ShapeKpiCsvRow } from "@/lib/import/shape-kpi";

export type ShapeLoAssignment = {
  loName: string | null;
  assignedLoUserId: string | null;
  shapeDepursLoId: number | null;
};

const CONCIERGE_NAMES = new Set(["concierge", "concierge desk"]);

function isConciergeLoName(name: string | null): boolean {
  if (!name) return false;
  const n = name.trim().toLowerCase().replace(/\s+/g, " ");
  return CONCIERGE_NAMES.has(n) || n.startsWith("concierge ");
}

/**
 * Resolve Shape owner from depursLo id and/or LO name field → app user id.
 * Bulk API often returns numeric depursLo instead of "Tyler Johnson".
 */
export function resolveShapeLoAssignment(
  row: Partial<Pick<ShapeKpiCsvRow, "Loan Officer User Name" | "Shape Depurs LO Id" | "Loan Officer Email">>,
  lookup: {
    nameToUserId: Map<string, string>;
    emailToUserId?: Map<string, string>;
    users?: LoUserRow[];
  },
): ShapeLoAssignment {
  const loFieldRaw = String(row["Loan Officer User Name"] ?? "").trim() || null;
  const depursFromField = parseShapeDepursLoId(row["Shape Depurs LO Id"]);
  const depursFromLoField = looksLikeShapeDepursLoId(loFieldRaw)
    ? parseShapeDepursLoId(loFieldRaw)
    : null;
  const shapeDepursLoId = depursFromField ?? depursFromLoField;

  let loName: string | null = null;
  if (shapeDepursLoId != null) {
    loName = resolveDepursLoIdToName(shapeDepursLoId);
  }
  if (!loName && loFieldRaw && !looksLikeShapeDepursLoId(loFieldRaw) && isPlausibleLoName(loFieldRaw)) {
    loName = normalizeLoName(loFieldRaw) || loFieldRaw;
  }

  if (loName && !isPlausibleLoName(loName)) {
    loName = null;
  }

  if (isConciergeLoName(loName)) {
    return { loName, assignedLoUserId: null, shapeDepursLoId };
  }

  const assignedLoUserId = loName
    ? resolveLoUserId(loName, row["Loan Officer Email"] ?? null, lookup)
    : resolveLoUserId(loFieldRaw, row["Loan Officer Email"] ?? null, lookup);

  return { loName, assignedLoUserId, shapeDepursLoId };
}
