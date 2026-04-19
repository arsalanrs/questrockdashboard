/**
 * Chained nightly cron — combines every sync/signal/notification job into a single
 * Vercel cron so we fit inside the Hobby plan's 2-cron limit.
 *
 * Order matters:
 *   1. Shape incremental sync (updatedDateRange from watermark)
 *   2. LendingPad loans + conditions + documents (depends on Shape for shape_record_id links)
 *   3. Signal engine run (depends on fresh loans)
 *   4. Outcome labeler (depends on signals)
 *   5. Morning digest (depends on signals + notifications)
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
import { runOutcomeLabeler } from "@/lib/signals/outcomes";
import { deliverMorningDigest } from "@/lib/notifications/morning-digest";

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
    return { ...summary, loansScanned: input.loans.length };
  });

  results.outcomes = await step("outcomes", async () => {
    const admin = createSupabaseAdminClient();
    return await runOutcomeLabeler(admin);
  });

  results.digest = await step("digest", async () => {
    const admin = createSupabaseAdminClient();
    return await deliverMorningDigest(admin);
  });

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
