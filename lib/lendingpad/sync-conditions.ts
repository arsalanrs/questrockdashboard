/**
 * Pull conditions from LendingPad (GET only) and mirror into public.conditions with source = lendingpad.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hasLendingPadReadConfig } from "./config";
import { getLendingPadLoanConditions } from "./client";

export type LendingPadConditionsSyncResult = {
  loansConsidered: number;
  loansSynced: number;
  conditionsWritten: number;
  errors: string[];
};

function syncMaxLoans(): number {
  const raw = process.env.LENDINGPAD_SYNC_MAX_LOANS?.trim();
  const n = raw ? Number(raw) : 150;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 2000) : 150;
}

export async function runLendingPadConditionsSync(): Promise<LendingPadConditionsSyncResult> {
  const result: LendingPadConditionsSyncResult = {
    loansConsidered: 0,
    loansSynced: 0,
    conditionsWritten: 0,
    errors: [],
  };

  if (!hasLendingPadReadConfig()) {
    result.errors.push("LendingPad env not configured");
    return result;
  }

  const admin = createSupabaseAdminClient();
  const max = syncMaxLoans();

  const { data: rows, error } = await admin
    .from("loans")
    .select("id,lendingpad_loan_uuid")
    .not("lendingpad_loan_uuid", "is", null)
    .limit(max);

  if (error) {
    result.errors.push(error.message);
    return result;
  }

  const loans = (rows ?? []) as { id: string; lendingpad_loan_uuid: string | null }[];
  result.loansConsidered = loans.length;

  for (const row of loans) {
    const lpId = row.lendingpad_loan_uuid?.trim();
    if (!lpId) continue;
    try {
      const raw = await getLendingPadLoanConditions(lpId);
      const dedup = new Map<string, (typeof raw)[0]>();
      for (const c of raw) {
        if (!dedup.has(c.externalId)) dedup.set(c.externalId, c);
      }
      const normalized = [...dedup.values()];
      const keepIds = new Set(normalized.map((c) => c.externalId));

      const { data: existing, error: exErr } = await admin
        .from("conditions")
        .select("id,lendingpad_condition_id")
        .eq("loan_id", row.id)
        .eq("source", "lendingpad");
      if (exErr) throw exErr;

      for (const e of existing ?? []) {
        const ext = (e as { lendingpad_condition_id: string | null }).lendingpad_condition_id;
        if (ext && !keepIds.has(ext)) {
          await admin.from("conditions").delete().eq("id", (e as { id: string }).id);
        }
      }

      if (normalized.length === 0) {
        await admin.from("conditions").delete().eq("loan_id", row.id).eq("source", "lendingpad");
      } else {
        for (const c of normalized) {
          const { error: upErr } = await admin.from("conditions").upsert(
            {
              loan_id: row.id,
              title: c.title,
              status: c.status,
              source: "lendingpad",
              lendingpad_condition_id: c.externalId,
              cleared_at: c.clearedAt,
            },
            { onConflict: "loan_id,lendingpad_condition_id" },
          );
          if (upErr) throw upErr;
        }
      }
      result.conditionsWritten += normalized.length;
      result.loansSynced += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(`loan ${row.id}: ${msg}`);
    }
  }

  return result;
}
