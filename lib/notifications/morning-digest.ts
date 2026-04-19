/**
 * Morning digest builder.
 *
 * For each executive user, summarize the pipeline:
 *   • Top 5 hot signals across all LOs
 *   • New signals in the last 24 hours
 *   • Per-LO signal counts, highlighting anyone with > 5 hot signals
 *
 * Produces one executive_notifications row per executive (kind='morning_digest').
 * The body is plain markdown so it renders the same in-app and in future
 * email / slack delivery channels.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { SIGNAL_LABEL, type SignalType } from "@/lib/signals/types";

type ExecUser = { id: string; full_name: string | null };

type DigestSignal = {
  id: string;
  signal_type: SignalType;
  priority: number;
  reason: string;
  lo_name: string | null;
  computed_at: string;
  loan_id: string;
};

export type DigestSummary = {
  generatedAt: string;
  totalActive: number;
  hotCount: number;
  newLast24h: number;
  topSignals: DigestSignal[];
  loTopList: Array<{ loName: string; total: number; hot: number }>;
};

function formatCurrency(cents: number | null | undefined): string {
  if (!cents) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function renderDigestBody(summary: DigestSummary): string {
  const lines: string[] = [];
  lines.push(`**${summary.hotCount} hot signals · ${summary.totalActive} active · ${summary.newLast24h} new in the last 24h**`);
  lines.push("");
  if (summary.topSignals.length > 0) {
    lines.push("**Top priorities**");
    for (const s of summary.topSignals) {
      const label = SIGNAL_LABEL[s.signal_type] ?? s.signal_type;
      lines.push(`• P${s.priority} · ${label} — ${s.reason} (${s.lo_name ?? "unassigned"})`);
    }
    lines.push("");
  }
  if (summary.loTopList.length > 0) {
    lines.push("**LOs with the most signals**");
    for (const lo of summary.loTopList) {
      lines.push(`• ${lo.loName}: ${lo.total} signals · ${lo.hot} hot`);
    }
  }
  return lines.join("\n");
}

export async function buildDigestSummary(admin: SupabaseClient): Promise<DigestSummary> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: activeSignals, error: sigErr } = await admin
    .from("deal_signals")
    .select("id,signal_type,priority,reason,lo_name,computed_at,loan_id")
    .is("dismissed_at", null);
  if (sigErr) throw sigErr;

  const signals = (activeSignals ?? []) as DigestSignal[];

  const hot = signals.filter((s) => s.priority >= 4);
  const newLast24h = signals.filter((s) => s.computed_at >= twentyFourHoursAgo).length;

  const topSignals = [...hot]
    .sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      return b.computed_at.localeCompare(a.computed_at);
    })
    .slice(0, 5);

  const byLo = new Map<string, { loName: string; total: number; hot: number }>();
  for (const s of signals) {
    const key = s.lo_name ?? "Unassigned";
    const existing = byLo.get(key) ?? { loName: key, total: 0, hot: 0 };
    existing.total += 1;
    if (s.priority >= 4) existing.hot += 1;
    byLo.set(key, existing);
  }
  const loTopList = [...byLo.values()].sort((a, b) => b.hot - a.hot || b.total - a.total).slice(0, 5);

  return {
    generatedAt: new Date().toISOString(),
    totalActive: signals.length,
    hotCount: hot.length,
    newLast24h,
    topSignals,
    loTopList,
  };
}

export async function deliverMorningDigest(
  admin: SupabaseClient
): Promise<{ execsNotified: number; summary: DigestSummary }> {
  const summary = await buildDigestSummary(admin);
  const body = renderDigestBody(summary);

  const { data: execs, error: execErr } = await admin
    .from("users")
    .select("id,full_name")
    .in("role", ["executive", "admin"]);
  if (execErr) throw execErr;

  const rows = (execs ?? [])
    .map((u: ExecUser) => ({
      user_id: u.id,
      kind: "morning_digest",
      title: `Morning digest — ${summary.hotCount} hot signals`,
      body,
      payload: {
        totalActive: summary.totalActive,
        hotCount: summary.hotCount,
        newLast24h: summary.newLast24h,
        topSignalIds: summary.topSignals.map((s) => s.id),
        generatedAt: summary.generatedAt,
      },
    }));

  if (rows.length === 0) {
    return { execsNotified: 0, summary };
  }

  const { error: insErr } = await admin.from("executive_notifications").insert(rows);
  if (insErr) throw insErr;

  return { execsNotified: rows.length, summary };
}

export { renderDigestBody };
// expose types for route handlers
export type { DigestSignal };
// expose to currency formatter outside (e.g. tests)
export { formatCurrency };
