/**
 * Daily Report Builder
 *
 * Summarizes:
 *   - New leads created today (owner, status, latest note snippet)
 *   - SLA breach counts (red/yellow)
 *   - LO activity totals for the day
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type DailyReportData = {
  date: string;
  newLeadsCount: number;
  slaRedCount: number;
  slaYellowCount: number;
  slaGreenCount: number;
  loActivitySummary: Array<{
    loName: string;
    loansTouched: number;
    statusChanges: number;
    notesAdded: number;
    newLeads: number;
  }>;
  newLeadsDetail: Array<{
    borrowerName: string;
    loName: string | null;
    status: string | null;
    createdAt: string;
    noteSnippet: string | null;
  }>;
};

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

export async function buildDailyReport(admin: SupabaseClient): Promise<DailyReportData> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString();

  const [newLeadsRes, slaRes, activityRes] = await Promise.all([
    admin
      .from("loans")
      .select("borrower_first_name,borrower_last_name,assigned_loan_officer_name,status_raw,lead_created_at,recent_notes")
      .gte("lead_created_at", todayIso)
      .order("lead_created_at", { ascending: false })
      .limit(100),
    admin
      .from("v_lead_sla_status")
      .select("loan_id,sla_color"),
    admin
      .from("v_daily_activity_summary")
      .select("lo_name,loans_touched_today,status_changes_today,notes_today,new_leads_today"),
  ]);

  const newLeads = newLeadsRes.data ?? [];
  const slaRows = slaRes.data ?? [];
  const activityRows = activityRes.data ?? [];

  const slaRedCount = slaRows.filter((r) => r.sla_color === "red").length;
  const slaYellowCount = slaRows.filter((r) => r.sla_color === "yellow").length;
  const slaGreenCount = slaRows.filter((r) => r.sla_color === "green").length;

  const newLeadsDetail = newLeads.map((l) => {
    const borrowerName = [l.borrower_first_name, l.borrower_last_name].filter(Boolean).join(" ") || "Unknown";
    const noteRaw = (l.recent_notes as string | null) ?? null;
    const noteSnippet = noteRaw ? noteRaw.replace(/<[^>]*>/g, "").slice(0, 120) : null;
    return {
      borrowerName,
      loName: (l.assigned_loan_officer_name as string | null) ?? null,
      status: (l.status_raw as string | null) ?? null,
      createdAt: l.lead_created_at as string,
      noteSnippet,
    };
  });

  const loActivitySummary = activityRows.map((r) => ({
    loName: (r.lo_name as string | null) ?? "Unknown",
    loansTouched: (r.loans_touched_today as number) ?? 0,
    statusChanges: (r.status_changes_today as number) ?? 0,
    notesAdded: (r.notes_today as number) ?? 0,
    newLeads: (r.new_leads_today as number) ?? 0,
  }));

  return {
    date: formatDate(today),
    newLeadsCount: newLeads.length,
    slaRedCount,
    slaYellowCount,
    slaGreenCount,
    loActivitySummary,
    newLeadsDetail,
  };
}

export function renderDailyReportMarkdown(data: DailyReportData): string {
  const lines: string[] = [];

  lines.push(`## Daily Report — ${data.date}`);
  lines.push("");
  lines.push(`**${data.newLeadsCount} new leads today** · SLA: ${data.slaRedCount} critical / ${data.slaYellowCount} at risk / ${data.slaGreenCount} on track`);
  lines.push("");

  if (data.newLeadsDetail.length > 0) {
    lines.push("### New Leads");
    for (const l of data.newLeadsDetail) {
      const time = new Date(l.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
      lines.push(`- **${l.borrowerName}** (${l.loName ?? "Unassigned"}) · ${l.status ?? "—"} · ${time}`);
      if (l.noteSnippet) lines.push(`  > ${l.noteSnippet}`);
    }
    lines.push("");
  }

  if (data.loActivitySummary.length > 0) {
    lines.push("### LO Activity Today");
    lines.push("| LO | Loans Touched | Status Changes | Notes | New Leads |");
    lines.push("|---|---|---|---|---|");
    for (const r of data.loActivitySummary) {
      lines.push(`| ${r.loName} | ${r.loansTouched} | ${r.statusChanges} | ${r.notesAdded} | ${r.newLeads} |`);
    }
    lines.push("");
  }

  if (data.slaRedCount > 0) {
    lines.push(`> ⚠️ **${data.slaRedCount} critical SLA violation${data.slaRedCount !== 1 ? "s" : ""}** — review the Manager Dashboard for details.`);
  }

  return lines.join("\n");
}
