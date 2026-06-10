/**
 * Server-side loader for the Executive Opportunities panel.
 *
 * Reads persisted active signals + joins a minimal loan payload (borrower name,
 * amount, shape id) so the panel renders in a single server round-trip.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CachedPlaybook, PanelSignal, LoRollup } from "@/components/executive/OpportunitiesPanel";
import type { SignalType } from "@/lib/signals/types";

function parseCachedPlaybook(raw: unknown): CachedPlaybook | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.headline !== "string" || typeof o.callScript !== "string") return null;
  const email = o.email;
  if (!email || typeof email !== "object") return null;
  const em = email as Record<string, unknown>;
  if (typeof em.subject !== "string" || typeof em.body !== "string") return null;
  if (!Array.isArray(o.nextSteps)) return null;
  return {
    headline: o.headline,
    callScript: o.callScript,
    email: { subject: em.subject, body: em.body },
    nextSteps: o.nextSteps.map((x) => String(x)),
    source: o.source === "llm" ? "llm" : "template",
    generatedAt: typeof o.generatedAt === "string" ? o.generatedAt : new Date().toISOString(),
  };
}

function normalizeBorrowerKey(name: string | null): string {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function pickBetterPanelSignal(prev: PanelSignal, s: PanelSignal): PanelSignal {
  if (s.priority > prev.priority) return s;
  if (s.priority < prev.priority) return prev;
  const ts = s.computedAt ? new Date(s.computedAt).getTime() : 0;
  const pt = prev.computedAt ? new Date(prev.computedAt).getTime() : 0;
  if (ts > pt) return s;
  if (ts < pt) return prev;
  const sb = s.cachedPlaybook != null;
  const pb = prev.cachedPlaybook != null;
  if (sb && !pb) return s;
  if (!sb && pb) return prev;
  return s;
}

/** One row per borrower + signal type (highest priority; tie-break by newest computed_at, then saved playbook). */
function dedupePanelSignals(signals: PanelSignal[]): PanelSignal[] {
  const best = new Map<string, PanelSignal>();
  for (const s of signals) {
    const key = `${normalizeBorrowerKey(s.borrowerName)}|${s.signalType}`;
    const prev = best.get(key);
    if (!prev) {
      best.set(key, s);
      continue;
    }
    best.set(key, pickBetterPanelSignal(prev, s));
  }
  return Array.from(best.values()).sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const ta = a.computedAt ? new Date(a.computedAt).getTime() : 0;
    const tb = b.computedAt ? new Date(b.computedAt).getTime() : 0;
    return tb - ta;
  });
}

export async function loadOpportunitiesPanelData(admin: SupabaseClient) {
  const [{ data: signals, error: sErr }, { data: runs, error: rErr }] = await Promise.all([
    admin
      .from("deal_signals")
      .select("id,loan_id,signal_type,category,priority,reason,lo_user_id,lo_name,meta,computed_at,playbook_json")
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

  let panelSignals: PanelSignal[] = (signals ?? []).map((s) => {
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
      computedAt: (s.computed_at as string | null) ?? null,
      cachedPlaybook: parseCachedPlaybook(s.playbook_json),
    };
  });

  panelSignals = dedupePanelSignals(panelSignals);

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
