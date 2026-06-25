/**
 * Shape CRM owner ids (`depursLo` / lead_owner_id) → display names.
 * Shared with inbound (lib/shape/lo-roster.js); override via SHAPE_LO_ROSTER_JSON.
 */
export type ShapeLoRosterEntry = {
  name: string;
  depursLo: number;
  email?: string;
};

export const DEFAULT_SHAPE_LO_ROSTER: ShapeLoRosterEntry[] = [
  { name: "Tashawna Chisholm", depursLo: 49, email: "tchisholm@questrock.com" },
  { name: "Tyler Johnson", depursLo: 34, email: "tjohnson@questrock.com" },
  { name: "Bastian Johnston", depursLo: 13, email: "bastianjohnston@questrock.com" },
  { name: "Nikk Smith", depursLo: 3, email: "nikksmith@questrock.com" },
  { name: "Stephen Curry", depursLo: 40, email: "scurry@questrock.com" },
  { name: "Jessica Sherard", depursLo: 37, email: "jsherard@questrock.com" },
  { name: "Ray Conway", depursLo: 16, email: "rconway@questrock.com" },
  { name: "Gregory Bethea Jr", depursLo: 58, email: "gbethea@questrock.com" },
  { name: "Zachary Davis", depursLo: 55, email: "zdavis@questrock.com" },
  { name: "Jason Friday", depursLo: 52, email: "jfriday@questrock.com" },
  { name: "Concierge", depursLo: 31 },
];

let cachedRoster: ShapeLoRosterEntry[] | null = null;
let cachedById: Map<number, string> | null = null;
let cachedByEmail: Map<string, string> | null = null;

function normalizeLoName(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function getShapeLoRoster(): ShapeLoRosterEntry[] {
  if (cachedRoster) return cachedRoster;

  const raw = process.env.SHAPE_LO_ROSTER_JSON?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        cachedRoster = parsed.map((entry) => {
          const o = entry as Record<string, unknown>;
          const email = String(o.email ?? "").trim().toLowerCase();
          return {
            name: String(o.name ?? "").trim(),
            depursLo: Number(o.depursLo ?? o.id),
            ...(email ? { email } : {}),
          };
        });
        cachedById = null;
        cachedByEmail = null;
        return cachedRoster;
      }
    } catch {
      // fall through to defaults
    }
  }

  cachedRoster = [...DEFAULT_SHAPE_LO_ROSTER];
  return cachedRoster;
}

function depursLoByIdMap(): Map<number, string> {
  if (cachedById) return cachedById;
  cachedById = new Map();
  for (const entry of getShapeLoRoster()) {
    if (Number.isFinite(entry.depursLo) && entry.name) {
      cachedById.set(entry.depursLo, entry.name);
    }
  }
  return cachedById;
}

function depursLoByEmailMap(): Map<string, string> {
  if (cachedByEmail) return cachedByEmail;
  cachedByEmail = new Map();
  for (const entry of getShapeLoRoster()) {
    const email = String(entry.email ?? "").trim().toLowerCase();
    if (email && entry.name) {
      cachedByEmail.set(email, entry.name);
    }
  }
  return cachedByEmail;
}

/** Parse Shape owner id from API/CSV (numeric string or number). Rejects loan amounts mistaken for ids. */
export function parseShapeDepursLoId(raw: unknown): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || !/^\d+$/.test(s)) return null;
  const n = Number(s);
  // Shape depursLo ids are small integers (e.g. 34); loan amounts are 5–7 digits.
  if (!Number.isFinite(n) || n <= 0 || n > 999) return null;
  return n;
}

/** True when value looks like a Shape depursLo id, not a person name. */
export function looksLikeShapeDepursLoId(raw: string | null | undefined): boolean {
  const s = String(raw ?? "").trim();
  return /^\d+$/.test(s) && Number(s) > 0;
}

/** Shape depursLo / lead_owner_id → roster display name. */
export function resolveDepursLoIdToName(depursLoId: number | null | undefined): string | null {
  if (depursLoId == null || !Number.isFinite(depursLoId)) return null;
  return depursLoByIdMap().get(depursLoId) ?? null;
}

/** When bulk export returns depursLo as an email, map to roster display name. */
export function resolveDepursLoEmailToName(email: string | null | undefined): string | null {
  const key = String(email ?? "").trim().toLowerCase();
  if (!key) return null;
  return depursLoByEmailMap().get(key) ?? null;
}

/** Display name → Shape depursLo id (for outbound assign API). */
export function resolveNameToDepursLoId(loName: string | null | undefined): number | null {
  const query = normalizeLoName(loName);
  if (!query) return null;

  const roster = getShapeLoRoster();
  for (const entry of roster) {
    if (normalizeLoName(entry.name) === query) return entry.depursLo;
  }

  for (const entry of roster) {
    const parts = normalizeLoName(entry.name).split(" ").filter(Boolean);
    if (parts.length < 2) continue;
    const first = parts[0]!;
    const last = parts[parts.length - 1]!;
    if (query === last || query === first) return entry.depursLo;
    if (query.includes(last) && query.includes(first)) return entry.depursLo;
  }

  return null;
}

/** Reset cached roster (tests only). */
export function resetShapeLoRosterCacheForTests(): void {
  cachedRoster = null;
  cachedById = null;
  cachedByEmail = null;
}
