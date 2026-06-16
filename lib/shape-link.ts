/**
 * Builds an "Open in Shape" deep link for a lead.
 *
 * Shape's URL format: https://secure.setshape.com/prospects/{leadId}/edit
 *
 * Falls back to NEXT_PUBLIC_SHAPE_LEAD_BASE_URL if set (legacy env var).
 * Returns null when the ID is falsy so callers can conditionally render.
 */
const SHAPE_PROSPECTS_BASE = "https://secure.setshape.com/prospects";

export function shapeLeadUrl(shapeLeadId: number | string | null | undefined): string | null {
  if (!shapeLeadId) return null;
  // If a custom base URL is configured, use it (legacy / white-label setups)
  const customBase = process.env.NEXT_PUBLIC_SHAPE_LEAD_BASE_URL;
  if (customBase) {
    return `${customBase.replace(/\/+$/, "")}/${shapeLeadId}/edit`;
  }
  return `${SHAPE_PROSPECTS_BASE}/${shapeLeadId}/edit`;
}
