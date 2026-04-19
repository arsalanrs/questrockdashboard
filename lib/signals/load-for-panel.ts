/**
 * Server-side loader for the Executive Opportunities panel.
 *
 * Reads persisted active signals + joins a minimal loan payload (borrower name,
 * amount, shape id) so the panel renders in a single server round-trip.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PanelSignal, LoRollup } from "@/components/executive/OpportunitiesPanel";
import type { SignalType } from "@/lib/signals/types";

export async function loadOpportunitiesPanelData(admin: SupabaseClient) {
  const [{ data: signals, error: sErr }, { data: runs, error: rErr }] = await Promise.all([
    admin
      .from("deal_signals")
      .select("id,loan_id,signal_type,category,priority,reason,lo_user_id,lo_name,meta,computed_at")
      .is("dismissed_at", null)
      .order("priority", { ascending: false })
      .order("computed_at", { ascending: false })
      .limit(500),
    admin
      .from("signal_engine_runs")
      .select("finished_at,started_at")
      .order("started_at", { ascending: false })
      .limit(1),
  ]);
  if (sErr) throw sErr;
  if (rErr) throw rErr;

  const loanIds = [...new Set((signals ?? []).map((s) => s.loan_id as string))];
  let loanById = new Map<
    string,
    {
      borrower_first_name: string | null;
      borrower_last_name: string | null;
      loan_amount_cents: number | null;
      shape_record_id: number | null;
    }
  >();
  if (loanIds.length > 0) {
    const { data: loans, error: lErr } = await admin
      .from("loans")
      .select("id,borrower_first_name,borrower_last_name,loan_amount_cents,shape_record_id")
      .in("id", loanIds);
    if (lErr) throw lErr;
    loanById = new Map((loans ?? []).map((l) => [l.id as string, l as any]));
  }

  const panelSignals: PanelSignal[] = (signals ?? []).map((s) => {
    const l = loanById.get(s.loan_id as string);
    const bn =
      [l?.borrower_first_name, l?.borrower_last_name].filter(Boolean).join(" ").trim() || null;
    return {
      id: s.id as string,
      loanId: s.loan_id as string,
      signalType: s.signal_type as SignalType,
      category: s.category as PanelSignal["category"],
      priority: s.priority as number,
      reason: s.reason as string,
      loUserId: (s.lo_user_id as string | null) ?? null,
      loName: (s.lo_name as string | null) ?? null,
      meta: (s.meta ?? {}) as Record<string, unknown>,
      borrowerName: bn,
      loanAmountCents: (l?.loan_amount_cents as number | null) ?? null,
      shapeRecordId: (l?.shape_record_id as number | null) ?? null,
    };
  });

  const rollupMap = new Map<string, LoRollup>();
  for (const s of panelSignals) {
    const key = s.loUserId ?? s.loName ?? "unassigned";
    const loName = s.loName ?? "Unassigned";
    const existing = rollupMap.get(key) ?? {
      loUserId: s.loUserId,
      loName,
      total: 0,
      hot: 0,
      byType: {} as Record<string, number>,
    };
    existing.total += 1;
    if (s.priority >= 4) existing.hot += 1;
    existing.byType[s.signalType] = (existing.byType[s.signalType] ?? 0) + 1;
    rollupMap.set(key, existing);
  }
  const loRollups = [...rollupMap.values()].sort((a, b) => b.total - a.total);

  const lastRunAt = (runs?.[0]?.finished_at as string | null) ?? (runs?.[0]?.started_at as string | null) ?? null;

  return { panelSignals, loRollups, lastRunAt };
}
