import Papa from "papaparse";
import { parse } from "date-fns";

export type ShapeKpiCsvRow = Record<string, string | undefined>;

export function parseShapeKpiCsv(csvText: string) {
  const parsed = Papa.parse<ShapeKpiCsvRow>(csvText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  if (parsed.errors?.length) {
    const msg = parsed.errors.map((e) => e.message).join("; ");
    throw new Error(`CSV parse error: ${msg}`);
  }

  return parsed.data.filter((r) => Object.keys(r).length > 0);
}

const TIMESTAMP_FORMATS = ["MM/dd/yyyy hh:mm a", "yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd"];

export function parseMaybeTimestamp(value: string | undefined | null) {
  const v = (value ?? "").trim();
  if (!v || v === "--") return null;

  for (const fmt of TIMESTAMP_FORMATS) {
    const dt = parse(v, fmt, new Date());
    if (!Number.isNaN(dt.getTime())) return dt.toISOString();
  }
  return null;
}

export function parseMaybeDate(value: string | undefined | null) {
  const v = (value ?? "").trim();
  if (!v || v === "--") return null;

  // Some exports may include date-only or datetime.
  const formats = ["MM/dd/yyyy", "MM/dd/yyyy hh:mm a"];
  for (const fmt of formats) {
    const dt = parse(v, fmt, new Date());
    if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  }
  return null;
}

function dollarsToCents(dollars: number) {
  return Math.round(dollars * 100);
}

function parseKNumber(input: string) {
  const s = input.trim().toUpperCase();
  if (!s) return null;
  const m = s.match(/^([0-9]+(?:\.[0-9]+)?)\s*(K|M)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const suffix = m[2];
  if (suffix === "K") return n * 1_000;
  if (suffix === "M") return n * 1_000_000;
  return n;
}

export function parseLoanAmountCents(raw: string | undefined | null) {
  const v = (raw ?? "").trim();
  if (!v) return { loan_amount_raw: null, loan_amount_cents: null };

  // Common ranges like: 200K-500K
  if (v.includes("-")) {
    const [a, b] = v.split("-").map((x) => x.trim());
    const lo = parseKNumber(a);
    const hi = parseKNumber(b);
    if (lo != null && hi != null) {
      return { loan_amount_raw: v, loan_amount_cents: dollarsToCents((lo + hi) / 2) };
    }
  }

  // Numeric like: 539100 or 1,200,000
  const cleaned = v.replace(/[$,]/g, "");
  const numeric = Number(cleaned);
  if (Number.isFinite(numeric)) {
    return { loan_amount_raw: v, loan_amount_cents: dollarsToCents(numeric) };
  }

  // Fall back to K/M parsing
  const km = parseKNumber(cleaned);
  if (km != null) {
    return { loan_amount_raw: v, loan_amount_cents: dollarsToCents(km) };
  }

  return { loan_amount_raw: v, loan_amount_cents: null };
}

