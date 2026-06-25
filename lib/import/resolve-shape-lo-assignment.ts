import { normalizeLoName } from "@/lib/import/build-loan-payload";
import { isPlausibleLoName } from "@/lib/import/plausible-lo-name";
import { resolveLoUserId, type LoUserRow } from "@/lib/import/resolve-lo-user-id";
import {
  looksLikeShapeDepursLoId,
  parseShapeDepursLoId,
  resolveDepursLoEmailToName,
  resolveDepursLoIdToName,
} from "@/lib/shape-api/lo-roster";
import { SHAPE_ASSIGNMENT_ID_COLUMNS } from "@/lib/shape-api/shape-dept-fields";
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

type LoAssignmentRow = Partial<
  Pick<ShapeKpiCsvRow, "Loan Officer User Name" | "Loan Officer Email"> & Record<string, string | undefined>
>;

/**
 * Resolve primary contact from Shape assignment departments → app LO user.
 * Priority: depursLo → depursLi → depursLp → depursPo → depursCl → display name.
 */
export function resolveShapeLoAssignment(
  row: LoAssignmentRow,
  lookup: {
    nameToUserId: Map<string, string>;
    emailToUserId?: Map<string, string>;
    users?: LoUserRow[];
  },
): ShapeLoAssignment {
  const loFieldRaw = String(row["Loan Officer User Name"] ?? "").trim() || null;
  const loEmail = String(row["Loan Officer Email"] ?? "").trim().toLowerCase() || null;

  const deptIds = SHAPE_ASSIGNMENT_ID_COLUMNS.map((col) => parseShapeDepursLoId(row[col]));
  const depursFromLoField = looksLikeShapeDepursLoId(loFieldRaw)
    ? parseShapeDepursLoId(loFieldRaw)
    : null;

  let shapeDepursLoId: number | null = null;
  let loName: string | null = null;

  for (const id of [...deptIds, depursFromLoField]) {
    if (id == null) continue;
    if (shapeDepursLoId == null) shapeDepursLoId = id;
    if (!loName) loName = resolveDepursLoIdToName(id);
    if (loName) break;
  }

  if (!loName && loEmail) {
    loName = resolveDepursLoEmailToName(loEmail);
  }
  if (!loName && loEmail && lookup.users?.length) {
    const uid = lookup.emailToUserId?.get(loEmail);
    if (uid) {
      const user = lookup.users.find((u) => u.id === uid);
      loName = user?.full_name?.trim() || null;
    }
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
    ? resolveLoUserId(loName, loEmail, lookup)
    : resolveLoUserId(loFieldRaw, loEmail, lookup);

  return { loName, assignedLoUserId, shapeDepursLoId };
}
