/**
 * Monthly Report Builder
 *
 * Summarizes the current calendar month:
 *   - All loans created this month with final stage and LO
 *   - Funded vs dead vs active breakdown
 *   - Average days lead → application, application → funded
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type MonthlyReportData = {
  monthLabel: string;
  totalLeads: number;
  fundedCount: number;
  fundedVolumeCents: number;
  activeCount: number;
  terminalCount: number;
  avgDaysLeadToApplication: number | null;
  avgDaysApplicationToFunded: number | null;
  avgDaysLeadToFunded: number | null;
  byLo: Array<{
    loName: string;
    newLeads: number;
    funded: number;
    fundedVolumeCents: number;
  }>;
};

function monthStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function avg(nums: (number | null)[]): number | null {
  const valid = nums.filter((n): n is number => n !== null && Number.isFinite(n));
  if (!valid.length) return null;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}

function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const diff = new Date(b).getTime() - new Date(a).getTime();
  return Math.round(diff / (1000 * 60 * 60 * 24));
}

const TERMINAL_STATUSES = new Set([
  "Funded", "Duplicate", "Bad Lead", "Do Not Contact",
  "Long Term Nurture", "Withdrawn", "Denied", "Dead",
]);

export async function buildMonthlyReport(admin: SupabaseClient): Promise<MonthlyReportData> {
  const mStart = monthStart();
  const now = new Date();

  const { data: loans } = await admin
    .from("loans")
    .select(
      "id,borrower_first_name,borrower_last_name,assigned_loan_officer_name,current_stage,status_raw," +
      "loan_amount_cents,lead_created_at,application_completed_at,closed_at,funded_at",
    )
    .gte("lead_created_at", mStart.toISOString())
    .lte("lead_created_at", now.toISOString())
    .order("lead_created_at", { ascending: false })
    .limit(500);

  const rows = loans ?? [];

  const fundedRows = rows.filter((l) => l.closed_at || l.funded_at || l.status_raw === "Funded");
  const terminalRows = rows.filter((l) => TERMINAL_STATUSES.has(l.status_raw as string ?? ""));
  const activeRows = rows.filter((l) => !TERMINAL_STATUSES.has(l.status_raw as string ?? "") && !(l.closed_at || l.funded_at));

  const fundedVolumeCents = fundedRows.reduce((acc, l) => acc + ((l.loan_amount_cents as number | null) ?? 0), 0);

  const avgDaysLeadToApplication = avg(
    rows.map((l) => daysBetween(l.lead_created_at as string | null, l.application_completed_at as string | null)),
  );
  const avgDaysApplicationToFunded = avg(
    fundedRows.map((l) => {
      const end = (l.closed_at ?? l.funded_at) as string | null;
      return daysBetween(l.application_completed_at as string | null, end);
    }),
  );
  const avgDaysLeadToFunded = avg(
    fundedRows.map((l) => {
      const end = (l.closed_at ?? l.funded_at) as string | null;
      return daysBetween(l.lead_created_at as string | null, end);
    }),
  );

  // Per-LO breakdown
  const byLoMap = new Map<string, { newLeads: number; funded: number; fundedVolumeCents: number }>();
  for (const l of rows) {
    const name = (l.assigned_loan_officer_name as string | null) ?? "Unassigned";
    const entry = byLoMap.get(name) ?? { newLeads: 0, funded: 0, fundedVolumeCents: 0 };
    entry.newLeads += 1;
    if (l.closed_at || l.funded_at || l.status_raw === "Funded") {
      entry.funded += 1;
      entry.fundedVolumeCents += (l.loan_amount_cents as number | null) ?? 0;
    }
    byLoMap.set(name, entry);
  }
  const byLo = [...byLoMap.entries()]
    .map(([loName, stats]) => ({ loName, ...stats }))
    .sort((a, b) => b.funded - a.funded || b.newLeads - a.newLeads);

  return {
    monthLabel: mStart.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    totalLeads: rows.length,
    fundedCount: fundedRows.length,
    fundedVolumeCents,
    activeCount: activeRows.length,
    terminalCount: terminalRows.length,
    avgDaysLeadToApplication,
    avgDaysApplicationToFunded,
    avgDaysLeadToFunded,
    byLo,
  };
}

export function renderMonthlyReportMarkdown(data: MonthlyReportData): string {
  const lines: string[] = [];

  function fmt(cents: number) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
  }

  lines.push(`## Monthly Report — ${data.monthLabel}`);
  lines.push("");
  lines.push(
    `**${data.totalLeads} total leads** · ${data.fundedCount} funded (${fmt(data.fundedVolumeCents)}) · ${data.activeCount} active · ${data.terminalCount} terminal`,
  );
  lines.push("");

  if (data.avgDaysLeadToApplication !== null || data.avgDaysLeadToFunded !== null) {
    lines.push("### Average Cycle Times");
    if (data.avgDaysLeadToApplication !== null) {
      lines.push(`- Lead → Application: **${data.avgDaysLeadToApplication} days**`);
    }
    if (data.avgDaysApplicationToFunded !== null) {
      lines.push(`- Application → Funded: **${data.avgDaysApplicationToFunded} days**`);
    }
    if (data.avgDaysLeadToFunded !== null) {
      lines.push(`- Lead → Funded (total): **${data.avgDaysLeadToFunded} days**`);
    }
    lines.push("");
  }

  if (data.byLo.length > 0) {
    lines.push("### By Loan Officer");
    lines.push("| LO | New Leads | Funded | Volume |");
    lines.push("|---|---|---|---|");
    for (const r of data.byLo) {
      lines.push(`| ${r.loName} | ${r.newLeads} | ${r.funded} | ${fmt(r.fundedVolumeCents)} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
