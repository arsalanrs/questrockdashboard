/**
 * Morning digest builder.
 *
 * Executives (Bill, Ray, Nikk) receive the full-pipeline digest:
 *   • Top 5 hot signals across ALL loan officers
 *   • New signals in the last 24 hours
 *   • Per-LO signal counts
 *
 * Managers (Bastian, Tashawna, Jason) receive a team-scoped digest:
 *   • Same format, but filtered to loans owned by their team members
 *     (+ the manager's own loans).
 *
 * Produces one executive_notifications row per recipient (kind='morning_digest').
 * The body is plain markdown so it renders in-app and in future
 * email / Slack delivery channels.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { SIGNAL_LABEL, type SignalType } from "@/lib/signals/types";

type DigestRecipient = { id: string; full_name: string | null; role: string };

type DigestSignal = {
  id: string;
  signal_type: SignalType;
  priority: number;
  reason: string;
  lo_name: string | null;
  lo_user_id?: string | null;
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

function renderDigestBody(summary: DigestSummary, scopeLabel?: string): string {
  const lines: string[] = [];
  if (scopeLabel) {
    lines.push(`**${scopeLabel}**`);
    lines.push("");
  }
  lines.push(
    `**${summary.hotCount} hot signals · ${summary.totalActive} active · ${summary.newLast24h} new in the last 24h**`
  );
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

function buildSummaryFromSignals(signals: DigestSignal[]): DigestSummary {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
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

export async function buildDigestSummary(admin: SupabaseClient): Promise<DigestSummary> {
  const { data: activeSignals, error: sigErr } = await admin
    .from("deal_signals")
    .select("id,signal_type,priority,reason,lo_name,lo_user_id,computed_at,loan_id")
    .is("dismissed_at", null);
  if (sigErr) throw sigErr;

  return buildSummaryFromSignals((activeSignals ?? []) as DigestSignal[]);
}

export async function deliverMorningDigest(
  admin: SupabaseClient
): Promise<{ recipientsNotified: number; execsNotified: number; managersNotified: number; summary: DigestSummary }> {
  // ── 1. Fetch all active signals once ────────────────────────────────────────
  const { data: activeSignals, error: sigErr } = await admin
    .from("deal_signals")
    .select("id,signal_type,priority,reason,lo_name,lo_user_id,computed_at,loan_id")
    .is("dismissed_at", null);
  if (sigErr) throw sigErr;

  const allSignals = (activeSignals ?? []) as DigestSignal[];
  const fullSummary = buildSummaryFromSignals(allSignals);

  // ── 2. Fetch recipients: executives + managers (active only) ─────────────────
  const { data: recipients, error: userErr } = await admin
    .from("users")
    .select("id,full_name,role")
    .in("role", ["executive", "admin", "manager"])
    .eq("is_active", true);
  if (userErr) throw userErr;

  const allRecipients = (recipients ?? []) as DigestRecipient[];
  const executives = allRecipients.filter((u) => u.role === "executive" || u.role === "admin");
  const managers = allRecipients.filter((u) => u.role === "manager");

  // ── 3. Fetch team memberships for managers ────────────────────────────────────
  // team_members rows: { team_id, user_id } — we need manager → [member user ids]
  const managerIds = managers.map((m) => m.id);
  const memberIdsByManager = new Map<string, Set<string>>();

  if (managerIds.length > 0) {
    // Get teams each manager leads
    const { data: managedTeams } = await admin
      .from("teams")
      .select("id,manager_user_id")
      .in("manager_user_id", managerIds);

    const teamIds = (managedTeams ?? []).map((t) => t.id);

    if (teamIds.length > 0) {
      const { data: members } = await admin
        .from("team_members")
        .select("team_id,user_id")
        .in("team_id", teamIds);

      // Map each manager to the set of member user IDs (including themselves)
      for (const team of managedTeams ?? []) {
        const mgr = team.manager_user_id as string;
        const memberSet = memberIdsByManager.get(mgr) ?? new Set<string>();
        memberSet.add(mgr); // manager sees their own loans too
        for (const m of members ?? []) {
          if (m.team_id === team.id) memberSet.add(m.user_id);
        }
        memberIdsByManager.set(mgr, memberSet);
      }
    }
    // Managers with no team still see their own loans
    for (const mgr of managers) {
      if (!memberIdsByManager.has(mgr.id)) {
        memberIdsByManager.set(mgr.id, new Set([mgr.id]));
      }
    }
  }

  // ── 4. Build notification rows ────────────────────────────────────────────────
  const notificationRows: Record<string, unknown>[] = [];

  // Executives → full-pipeline digest
  const fullBody = renderDigestBody(fullSummary);
  for (const exec of executives) {
    notificationRows.push({
      user_id: exec.id,
      kind: "morning_digest",
      title: `Morning digest — ${fullSummary.hotCount} hot signals`,
      body: fullBody,
      payload: {
        totalActive: fullSummary.totalActive,
        hotCount: fullSummary.hotCount,
        newLast24h: fullSummary.newLast24h,
        topSignalIds: fullSummary.topSignals.map((s) => s.id),
        generatedAt: fullSummary.generatedAt,
        scope: "all",
      },
    });
  }

  // Managers → team-scoped digest
  for (const mgr of managers) {
    const teamMemberIds = memberIdsByManager.get(mgr.id) ?? new Set([mgr.id]);
    const teamSignals = allSignals.filter(
      (s) => s.lo_user_id != null && teamMemberIds.has(s.lo_user_id)
    );
    const teamSummary = buildSummaryFromSignals(teamSignals);

    // Determine team name for context
    const teamLabel =
      teamSignals.length === 0
        ? "No active signals for your team"
        : `${[...teamMemberIds].length} team member${[...teamMemberIds].length === 1 ? "" : "s"}`;

    const teamBody = renderDigestBody(teamSummary, `Team digest — ${teamLabel}`);
    notificationRows.push({
      user_id: mgr.id,
      kind: "morning_digest",
      title: `Morning digest — ${teamSummary.hotCount} hot · ${teamSummary.totalActive} active on your team`,
      body: teamBody,
      payload: {
        totalActive: teamSummary.totalActive,
        hotCount: teamSummary.hotCount,
        newLast24h: teamSummary.newLast24h,
        topSignalIds: teamSummary.topSignals.map((s) => s.id),
        generatedAt: teamSummary.generatedAt,
        scope: "team",
        teamMemberIds: [...teamMemberIds],
      },
    });
  }

  if (notificationRows.length === 0) {
    return { recipientsNotified: 0, execsNotified: 0, managersNotified: 0, summary: fullSummary };
  }

  const { error: insErr } = await admin.from("executive_notifications").insert(notificationRows);
  if (insErr) throw insErr;

  return {
    recipientsNotified: notificationRows.length,
    execsNotified: executives.length,
    managersNotified: managers.length,
    summary: fullSummary,
  };
}

export { renderDigestBody, formatCurrency };
export type { DigestSignal };
