/**
 * Weekly Report Builder
 *
 * Summarizes the current week (Mon–Sun):
 *   - New leads this week vs last week
 *   - Loans moved forward (stage advanced) vs stalled
 *   - Top 3 LOs by activity count
 *   - Bottom 3 LOs by SLA compliance
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type WeeklyReportData = {
  weekLabel: string;
  newLeadsThisWeek: number;
  newLeadsLastWeek: number;
  leadsMovedForward: number;
  leadsStalled: number;
  slaRedCount: number;
  topLos: Array<{ loName: string; activityCount: number }>;
  bottomLos: Array<{ loName: string; slaRedCount: number; totalActive: number }>;
  fundedThisWeek: number;
  fundedVolumeCentsThisWeek: number;
};

function weekBounds(offsetWeeks = 0): { from: Date; to: Date } {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon
  const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(now);
  monday.setDate(monday.getDate() - diffToMonday - offsetWeeks * 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { from: monday, to: sunday };
}

function fmtWeek(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export async function buildWeeklyReport(admin: SupabaseClient): Promise<WeeklyReportData> {
  const thisWeek = weekBounds(0);
  const lastWeek = weekBounds(1);

  const [thisWeekLeads, lastWeekLeads, activityThisWeek, slaRows, fundedThisWeek] = await Promise.all([
    admin
      .from("loans")
      .select("id,assigned_loan_officer_name")
      .gte("lead_created_at", thisWeek.from.toISOString())
      .lte("lead_created_at", thisWeek.to.toISOString()),
    admin
      .from("loans")
      .select("id")
      .gte("lead_created_at", lastWeek.from.toISOString())
      .lte("lead_created_at", lastWeek.to.toISOString()),
    admin
      .from("shape_activity_log")
      .select("lo_name,change_type")
      .gte("synced_at", thisWeek.from.toISOString())
      .lte("synced_at", thisWeek.to.toISOString()),
    admin
      .from("v_lead_sla_status")
      .select("loan_id,lo_name,sla_color"),
    admin
      .from("loans")
      .select("loan_amount_cents")
      .or(`closed_at.gte.${thisWeek.from.toISOString()},funded_at.gte.${thisWeek.from.toISOString()}`)
      .lte("lead_created_at", thisWeek.to.toISOString()),
  ]);

  const newLeadsThisWeek = (thisWeekLeads.data ?? []).length;
  const newLeadsLastWeek = (lastWeekLeads.data ?? []).length;

  // Activity count per LO this week
  const activityByLo = new Map<string, number>();
  for (const row of activityThisWeek.data ?? []) {
    const lo = (row.lo_name as string | null) ?? "Unknown";
    activityByLo.set(lo, (activityByLo.get(lo) ?? 0) + 1);
  }

  const topLos = [...activityByLo.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([loName, activityCount]) => ({ loName, activityCount }));

  // SLA compliance per LO
  const slaByLo = new Map<string, { red: number; total: number }>();
  for (const row of slaRows.data ?? []) {
    const lo = (row.lo_name as string | null) ?? "Unknown";
    const s = slaByLo.get(lo) ?? { red: 0, total: 0 };
    s.total += 1;
    if (row.sla_color === "red") s.red += 1;
    slaByLo.set(lo, s);
  }

  const slaRedCount = (slaRows.data ?? []).filter((r) => r.sla_color === "red").length;

  const bottomLos = [...slaByLo.entries()]
    .filter(([, s]) => s.red > 0)
    .sort((a, b) => b[1].red - a[1].red)
    .slice(0, 3)
    .map(([loName, s]) => ({ loName, slaRedCount: s.red, totalActive: s.total }));

  // Stage events this week — count loans that moved forward
  const { data: stageEvents } = await admin
    .from("loan_stage_events")
    .select("loan_id")
    .gte("entered_at", thisWeek.from.toISOString())
    .lte("entered_at", thisWeek.to.toISOString());
  const leadsMovedForward = new Set((stageEvents ?? []).map((e) => e.loan_id as string)).size;

  const funded = fundedThisWeek.data ?? [];
  const fundedVolumeCentsThisWeek = funded.reduce((acc, l) => acc + ((l.loan_amount_cents as number | null) ?? 0), 0);

  return {
    weekLabel: `${fmtWeek(thisWeek.from)} – ${fmtWeek(thisWeek.to)}`,
    newLeadsThisWeek,
    newLeadsLastWeek,
    leadsMovedForward,
    leadsStalled: slaRedCount,
    slaRedCount,
    topLos,
    bottomLos,
    fundedThisWeek: funded.length,
    fundedVolumeCentsThisWeek,
  };
}

export function renderWeeklyReportMarkdown(data: WeeklyReportData): string {
  const lines: string[] = [];
  const delta = data.newLeadsThisWeek - data.newLeadsLastWeek;
  const deltaStr = delta >= 0 ? `+${delta}` : `${delta}`;

  function fmt(cents: number) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
  }

  lines.push(`## Weekly Report — ${data.weekLabel}`);
  lines.push("");
  lines.push(`**${data.newLeadsThisWeek} new leads** (${deltaStr} vs last week) · **${data.fundedThisWeek} funded** / ${fmt(data.fundedVolumeCentsThisWeek)}`);
  lines.push("");
  lines.push(`Pipeline movement: **${data.leadsMovedForward} loans moved forward** · **${data.slaRedCount} SLA violations**`);
  lines.push("");

  if (data.topLos.length > 0) {
    lines.push("### Top LOs by Activity");
    for (const lo of data.topLos) {
      lines.push(`- **${lo.loName}** — ${lo.activityCount} activity events`);
    }
    lines.push("");
  }

  if (data.bottomLos.length > 0) {
    lines.push("### SLA Concerns");
    for (const lo of data.bottomLos) {
      const pct = Math.round((lo.slaRedCount / lo.totalActive) * 100);
      lines.push(`- **${lo.loName}** — ${lo.slaRedCount}/${lo.totalActive} loans in red (${pct}%)`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
