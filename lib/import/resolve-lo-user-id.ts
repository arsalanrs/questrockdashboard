import { normalizeLoName } from "@/lib/import/build-loan-payload";

export type LoUserRow = {
  id: string;
  full_name: string | null;
  email?: string | null;
};

function normalizeName(input: string | null | undefined): string {
  return String(input ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+(jr|sr|ii|iii|iv)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Shape / LP officer names that differ from app user full_name. */
const BUILTIN_NAME_ALIASES: Record<string, string> = {
  "harrison johnson": "tyler johnson",
  "gregory bethea": "gregory bethea jr",
  "nikk smith": "nikkolas smith",
  "nikkolas smith": "nikk smith",
};

function nameAliasMap(): Map<string, string> {
  const map = new Map<string, string>(Object.entries(BUILTIN_NAME_ALIASES));
  const raw = process.env.LENDINGPAD_NAME_ALIASES_JSON?.trim();
  if (!raw) return map;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed && typeof parsed === "object") {
      for (const [k, v] of Object.entries(parsed)) {
        const from = normalizeName(k);
        const to = normalizeName(String(v ?? ""));
        if (from && to) map.set(from, to);
      }
    }
  } catch {
    // Ignore invalid alias JSON.
  }
  return map;
}

function canonicalizeOfficerName(input: string | null | undefined): string {
  const n = normalizeName(input);
  if (!n) return "";
  return nameAliasMap().get(n) ?? n;
}

/** Candidate display names for fuzzy matching (comma order, suffixes, aliases). */
export function loNameMatchCandidates(raw: string | null | undefined): string[] {
  const s = String(raw ?? "").trim();
  if (!s) return [];

  const out = new Set<string>();
  const add = (v: string | null | undefined) => {
    const t = String(v ?? "").trim();
    if (t) out.add(t);
  };

  add(s);
  add(normalizeLoName(s));

  if (s.includes(",")) {
    const [a, b] = s.split(",").map((p) => p.trim());
    if (a && b) {
      add(`${b} ${a}`);
      add(`${a} ${b}`);
    }
  }

  const flipped = normalizeLoName(s);
  if (flipped.includes(" ")) {
    const parts = flipped.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      add(`${parts[parts.length - 1]} ${parts[0]}`);
    }
  }

  return [...out];
}

export function buildLoUserIdLookup(users: LoUserRow[]): {
  nameToUserId: Map<string, string>;
  emailToUserId: Map<string, string>;
  usersById: Map<string, LoUserRow>;
} {
  const nameToUserId = new Map<string, string>();
  const emailToUserId = new Map<string, string>();
  const usersById = new Map<string, LoUserRow>();

  for (const u of users) {
    usersById.set(u.id, u);
    const raw = String(u.full_name ?? "").trim();
    if (!raw) continue;

    const keys = new Set<string>();
    keys.add(raw.toLowerCase());
    keys.add(normalizeName(raw));
    keys.add(canonicalizeOfficerName(raw));

    const parts = normalizeName(raw).split(" ").filter(Boolean);
    if (parts.length >= 2) {
      keys.add(`${parts[0]} ${parts[parts.length - 1]}`);
    }

    for (const k of keys) {
      if (k) nameToUserId.set(k, u.id);
    }

    if (u.email) emailToUserId.set(String(u.email).trim().toLowerCase(), u.id);
  }

  return { nameToUserId, emailToUserId, usersById };
}

function resolveByFuzzyName(
  officerName: string | null | undefined,
  users: LoUserRow[],
): string | null {
  const n = canonicalizeOfficerName(officerName);
  if (!n) return null;

  const exact = users.find((u) => canonicalizeOfficerName(u.full_name) === n);
  if (exact) return exact.id;

  const parts = n.split(" ").filter(Boolean);
  if (parts.length < 2) return null;
  const first = parts[0];
  const last = parts[parts.length - 1];

  for (const u of users) {
    const up = canonicalizeOfficerName(u.full_name).split(" ").filter(Boolean);
    if (up.length < 2) continue;
    const uFirst = up[0];
    const uLast = up[up.length - 1];
    const lastEq = last === uLast;
    const firstClose =
      first === uFirst ||
      first.startsWith(uFirst) ||
      uFirst.startsWith(first) ||
      (first.length >= 4 && uFirst.length >= 4 && first.slice(0, 4) === uFirst.slice(0, 4));
    if (lastEq && firstClose) return u.id;
  }

  return null;
}

export function resolveLoUserId(
  loNameRaw: string | null | undefined,
  loEmail: string | null | undefined,
  lookup: {
    nameToUserId: Map<string, string>;
    emailToUserId?: Map<string, string>;
    users?: LoUserRow[];
  },
): string | null {
  const email = loEmail?.trim().toLowerCase();
  if (email && lookup.emailToUserId?.get(email)) {
    return lookup.emailToUserId.get(email) ?? null;
  }

  for (const candidate of loNameMatchCandidates(loNameRaw)) {
    const keys = [
      candidate.toLowerCase(),
      normalizeName(candidate),
      canonicalizeOfficerName(candidate),
    ];
    for (const k of keys) {
      const id = lookup.nameToUserId.get(k);
      if (id) return id;
    }
  }

  return null;
}

/** Backfill assigned_loan_officer_user_id where name is set but id is missing. */
export async function backfillLoUserIdsFromNames(
  admin: ReturnType<typeof import("@/lib/supabase/admin").createSupabaseAdminClient>,
): Promise<{ updated: number; stillUnmatched: number }> {
  const { data: users, error: usersError } = await admin.from("users").select("id,full_name,email");
  if (usersError) throw usersError;

  const lookup = buildLoUserIdLookup(users ?? []);
  const lookupWithUsers = { ...lookup, users: users ?? [] };

  let updated = 0;
  let stillUnmatched = 0;

  while (true) {
    const { data: rows, error } = await admin
      .from("loans")
      .select("id,assigned_loan_officer_name,loan_officer_email")
      .is("assigned_loan_officer_user_id", null)
      .not("assigned_loan_officer_name", "is", null)
      .limit(500);
    if (error) throw error;
    if (!rows?.length) break;

    for (const row of rows) {
      const userId = resolveLoUserId(
        row.assigned_loan_officer_name,
        row.loan_officer_email,
        lookupWithUsers,
      );
      if (!userId) {
        stillUnmatched += 1;
        continue;
      }
      const { error: upErr } = await admin
        .from("loans")
        .update({ assigned_loan_officer_user_id: userId })
        .eq("id", row.id);
      if (!upErr) updated += 1;
    }

    if (rows.length < 500) break;
  }

  return { updated, stillUnmatched };
}
