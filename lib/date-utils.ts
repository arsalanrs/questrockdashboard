/**
 * Date/timezone utilities for QR Dashboard.
 * All "today" boundaries use Eastern Time (America/New_York) since that
 * is the business operating timezone for QuestRock.
 */

/**
 * Returns the ISO-8601 UTC timestamp for midnight ET (Eastern Time) on
 * the date that `now` falls in, in ET.
 *
 * Examples (EDT = UTC-4):
 *   now = 2026-06-16T20:00:00Z  → returns "2026-06-16T04:00:00.000Z"
 *   now = 2026-01-15T20:00:00Z  → returns "2026-01-15T05:00:00.000Z" (EST = UTC-5)
 */
export function etMidnightIso(now: Date = new Date()): string {
  const etDate = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" }); // "YYYY-MM-DD"

  // Try UTC-4 (EDT, summer) first, then UTC-5 (EST, winter)
  for (const utcHour of [4, 5]) {
    const candidate = new Date(`${etDate}T${String(utcHour).padStart(2, "0")}:00:00.000Z`);
    const etHour = parseInt(
      candidate.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
      10,
    );
    // etHour === 0 means midnight ET; Intl returns "24" for midnight in some locales
    if (etHour === 0 || etHour === 24) return candidate.toISOString();
  }

  // Safe fallback — EDT offset
  return `${etDate}T04:00:00.000Z`;
}

/**
 * Returns the ISO date string for today in Eastern Time ("YYYY-MM-DD").
 */
export function etTodayDate(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
