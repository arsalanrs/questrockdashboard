/** Values that are loan metadata, not person names — from mistaken field-map matches. */
const JUNK_SINGLE_WORDS = new Set([
  "purchase",
  "refinance",
  "conventional",
  "fha",
  "va",
  "usda",
  "other",
  "fixed",
  "arm",
  "primary",
  "secondary",
  "investment",
  "construction",
  "rehab",
  "cash out",
  "no cash out refinance",
]);

/**
 * True when a string looks like a loan officer display name (not amount, loan type, etc.).
 */
export function isPlausibleLoName(raw: string | null | undefined): boolean {
  const s = String(raw ?? "").trim();
  if (!s) return false;

  const digitsOnly = s.replace(/[,$\s]/g, "");
  if (/^\d+$/.test(digitsOnly)) return false;

  // Loan amount buckets from Shape exports: "200K-500K", "2.5M-5M", "500K-1M"
  if (/^\d[\d.]*[kKmM]?\s*[-–—]\s*\d/i.test(s)) return false;
  if (/^\d[\d.]*[kKmM]$/.test(s.replace(/\s/g, ""))) return false;

  const lower = s.toLowerCase().replace(/\s+/g, " ");
  if (JUNK_SINGLE_WORDS.has(lower)) return false;
  if (/^\([\d\s\-–—]+\)/.test(s)) return false;
  if (/^\d{3,}/.test(s)) return false;
  if (!/[a-zA-Z]/.test(s)) return false;

  if (lower.includes("concierge")) return true;

  // Person names usually have a space or comma (Last, First).
  if (/\s|,/.test(s)) return true;

  // Single short token without roster match is not a person name.
  if (s.length < 8) return false;

  return true;
}
