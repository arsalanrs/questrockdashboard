import { differenceInCalendarDays, startOfMonth, startOfYear } from "date-fns";

export function daysBetween(a: string | Date | null | undefined, b: string | Date | null | undefined) {
  if (!a || !b) return null;
  const da = typeof a === "string" ? new Date(a) : a;
  const db = typeof b === "string" ? new Date(b) : b;
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return null;
  return differenceInCalendarDays(db, da);
}

export function formatCurrency(cents: number | null | undefined) {
  if (cents == null) return "—";
  const dollars = cents / 100;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(dollars);
}

export function sum(values: Array<number | null | undefined>): number {
  return values.reduce<number>((acc, v) => acc + (v ?? 0), 0);
}

export function avg(values: Array<number | null | undefined>) {
  const xs = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function monthStart(now = new Date()) {
  return startOfMonth(now);
}

export function yearStart(now = new Date()) {
  return startOfYear(now);
}

