import { NextResponse } from "next/server";

import { generatePlaybookFromTemplate, generatePlaybookWithLlmPolish } from "@/lib/ai/playbooks";
import { canViewExecutiveDashboard } from "@/lib/permissions";
import { requireCurrentUser } from "@/lib/current-user";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { SignalType } from "@/lib/signals/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function loadSignalContext(admin: ReturnType<typeof createSupabaseAdminClient>, id: string) {
  const { data: signal, error: sigErr } = await admin
    .from("deal_signals")
    .select(
      "id,loan_id,signal_type,reason,priority,meta,playbook_json,lo_name,dismissed_at"
    )
    .eq("id", id)
    .maybeSingle();
  if (sigErr) throw sigErr;
  if (!signal) return null;

  const { data: loan, error: loanErr } = await admin
    .from("loans")
    .select(
      "id,borrower_first_name,borrower_last_name,loan_amount_cents,loan_type,loan_purpose,current_stage,property_state,assigned_loan_officer_name"
    )
    .eq("id", signal.loan_id as string)
    .maybeSingle();
  if (loanErr) throw loanErr;

  return { signal, loan };
}

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  let appUser: { role: string } | null = null;
  try {
    const res = await requireCurrentUser();
    appUser = res.appUser;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!appUser || !canViewExecutiveDashboard(appUser.role as "executive" | "admin")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const peek = searchParams.get("peek") === "1";
  const useLlm = searchParams.get("polish") === "1";
  const force = searchParams.get("force") === "1";

  const admin = createSupabaseAdminClient();
  const ctx = await loadSignalContext(admin, id);
  if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });

  /** Read-only: return stored playbook or null — never generate or write. */
  if (peek) {
    return NextResponse.json({
      peek: true,
      playbook: ctx.signal.playbook_json ?? null,
    });
  }

  if (!force && ctx.signal.playbook_json) {
    return NextResponse.json({ cached: true, playbook: ctx.signal.playbook_json });
  }

  const input = {
    signalType: ctx.signal.signal_type as SignalType,
    reason: ctx.signal.reason as string,
    priority: ctx.signal.priority as number,
    meta: (ctx.signal.meta ?? {}) as Record<string, unknown>,
    loan: {
      id: (ctx.loan?.id ?? ctx.signal.loan_id) as string,
      borrowerFirstName: (ctx.loan?.borrower_first_name as string | null) ?? null,
      borrowerLastName: (ctx.loan?.borrower_last_name as string | null) ?? null,
      loanAmountCents: (ctx.loan?.loan_amount_cents as number | null) ?? null,
      loanType: (ctx.loan?.loan_type as string | null) ?? null,
      loanPurpose: (ctx.loan?.loan_purpose as string | null) ?? null,
      currentStage: (ctx.loan?.current_stage as string | null) ?? null,
      propertyState: (ctx.loan?.property_state as string | null) ?? null,
      loName:
        ((ctx.loan?.assigned_loan_officer_name as string | null) ?? (ctx.signal.lo_name as string | null)) ??
        null,
    },
  };

  const playbook = useLlm
    ? await generatePlaybookWithLlmPolish(input)
    : generatePlaybookFromTemplate(input);

  const { error: upErr } = await admin
    .from("deal_signals")
    .update({ playbook_json: playbook })
    .eq("id", id);
  if (upErr) {
    console.error("Failed to cache playbook:", upErr);
  }

  return NextResponse.json({ cached: false, playbook });
}

export async function POST(request: Request, ctx: Params) {
  return GET(request, ctx);
}
