import type { SupabaseClient } from "@supabase/supabase-js";

export type MlReadiness = {
  totalOutcomes: number;
  closedCount: number;
  dismissedCount: number;
  staleCount: number;
  otherCount: number;
  earliestOutcomeAt: string | null;
  daysOfData: number;
  trainingReady: boolean;
  /** Progress toward the Phase-5 launch threshold (180 days of labels). */
  progressPct: number;
  byType: Array<{
    signal_type: string;
    total: number;
    closed: number;
    closeRatePct: number | null;
  }>;
};

const MIN_DAYS_FOR_TRAINING = 180;

/**
 * Snapshot of the training-data pipeline that will feed the future ML ranker.
 * Safe to call from an executive-only page (RLS allows exec+admin).
 */
export async function loadMlReadiness(admin: SupabaseClient): Promise<MlReadiness> {
  const [{ data: outcomes, error: oe }, { data: byTypeRaw, error: be }] = await Promise.all([
    admin
      .from("signal_outcomes")
      .select("outcome_kind,outcome_at")
      .order("outcome_at", { ascending: true })
      .limit(10000),
    admin
      .from("signal_conversion_by_type")
      .select("signal_type,total_outcomes,closed_count,close_rate_pct"),
  ]);
  if (oe) throw oe;
  if (be) throw be;

  const rows = outcomes ?? [];
  let closed = 0;
  let dismissed = 0;
  let stale = 0;
  let other = 0;
  for (const r of rows) {
    const kind = (r.outcome_kind as string) ?? "";
    if (kind === "closed_within_window") closed += 1;
    else if (kind === "dismissed_by_exec") dismissed += 1;
    else if (kind === "stale_no_movement") stale += 1;
    else other += 1;
  }

  const earliest = rows[0]?.outcome_at as string | undefined;
  const daysOfData = earliest
    ? Math.max(
        0,
        Math.floor((Date.now() - new Date(earliest).getTime()) / (24 * 60 * 60 * 1000))
      )
    : 0;

  const byType = (byTypeRaw ?? []).map((r) => ({
    signal_type: r.signal_type as string,
    total: Number(r.total_outcomes ?? 0),
    closed: Number(r.closed_count ?? 0),
    closeRatePct: r.close_rate_pct == null ? null : Number(r.close_rate_pct),
  }));

  return {
    totalOutcomes: rows.length,
    closedCount: closed,
    dismissedCount: dismissed,
    staleCount: stale,
    otherCount: other,
    earliestOutcomeAt: earliest ?? null,
    daysOfData,
    trainingReady: daysOfData >= MIN_DAYS_FOR_TRAINING && rows.length >= 500,
    progressPct: Math.min(100, Math.round((daysOfData / MIN_DAYS_FOR_TRAINING) * 100)),
    byType,
  };
}
