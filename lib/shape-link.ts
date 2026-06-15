/**
 * Helper to build "Open in Shape" deep links.
 *
 * Set NEXT_PUBLIC_SHAPE_LEAD_BASE_URL in your environment to enable links
 * (e.g. https://secure.setshape.com/lead/ — note trailing slash).
 * Returns null when the env var is not set or the ID is falsy so callers
 * can conditionally render the link.
 */
export function shapeLeadUrl(shapeLeadId: number | null | undefined): string | null {
  const base = process.env.NEXT_PUBLIC_SHAPE_LEAD_BASE_URL;
  if (!base || !shapeLeadId) return null;
  return `${base}${shapeLeadId}`;
}
