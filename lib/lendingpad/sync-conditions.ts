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

function syncMaxLoans(override?: number): number {
  if (override != null) return override;
  const raw = process.env.LENDINGPAD_SYNC_MAX_LOANS?.trim();
  const n = raw ? Number(raw) : 1000;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 5000) : 1000;
}

export async function runLendingPadConditionsSync(options?: { maxLoans?: number }): Promise<LendingPadConditionsSyncResult> {
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
  const max = syncMaxLoans(options?.maxLoans);

  // Prioritise active pipeline stages so most actionable loans are refreshed first
  const PIPELINE_PRIORITY = ["processing", "underwriting", "conditions", "approval_conditions", "submission", "clear_to_close"];
  const { data: priorityRows, error: prioErr } = await admin
    .from("loans")
    .select("id,lendingpad_loan_uuid")
    .not("lendingpad_loan_uuid", "is", null)
    .in("current_stage", PIPELINE_PRIORITY)
    .order("lp_last_synced_at", { ascending: true, nullsFirst: true })
    .limit(max);
  if (prioErr) {
    result.errors.push(prioErr.message);
    return result;
  }

  // Fill remaining budget with other loans sorted by most recently synced
  const priorityIds = new Set((priorityRows ?? []).map((r) => (r as { id: string }).id));
  const remaining = Math.max(0, max - priorityIds.size);
  let otherRows: { id: string; lendingpad_loan_uuid: string | null }[] = [];
  if (remaining > 0) {
    let otherQuery = admin
      .from("loans")
      .select("id,lendingpad_loan_uuid")
      .not("lendingpad_loan_uuid", "is", null)
      .order("lead_created_at", { ascending: false })
      .limit(remaining);
    if (priorityIds.size > 0) {
      otherQuery = otherQuery.not("id", "in", `(${[...priorityIds].join(",")})`);
    }
    const { data, error } = await otherQuery;
    if (error) {
      result.errors.push(error.message);
      return result;
    }
    otherRows = (data ?? []) as { id: string; lendingpad_loan_uuid: string | null }[];
  }

  const loans = [
    ...((priorityRows ?? []) as { id: string; lendingpad_loan_uuid: string | null }[]),
    ...otherRows,
  ];
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
