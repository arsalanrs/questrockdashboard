/**
 * 15-minute incremental sync cron.
 *
 * Requires Vercel Pro (maxDuration up to 800s).
 * Runs every 15 minutes via vercel.json cron schedule.
 *
 * Steps:
 *   1. Shape incremental sync + change detection (writes shape_activity_log + lead_touch_log)
 *   2. SLA breach scan — fans out sla_breach notifications to all executives/admins
 *
 * Auth: Vercel Cron Bearer token or x-cron-secret header.
 */
import { NextResponse } from "next/server";
import { isCronRequestAuthorized } from "@/lib/cron-auth";
import { hasShapeApiConfig } from "@/lib/shape-api/config";
import { runShapeApiSync } from "@/lib/shape-api/sync";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { evaluateIntradayRules, INTRADAY_BREACH_LABELS } from "@/lib/sla/time-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // Vercel Pro serverless ceiling (up to 800s; 300s is safe)

type StepResult = { ok: boolean; durationMs: number; data?: unknown; error?: string };

async function step<T>(name: string, fn: () => Promise<T>): Promise<StepResult> {
  const start = Date.now();
  try {
    const data = await fn();
    return { ok: true, durationMs: Date.now() - start, data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[cron/15min] ${name} failed:`, err);
    return { ok: false, durationMs: Date.now() - start, error: msg };
  }
}

async function scanSlaBreaches(admin: ReturnType<typeof createSupabaseAdminClient>): Promise<{
  scanned: number;
  breachesFound: number;
  notificationsWritten: number;
}> {
  // Query the SLA view for red loans — we only fan out on red to avoid noise
  const { data: redLoans, error } = await admin
    .from("v_lead_sla_status")
    .select("loan_id,borrower_name,lo_name,sla_breach_type,hours_since_last_activity")
    .eq("sla_color", "red");

  if (error) throw error;
  const loans = redLoans ?? [];
  if (loans.length === 0) return { scanned: 0, breachesFound: 0, notificationsWritten: 0 };

  // Fetch all executive + admin user IDs
  const { data: execUsers, error: execError } = await admin
    .from("users")
    .select("id")
    .in("role", ["executive", "admin"]);
  if (execError) throw execError;
  const execIds = (execUsers ?? []).map((u) => u.id as string);
  if (execIds.length === 0) return { scanned: loans.length, breachesFound: loans.length, notificationsWritten: 0 };

  // De-dupe: skip loans that already have a sla_breach notification in the last hour
  // (prevents re-firing the same breach every 15 min while it's unresolved)
  const { data: recentBreaches } = await admin
    .from("executive_notifications")
    .select("payload")
    .eq("kind", "sla_breach")
    .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());

  const recentLoanIds = new Set(
    (recentBreaches ?? []).map((n) => (n.payload as { loan_id?: string }).loan_id).filter(Boolean),
  );

  const newBreaches = loans.filter((l) => !recentLoanIds.has(l.loan_id as string));
  if (newBreaches.length === 0) return { scanned: loans.length, breachesFound: loans.length, notificationsWritten: 0 };

  // Build notification rows — one per exec per new breach
  const notifRows: Array<{
    user_id: string;
    kind: string;
    title: string;
    body: string;
    payload: Record<string, unknown>;
  }> = [];

  for (const loan of newBreaches) {
    const borrower = (loan.borrower_name as string | null) || "borrower";
    const lo = (loan.lo_name as string | null) || "unassigned";
    const breachType = (loan.sla_breach_type as string | null) || "sla_violation";
    const hours = loan.hours_since_last_activity as number | null;

    for (const userId of execIds) {
      notifRows.push({
        user_id: userId,
        kind: "sla_breach",
        title: `SLA breach: ${borrower} (${lo})`,
        body: breachType.replace(/_/g, " ") + (hours ? ` — ${hours}h without activity` : ""),
        payload: {
          loan_id: loan.loan_id,
          breach_type: breachType,
          lo_name: lo,
          hours_since_last_activity: hours,
        },
      });
    }
  }

  let notificationsWritten = 0;
  for (let i = 0; i < notifRows.length; i += 100) {
    const chunk = notifRows.slice(i, i + 100);
    const { error: insErr } = await admin.from("executive_notifications").insert(chunk);
    if (insErr) throw insErr;
    notificationsWritten += chunk.length;
  }

  return { scanned: loans.length, breachesFound: loans.length, notificationsWritten };
}

async function scanIntradaySla(admin: ReturnType<typeof createSupabaseAdminClient>): Promise<{
  evaluated: number;
  breachesFound: number;
  notificationsWritten: number;
}> {
  const now = new Date();
  const todayIso = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  // Fetch today's new leads with assignment info
  const { data: todayLoans, error: loansErr } = await admin
    .from("loans")
    .select("id,borrower_first_name,borrower_last_name,assigned_loan_officer_user_id,assigned_loan_officer_name,lead_created_at")
    .gte("lead_created_at", todayIso)
    .limit(300);
  if (loansErr) throw loansErr;
  if (!todayLoans?.length) return { evaluated: 0, breachesFound: 0, notificationsWritten: 0 };

  // Touch counts for today
  const { data: touchRows } = await admin
    .from("lead_touch_log")
    .select("loan_id,touch_count")
    .eq("touch_date", now.toLocaleDateString("en-CA"));
  const touchMap = new Map<string, number>();
  for (const t of touchRows ?? []) touchMap.set(t.loan_id as string, (t.touch_count as number) ?? 0);

  // Evaluate each loan
  const breaches: Array<{ loanId: string; borrowerName: string; loName: string; breachType: string }> = [];
  for (const l of todayLoans) {
    const borrowerName = [(l.borrower_first_name as string | null), (l.borrower_last_name as string | null)].filter(Boolean).join(" ") || "borrower";
    const breach = evaluateIntradayRules(
      {
        loan_id: l.id as string,
        borrower_name: borrowerName,
        lo_name: (l.assigned_loan_officer_name as string | null) ?? null,
        lead_created_at: l.lead_created_at as string | null,
        assigned_loan_officer_user_id: (l.assigned_loan_officer_user_id as string | null) ?? null,
        touches_today: touchMap.get(l.id as string) ?? 0,
      },
      now,
    );
    if (breach) {
      breaches.push({
        loanId: l.id as string,
        borrowerName,
        loName: (l.assigned_loan_officer_name as string | null) ?? "unassigned",
        breachType: breach,
      });
    }
  }
  if (breaches.length === 0) return { evaluated: todayLoans.length, breachesFound: 0, notificationsWritten: 0 };

  // De-dupe: skip loans already notified in the last 30 min for the same breach
  const { data: recentIntradayNotifs } = await admin
    .from("executive_notifications")
    .select("payload")
    .eq("kind", "intraday_sla_breach")
    .gte("created_at", new Date(Date.now() - 30 * 60 * 1000).toISOString());
  const recentIds = new Set(
    (recentIntradayNotifs ?? []).map((n) => (n.payload as { loan_id?: string }).loan_id).filter(Boolean),
  );
  const newBreaches = breaches.filter((b) => !recentIds.has(b.loanId));
  if (newBreaches.length === 0) return { evaluated: todayLoans.length, breachesFound: breaches.length, notificationsWritten: 0 };

  // Exec/admin user IDs for fan-out
  const { data: execUsers } = await admin.from("users").select("id").in("role", ["executive", "admin", "manager"]);
  const execIds = (execUsers ?? []).map((u) => u.id as string);
  if (execIds.length === 0) return { evaluated: todayLoans.length, breachesFound: newBreaches.length, notificationsWritten: 0 };

  const notifRows: Array<{ user_id: string; kind: string; title: string; body: string; payload: Record<string, unknown> }> = [];
  for (const breach of newBreaches) {
    const label = INTRADAY_BREACH_LABELS[breach.breachType as keyof typeof INTRADAY_BREACH_LABELS] ?? breach.breachType;
    for (const userId of execIds) {
      notifRows.push({
        user_id: userId,
        kind: "intraday_sla_breach",
        title: `Intraday SLA: ${breach.borrowerName} (${breach.loName})`,
        body: label,
        payload: { loan_id: breach.loanId, breach_type: breach.breachType, lo_name: breach.loName },
      });
    }
  }

  let written = 0;
  for (let i = 0; i < notifRows.length; i += 100) {
    const { error } = await admin.from("executive_notifications").insert(notifRows.slice(i, i + 100));
    if (error) throw error;
    written += Math.min(100, notifRows.length - i);
  }

  return { evaluated: todayLoans.length, breachesFound: newBreaches.length, notificationsWritten: written };
}

async function handle(request: Request) {
  if (!isCronRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Record<string, StepResult> = {};

  // Step 1 — Shape incremental sync (includes change detection + touch log)
  results.shape = await step("shape", async () => {
    if (!hasShapeApiConfig()) return { skipped: true, reason: "Shape API not configured" };
    return await runShapeApiSync({ mode: "incremental" });
  });

  // Step 2 — SLA breach scan and notifications
  results.slaBreaches = await step("slaBreaches", async () => {
    const admin = createSupabaseAdminClient();
    return await scanSlaBreaches(admin);
  });

  // Step 3 — Intraday SLA evaluation (time-of-day rules for today's new leads)
  results.intradaySla = await step("intradaySla", async () => {
    const admin = createSupabaseAdminClient();
    return await scanIntradaySla(admin);
  });

  const anyFailures = Object.values(results).some((r) => !r.ok);
  return NextResponse.json(
    { ok: !anyFailures, ranAt: new Date().toISOString(), results },
    { status: anyFailures ? 207 : 200 },
  );
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
