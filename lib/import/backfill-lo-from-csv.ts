/**
 * Backfill loans.assigned_loan_officer_user_id from a Shape custom report CSV.
 * Shape bulk API does not return LO assignment; CSV reports do.
 */
import Papa from "papaparse";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeLoName } from "@/lib/import/build-loan-payload";
import { isPlausibleLoName } from "@/lib/import/plausible-lo-name";
import { buildLoUserIdLookup, resolveLoUserId } from "@/lib/import/resolve-lo-user-id";

const NAME_ALIASES: Record<string, string> = {
  "nikkolas smith": "nikk smith",
  "gregory bethea": "gregory bethea jr",
  "harrison johnson": "tyler johnson",
};

function findLoNameColumn(row: Record<string, unknown>): string | null {
  const keys = Object.keys(row);
  const lo = keys.find(
    (k) => k === "Loan Officer User Name" || (k && k.toLowerCase().includes("loan officer")),
  );
  return lo ?? "Loan Officer User Name";
}

export type CsvLoBackfillResult = {
  updated: number;
  skipped: number;
  noUser: number;
  unmatchedNames: string[];
};

export async function backfillLoFromCsvText(
  admin: SupabaseClient,
  csvText: string,
): Promise<CsvLoBackfillResult> {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });
  const rows = parsed.data ?? [];
  if (!rows.length) {
    return { updated: 0, skipped: 0, noUser: 0, unmatchedNames: [] };
  }

  const loNameKey = findLoNameColumn(rows[0]!) ?? "Loan Officer User Name";
  const { data: users, error: usersError } = await admin.from("users").select("id,full_name,email");
  if (usersError) throw usersError;

  const lookup = { ...buildLoUserIdLookup(users ?? []), users: users ?? [] };
  const unmatchedNames = new Set<string>();
  let updated = 0;
  let skipped = 0;
  let noUser = 0;

  for (const row of rows) {
    const recordIdRaw = row.recordId ?? row["Lead ID"];
    const recordId = recordIdRaw != null ? parseInt(String(recordIdRaw).trim(), 10) : NaN;
    if (!Number.isFinite(recordId)) {
      skipped++;
      continue;
    }

    let loName = (row[loNameKey] ?? "").toString().trim() || null;
    if (!loName || !isPlausibleLoName(loName)) {
      skipped++;
      continue;
    }
    if (loName.includes(",")) loName = normalizeLoName(loName) || loName;

    const alias = NAME_ALIASES[loName.toLowerCase()];
    if (alias) loName = alias;

    const uid = resolveLoUserId(loName, null, lookup);
    if (!uid) {
      noUser++;
      unmatchedNames.add(loName);
      continue;
    }

    const { error } = await admin
      .from("loans")
      .update({ assigned_loan_officer_user_id: uid, assigned_loan_officer_name: loName })
      .eq("shape_record_id", recordId);
    if (error) {
      skipped++;
      continue;
    }
    updated++;
  }

  return {
    updated,
    skipped,
    noUser,
    unmatchedNames: [...unmatchedNames].sort(),
  };
}
