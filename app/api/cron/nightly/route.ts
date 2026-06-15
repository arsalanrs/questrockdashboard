/**
 * Chained nightly cron — combines every sync/signal/notification job into a single
 * Vercel cron so we fit inside the Hobby plan's 2-cron limit.
 *
 * Order matters:
 *   1. Shape incremental sync (updatedDateRange from watermark)
 *   2. LendingPad loans + conditions + documents (depends on Shape for shape_record_id links)
 *   3. Signal engine run + lead tier classification (tiers refresh after signals persist)
 *   4. Outcome labeler (depends on signals)
 *   5. Lead tier retention digest (8-month / EPO summary for execs)
 *   6. Morning digest (depends on signals + notifications)
 *
 * Failures are caught per-step so later steps still run. Each step's result is
 * returned in the response JSON so you can inspect the cron log.
 *
 * Auth: Vercel Cron Bearer token, x-cron-secret header, or executive session.
 */
import { NextResponse } from "next/server";

import { isCronRequestAuthorized } from "@/lib/cron-auth";
import { canViewExecutiveDashboard } from "@/lib/permissions";
import { requireCurrentUser } from "@/lib/current-user";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hasShapeApiConfig } from "@/lib/shape-api/config";
import { runShapeApiSync } from "@/lib/shape-api/sync";
import { hasLendingPadReadConfig } from "@/lib/lendingpad/config";
import { runLendingPadConditionsSync } from "@/lib/lendingpad/sync-conditions";
import { runLendingPadDocumentsSync } from "@/lib/lendingpad/sync-documents";
import { runLendingPadLoansSync } from "@/lib/lendingpad/sync-loans";
import { computeSignalsForLoans } from "@/lib/signals/run";
import { fetchSignalEngineInput, persistSignals } from "@/lib/signals/repository";
import { persistLeadTiers } from "@/lib/signals/tier-classifier";
import { runOutcomeLabeler } from "@/lib/signals/outcomes";
import { deliverMorningDigest } from "@/lib/notifications/morning-digest";
import { deliverLeadTierRetentionDigest } from "@/lib/notifications/lead-tier-retention";
import { buildDailyReport, renderDailyReportMarkdown } from "@/lib/reports/daily";
import { buildWeeklyReport, renderWeeklyReportMarkdown } from "@/lib/reports/weekly";
import { buildMonthlyReport, renderMonthlyReportMarkdown } from "@/lib/reports/monthly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Hobby-plan ceiling; incremental steps fit easily.

type StepResult = { ok: boolean; durationMs: number; data?: unknown; error?: string };

async function step<T>(name: string, fn: () => Promise<T>): Promise<StepResult> {
  const start = Date.now();
  try {
    const data = await fn();
    return { ok: true, durationMs: Date.now() - start, data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[cron/nightly] ${name} failed:`, err);
    return { ok: false, durationMs: Date.now() - start, error: msg };
  }
}

async function authorize(request: Request): Promise<NextResponse | null> {
  if (isCronRequestAuthorized(request)) return null;
  try {
    const { appUser } = await requireCurrentUser();
    if (canViewExecutiveDashboard(appUser.role)) return null;
  } catch {
    /* fall through */
  }
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

async function handle(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;

  const results: Record<string, StepResult> = {};

  results.shape = await step("shape", async () => {
    if (!hasShapeApiConfig()) return { skipped: true, reason: "Shape API not configured" };
    return await runShapeApiSync({ mode: "incremental" });
  });

  results.lendingpadLoans = await step("lendingpadLoans", async () => {
    if (!hasLendingPadReadConfig())
      return { skipped: true, reason: "LendingPad not configured" };
    return await runLendingPadLoansSync();
  });

  results.lendingpadConditions = await step("lendingpadConditions", async () => {
    if (!hasLendingPadReadConfig())
      return { skipped: true, reason: "LendingPad not configured" };
    return await runLendingPadConditionsSync();
  });

  results.lendingpadDocuments = await step("lendingpadDocuments", async () => {
    if (!hasLendingPadReadConfig())
      return { skipped: true, reason: "LendingPad not configured" };
    return await runLendingPadDocumentsSync();
  });

  results.signals = await step("signals", async () => {
    const admin = createSupabaseAdminClient();
    const input = await fetchSignalEngineInput(admin);
    const signals = computeSignalsForLoans(input);
    const summary = await persistSignals(admin, signals);
    const leadTiers = await persistLeadTiers(admin);
    return { ...summary, loansScanned: input.loans.length, leadTiers };
  });

  results.outcomes = await step("outcomes", async () => {
    const admin = createSupabaseAdminClient();
    return await runOutcomeLabeler(admin);
  });

  results.leadTierRetention = await step("leadTierRetention", async () => {
    const admin = createSupabaseAdminClient();
    return await deliverLeadTierRetentionDigest(admin);
  });

  results.digest = await step("digest", async () => {
    const admin = createSupabaseAdminClient();
    return await deliverMorningDigest(admin);
  });

  // ── Reports — deliver via executive_notifications ─────────────────────────
  results.dailyReport = await step("dailyReport", async () => {
    const admin = createSupabaseAdminClient();
    const data = await buildDailyReport(admin);
    const body = renderDailyReportMarkdown(data);
    const { data: execs } = await admin.from("users").select("id").in("role", ["executive", "admin"]);
    const rows = (execs ?? []).map((u) => ({
      user_id: u.id as string,
      kind: "report_daily",
      title: `Daily Report — ${data.date}`,
      body,
      payload: { report_type: "daily", generated_at: new Date().toISOString() },
    }));
    if (rows.length > 0) {
      const { error } = await admin.from("executive_notifications").insert(rows);
      if (error) throw error;
    }
    return { delivered: rows.length, newLeads: data.newLeadsCount, slaRed: data.slaRedCount };
  });

  // Weekly report — Mondays only
  const todayDow = new Date().getDay();
  if (todayDow === 1) {
    results.weeklyReport = await step("weeklyReport", async () => {
      const admin = createSupabaseAdminClient();
      const data = await buildWeeklyReport(admin);
      const body = renderWeeklyReportMarkdown(data);
      const { data: execs } = await admin.from("users").select("id").in("role", ["executive", "admin"]);
      const rows = (execs ?? []).map((u) => ({
        user_id: u.id as string,
        kind: "report_weekly",
        title: `Weekly Report — ${data.weekLabel}`,
        body,
        payload: { report_type: "weekly", generated_at: new Date().toISOString() },
      }));
      if (rows.length > 0) {
        const { error } = await admin.from("executive_notifications").insert(rows);
        if (error) throw error;
      }
      return { delivered: rows.length };
    });
  }

  // Monthly report — 1st of the month only
  if (new Date().getDate() === 1) {
    results.monthlyReport = await step("monthlyReport", async () => {
      const admin = createSupabaseAdminClient();
      const data = await buildMonthlyReport(admin);
      const body = renderMonthlyReportMarkdown(data);
      const { data: execs } = await admin.from("users").select("id").in("role", ["executive", "admin"]);
      const rows = (execs ?? []).map((u) => ({
        user_id: u.id as string,
        kind: "report_monthly",
        title: `Monthly Report — ${data.monthLabel}`,
        body,
        payload: { report_type: "monthly", generated_at: new Date().toISOString() },
      }));
      if (rows.length > 0) {
        const { error } = await admin.from("executive_notifications").insert(rows);
        if (error) throw error;
      }
      return { delivered: rows.length, totalLeads: data.totalLeads, funded: data.fundedCount };
    });
  }

  const anyFailures = Object.values(results).some((r) => !r.ok);
  return NextResponse.json(
    {
      ok: !anyFailures,
      ranAt: new Date().toISOString(),
      results,
    },
    { status: anyFailures ? 207 : 200 },
  );
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
