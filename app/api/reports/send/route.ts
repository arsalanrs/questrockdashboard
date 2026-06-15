/**
 * Report delivery endpoint.
 *
 * Writes a report notification row to executive_notifications for every
 * executive and admin user so it appears in their in-app notification feed.
 *
 * Called by the nightly cron:
 *   ?type=daily   — every night
 *   ?type=weekly  — Mondays only
 *   ?type=monthly — 1st of month only
 *
 * Can also be triggered manually from the executive dashboard or via curl.
 *
 * Auth: Vercel Cron Bearer token, x-cron-secret, or executive session.
 */
import { NextResponse } from "next/server";
import { isCronRequestAuthorized } from "@/lib/cron-auth";
import { requireCurrentUser } from "@/lib/current-user";
import { canViewExecutiveDashboard } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildDailyReport, renderDailyReportMarkdown } from "@/lib/reports/daily";
import { buildWeeklyReport, renderWeeklyReportMarkdown } from "@/lib/reports/weekly";
import { buildMonthlyReport, renderMonthlyReportMarkdown } from "@/lib/reports/monthly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReportType = "daily" | "weekly" | "monthly";

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

  const { searchParams } = new URL(request.url);
  const type = (searchParams.get("type") ?? "daily") as ReportType;

  if (!["daily", "weekly", "monthly"].includes(type)) {
    return NextResponse.json({ error: "Invalid type. Use daily, weekly, or monthly." }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  // Build the report body
  let title: string;
  let body: string;
  const kind = `report_${type}` as const;

  try {
    if (type === "daily") {
      const data = await buildDailyReport(admin);
      title = `Daily Report — ${data.date}`;
      body = renderDailyReportMarkdown(data);
    } else if (type === "weekly") {
      const data = await buildWeeklyReport(admin);
      title = `Weekly Report — ${data.weekLabel}`;
      body = renderWeeklyReportMarkdown(data);
    } else {
      const data = await buildMonthlyReport(admin);
      title = `Monthly Report — ${data.monthLabel}`;
      body = renderMonthlyReportMarkdown(data);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[reports/send] Failed to build ${type} report:`, err);
    return NextResponse.json({ error: `Report build failed: ${msg}` }, { status: 500 });
  }

  // Deliver to all executives + admins
  const { data: execUsers, error: execError } = await admin
    .from("users")
    .select("id")
    .in("role", ["executive", "admin"]);
  if (execError) {
    return NextResponse.json({ error: `Failed to fetch exec users: ${execError.message}` }, { status: 500 });
  }

  const notifRows = (execUsers ?? []).map((u) => ({
    user_id: u.id as string,
    kind,
    title,
    body,
    payload: { report_type: type, generated_at: new Date().toISOString() },
  }));

  if (notifRows.length === 0) {
    return NextResponse.json({ ok: true, delivered: 0, message: "No executive users found." });
  }

  const { error: insertError } = await admin.from("executive_notifications").insert(notifRows);
  if (insertError) {
    return NextResponse.json({ error: `Failed to insert notifications: ${insertError.message}` }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    type,
    title,
    delivered: notifRows.length,
    generatedAt: new Date().toISOString(),
  });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
