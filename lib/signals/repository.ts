/**
 * Repository layer for deal_signals.
 * All writes use the Supabase admin client (service role).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DealSignal } from "./types";

export type PersistedSignal = DealSignal & {
  id: string;
  dismissedAt: string | null;
  playbookJson: Record<string, unknown> | null;
};

export type SignalRunSummary = {
  runId: string;
  loansScanned: number;
  signalsWritten: number;
  signalsDismissed: number;
};

const LOAN_SELECT =
  "id,current_stage,status_raw,loan_amount_cents,appraisal_ordered_at,closed_at,closing_date,esign_returned_at,esign_requested_at,application_completed_at,submitted_to_processing_at,submitted_to_uw_at,ctc_at,lead_created_at,assigned_loan_officer_user_id,assigned_loan_officer_name,borrower_first_name,borrower_last_name,loan_type,loan_purpose,shape_record_id,lendingpad_loan_uuid,is_restructure_hold,note_rate_bps,original_rate_bps,property_value_cents,current_loan_balance_cents,ltv_bps,cltv_bps,dti_bps,credit_score_mid,is_veteran,arm_first_reset_date,arm_index,arm_margin_bps,do_not_contact,last_contacted_at,funded_at,loan_age_months";

/**
 * PostgREST caps single queries at a server-side max_rows (1,000 on many
 * Supabase projects). Use explicit pagination via .range() so we never miss
 * rows regardless of project setting.
 */
async function fetchAllPaged<T>(
  admin: SupabaseClient,
  table: string,
  select: string,
  pageSize = 1000,
  hardCap = 50000
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < hardCap; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await admin.from(table).select(select).range(from, to);
    if (error) throw error;
    const chunk = (data ?? []) as T[];
    rows.push(...chunk);
    if (chunk.length < pageSize) break; // last page
  }
  return rows;
}

export async function fetchSignalEngineInput(admin: SupabaseClient, _limit = 50000) {
  const [loans, events, conds, { data: rates, error: rErr }] = await Promise.all([
    fetchAllPaged<Record<string, unknown>>(admin, "loans", LOAN_SELECT, 1000, _limit),
    fetchAllPaged<{ loan_id: string; stage: string; entered_at: string }>(
      admin,
      "loan_stage_events",
      "loan_id,stage,entered_at",
      1000,
      100000
    ),
    fetchAllPaged<{ loan_id: string; status: string }>(
      admin,
      "conditions",
      "loan_id,status",
      1000,
      100000
    ),
    admin.from("market_rates_latest").select("loan_type,term_years,rate_bps,quote_date"),
  ]);

  // market_rates_latest is optional — silently skip if the view doesn't exist yet.
  if (rErr && !/relation.*market_rates/i.test(rErr.message ?? "")) throw rErr;

  return {
    loans: loans as unknown as Parameters<typeof import("./run").computeSignalsForLoans>[0]["loans"],
    events,
    conditions: conds,
    marketRates: (rates ?? []) as {
      loan_type: string;
      term_years: number;
      rate_bps: number;
      quote_date: string;
    }[],
  };
}

/**
 * Upsert a batch of freshly computed signals and auto-dismiss signals whose
 * dedupe_key is no longer present (they self-resolved).
 *
 * Returns a run summary. Callers should also insert a row in signal_engine_runs.
 */
export async function persistSignals(admin: SupabaseClient, signals: DealSignal[]): Promise<SignalRunSummary> {
  const runStart = new Date().toISOString();

  const { data: runRow, error: runErr } = await admin
    .from("signal_engine_runs")
    .insert({ started_at: runStart, loans_scanned: 0, signals_written: 0, signals_dismissed: 0 })
    .select("id")
    .single();
  if (runErr) throw runErr;
  const runId = runRow.id as string;

  let written = 0;
  if (signals.length > 0) {
    const payload = signals.map((s) => ({
      loan_id: s.loanId,
      signal_type: s.signalType,
      category: s.category,
      priority: s.priority,
      reason: s.reason,
      lo_user_id: s.loUserId,
      lo_name: s.loName,
      meta: s.meta ?? {},
      computed_at: s.computedAt,
      dedupe_key: s.dedupeKey,
      dismissed_at: null,
    }));

    const { error: upErr, count } = await admin
      .from("deal_signals")
      .upsert(payload, { onConflict: "dedupe_key", count: "exact" });
    if (upErr) throw upErr;
    written = count ?? payload.length;
  }

  const keepKeys = new Set(signals.map((s) => s.dedupeKey));
  const { data: existing, error: exErr } = await admin
    .from("deal_signals")
    .select("id,dedupe_key,dismissed_at")
    .is("dismissed_at", null);
  if (exErr) throw exErr;

  const toDismiss = (existing ?? []).filter((r) => !keepKeys.has(r.dedupe_key));
  let dismissed = 0;
  if (toDismiss.length > 0) {
    const { error: dErr } = await admin
      .from("deal_signals")
      .update({ dismissed_at: new Date().toISOString() })
      .in(
        "id",
        toDismiss.map((r) => r.id),
      );
    if (dErr) throw dErr;
    dismissed = toDismiss.length;
  }

  await admin
    .from("signal_engine_runs")
    .update({
      finished_at: new Date().toISOString(),
      signals_written: written,
      signals_dismissed: dismissed,
    })
    .eq("id", runId);

  return { runId, loansScanned: 0, signalsWritten: written, signalsDismissed: dismissed };
}

export async function readActiveSignals(admin: SupabaseClient, limit = 500): Promise<PersistedSignal[]> {
  const { data, error } = await admin
    .from("deal_signals")
    .select("id,loan_id,signal_type,category,priority,reason,lo_user_id,lo_name,meta,playbook_json,computed_at,dedupe_key,dismissed_at")
    .is("dismissed_at", null)
    .order("priority", { ascending: false })
    .order("computed_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    loanId: r.loan_id as string,
    signalType: r.signal_type as DealSignal["signalType"],
    category: r.category as DealSignal["category"],
    priority: r.priority as DealSignal["priority"],
    reason: r.reason as string,
    loUserId: (r.lo_user_id as string | null) ?? null,
    loName: (r.lo_name as string | null) ?? null,
    meta: (r.meta ?? {}) as Record<string, unknown>,
    computedAt: r.computed_at as string,
    dedupeKey: r.dedupe_key as string,
    dismissedAt: (r.dismissed_at as string | null) ?? null,
    playbookJson: (r.playbook_json as Record<string, unknown> | null) ?? null,
  }));
}
