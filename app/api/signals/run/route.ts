import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isCronRequestAuthorized } from "@/lib/cron-auth";
import { requireCurrentUser } from "@/lib/current-user";
import { canViewExecutiveDashboard } from "@/lib/permissions";
import { computeSignalsForLoans } from "@/lib/signals/run";
import { fetchSignalEngineInput, persistSignals } from "@/lib/signals/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Compute deal signals and persist them.
 *
 * Auth: either a cron secret (Vercel Cron / manual script) or an executive
 * user session. Non-execs get 403.
 *
 * Query params:
 *   ?dry=1  — compute and return the signal list without persisting.
 */
export async function POST(request: Request) {
  const isCron = isCronRequestAuthorized(request);
  let userGate = false;
  if (!isCron) {
    try {
      const { appUser } = await requireCurrentUser();
      userGate = canViewExecutiveDashboard(appUser.role);
    } catch {
      userGate = false;
    }
    if (!userGate) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const { searchParams } = new URL(request.url);
  const dry = searchParams.get("dry") === "1";

  try {
    const admin = createSupabaseAdminClient();
    const input = await fetchSignalEngineInput(admin);
    const signals = computeSignalsForLoans(input);

    if (dry) {
      return NextResponse.json({
        dry: true,
        loansScanned: input.loans.length,
        signalsComputed: signals.length,
        topN: signals.slice(0, 50),
      });
    }

    const summary = await persistSignals(admin, signals);
    return NextResponse.json({
      ok: true,
      ...summary,
      loansScanned: input.loans.length,
    });
  } catch (err) {
    console.error("signals/run error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return POST(request);
}
