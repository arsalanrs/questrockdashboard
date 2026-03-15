import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { makeClosingDate, makeConditions, makeStageEvents, PIPELINE, makeBorrower, makeLoanAmountCents, makeState } from "@/lib/mock/loan-mock";

type PipelineStage = (typeof PIPELINE)[number];

function pickStage(): PipelineStage {
  return PIPELINE[Math.floor(Math.random() * PIPELINE.length)]!;
}

export async function mockEnrichLoans(params: { importBatchId?: string; limit?: number } = {}) {
  const admin = createSupabaseAdminClient();
  const now = new Date();

  let query = admin.from("loans").select("id,current_stage,closing_date,assigned_loan_officer_user_id,assigned_loan_officer_name");
  if (params.importBatchId) query = query.eq("import_batch_id", params.importBatchId);
  if (params.limit) query = query.limit(params.limit);

  const { data: loans, error } = await query;
  if (error) throw error;

  let enriched = 0;
  for (const loan of loans ?? []) {
    const currentStage = (loan.current_stage as PipelineStage | null) ?? pickStage();

    // Ensure stage set
    if (!loan.current_stage) {
      const { error: updErr } = await admin.from("loans").update({ current_stage: currentStage }).eq("id", loan.id);
      if (updErr) throw updErr;
    }

    // Stage events (only if none exist)
    const { data: existingEvents, error: evErr } = await admin
      .from("loan_stage_events")
      .select("id")
      .eq("loan_id", loan.id)
      .limit(1);
    if (evErr) throw evErr;

    if (!existingEvents || existingEvents.length === 0) {
      const events = makeStageEvents(now, currentStage).map((e) => ({ loan_id: loan.id, stage: e.stage, entered_at: e.entered_at }));
      const { error: insErr } = await admin.from("loan_stage_events").insert(events);
      if (insErr) throw insErr;
    }

    // Conditions (only if none exist)
    const { data: existingConds, error: condErr } = await admin
      .from("conditions")
      .select("id")
      .eq("loan_id", loan.id)
      .limit(1);
    if (condErr) throw condErr;

    if (!existingConds || existingConds.length === 0) {
      const conds = makeConditions(currentStage).map((c) => ({ loan_id: loan.id, title: c.title, status: c.status }));
      if (conds.length) {
        const { error: insErr } = await admin.from("conditions").insert(conds);
        if (insErr) throw insErr;
      }
    }

    // Closing date
    if (!loan.closing_date) {
      const closingDate = makeClosingDate(now, currentStage);
      const { error: updErr } = await admin.from("loans").update({ closing_date: closingDate }).eq("id", loan.id);
      if (updErr) throw updErr;
    }

    enriched += 1;
  }

  return { enriched };
}

export async function generateMockLoans(params: { count?: number } = {}) {
  const admin = createSupabaseAdminClient();
  const now = new Date();
  const count = params.count ?? 100;

  const { data: users, error: usersError } = await admin
    .from("users")
    .select("id,full_name,role")
    .in("role", ["loan_officer", "manager", "executive"]);
  if (usersError) throw usersError;

  const loUsers = (users ?? []).map((u) => ({ id: u.id as string, full_name: u.full_name as string }));

  const loansPayload = Array.from({ length: count }).map(() => {
    const stage = pickStage();
    const borrower = makeBorrower();
    const state = makeState();
    const assignee = loUsers.length ? loUsers[Math.floor(Math.random() * loUsers.length)]! : null;

    return {
      borrower_first_name: borrower.first,
      borrower_last_name: borrower.last,
      property_state: state,
      mailing_state: state,
      loan_amount_cents: makeLoanAmountCents(),
      loan_amount_raw: null,
      status_raw: "MOCK",
      current_stage: stage,
      source: "MOCK",
      utm_campaign: null,
      channel: null,
      lead_created_at: now.toISOString(),
      closing_date: makeClosingDate(now, stage),
      assigned_loan_officer_user_id: assignee?.id ?? null,
      assigned_loan_officer_name: assignee?.full_name ?? null,
    };
  });

  const { data: inserted, error: insErr } = await admin.from("loans").insert(loansPayload).select("id,current_stage");
  if (insErr) throw insErr;

  // Insert events + conditions
  for (const loan of inserted ?? []) {
    const stage = loan.current_stage as PipelineStage;
    const events = makeStageEvents(now, stage).map((e) => ({ loan_id: loan.id, stage: e.stage, entered_at: e.entered_at }));
    const conds = makeConditions(stage).map((c) => ({ loan_id: loan.id, title: c.title, status: c.status }));
    if (events.length) {
      const { error } = await admin.from("loan_stage_events").insert(events);
      if (error) throw error;
    }
    if (conds.length) {
      const { error } = await admin.from("conditions").insert(conds);
      if (error) throw error;
    }
  }

  return { created: inserted?.length ?? 0 };
}

