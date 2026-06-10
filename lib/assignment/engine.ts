/**
 * Blitz-style assignment preview + execution (RED / ORANGE tiers).
 * Uses Supabase admin client; callers must enforce executive auth.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { configReadyForBlitz, loadAutoAssignmentConfig, type AutoAssignmentConfig } from "./config";

export type BlitzTier = "RED" | "ORANGE";

export type AssignmentPreviewRow = {
  loanId: string;
  borrowerDisplay: string | null;
  loanAmountCents: number | null;
  tier: BlitzTier;
  currentLoUserId: string | null;
  currentLoName: string | null;
  proposedUserId: string;
  proposedName: string;
  assignmentMethod: string;
  priorityScore: number;
};

type LoanRow = {
  id: string;
  borrower_first_name: string | null;
  borrower_last_name: string | null;
  loan_amount_cents: number | null;
  lead_tier: string | null;
  assigned_loan_officer_user_id: string | null;
  assigned_loan_officer_name: string | null;
  auto_assign_eligible: boolean | null;
};

function borrowerDisplay(loan: LoanRow): string | null {
  const s = [loan.borrower_first_name, loan.borrower_last_name].filter(Boolean).join(" ").trim();
  return s || null;
}

function pickRoundRobin<T>(pool: T[], idx: number): T {
  return pool[idx % pool.length]!;
}

function buildPreviewRows(
  loans: LoanRow[],
  tier: BlitzTier,
  cfg: AutoAssignmentConfig,
  nameById: Map<string, string>,
): AssignmentPreviewRow[] {
  let redIdx = 0;
  let orangeProcIdx = 0;
  let orangeLoIdx = 0;
  const rows: AssignmentPreviewRow[] = [];

  for (const loan of loans) {
    const amount = loan.loan_amount_cents ?? 0;
    if (tier === "RED") {
      const pool = cfg.redProcessorIds;
      const uid = pickRoundRobin(pool, redIdx);
      redIdx += 1;
      rows.push({
        loanId: loan.id,
        borrowerDisplay: borrowerDisplay(loan),
        loanAmountCents: loan.loan_amount_cents,
        tier,
        currentLoUserId: loan.assigned_loan_officer_user_id,
        currentLoName: loan.assigned_loan_officer_name,
        proposedUserId: uid,
        proposedName: nameById.get(uid)?.trim() || uid,
        assignmentMethod: "red_processor_round_robin",
        priorityScore: Math.floor(amount / 50_000_00),
      });
    } else {
      let useLoPool = amount >= cfg.orangeAmountThresholdCents && cfg.orangeLoIds.length > 0;
      let pool = useLoPool ? cfg.orangeLoIds : cfg.orangeProcessorIds;
      if (pool.length === 0) {
        useLoPool = !useLoPool;
        pool = useLoPool ? cfg.orangeLoIds : cfg.orangeProcessorIds;
      }
      const idx = useLoPool ? orangeLoIdx : orangeProcIdx;
      const uid = pickRoundRobin(pool, idx);
      if (useLoPool) orangeLoIdx += 1;
      else orangeProcIdx += 1;
      rows.push({
        loanId: loan.id,
        borrowerDisplay: borrowerDisplay(loan),
        loanAmountCents: loan.loan_amount_cents,
        tier,
        currentLoUserId: loan.assigned_loan_officer_user_id,
        currentLoName: loan.assigned_loan_officer_name,
        proposedUserId: uid,
        proposedName: nameById.get(uid)?.trim() || uid,
        assignmentMethod: useLoPool ? "orange_high_balance_lo" : "orange_processor",
        priorityScore: Math.floor(amount / 50_000_00),
      });
    }
  }
  return rows;
}

async function resolveUserNames(admin: SupabaseClient, cfg: AutoAssignmentConfig): Promise<Map<string, string>> {
  const userIds = new Set<string>();
  for (const id of cfg.redProcessorIds) userIds.add(id);
  for (const id of cfg.orangeProcessorIds) userIds.add(id);
  for (const id of cfg.orangeLoIds) userIds.add(id);
  const { data: users, error: uErr } = await admin
    .from("users")
    .select("id,full_name")
    .in("id", [...userIds]);
  if (uErr) throw new Error(uErr.message);
  return new Map((users ?? []).map((u) => [u.id as string, (u.full_name as string | null) ?? ""]));
}

export type PreviewResult =
  | { ok: true; rows: AssignmentPreviewRow[]; limitedTo: number; config: AutoAssignmentConfig }
  | { ok: false; error: string };

export async function previewAssignmentBlitz(
  admin: SupabaseClient,
  tier: BlitzTier,
  limit: number,
): Promise<PreviewResult> {
  const cfg = loadAutoAssignmentConfig();
  if (!configReadyForBlitz(cfg)) {
    return { ok: false, error: "Auto-assignment is disabled or EXEC_AUTO_ASSIGNMENT_JSON pools are incomplete." };
  }
  const cap = Math.min(Math.max(1, limit), cfg.maxBatchSize);

  const { data, error } = await admin
    .from("loans")
    .select(
      "id,borrower_first_name,borrower_last_name,loan_amount_cents,lead_tier,assigned_loan_officer_user_id,assigned_loan_officer_name,auto_assign_eligible",
    )
    .eq("lead_tier", tier)
    .eq("auto_assign_eligible", true)
    .order("id", { ascending: true })
    .limit(cap);
  if (error) return { ok: false, error: error.message };

  const loans = (data ?? []) as LoanRow[];
  let nameById: Map<string, string>;
  try {
    nameById = await resolveUserNames(admin, cfg);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const rows = buildPreviewRows(loans, tier, cfg, nameById);
  return { ok: true, rows, limitedTo: cap, config: cfg };
}

/** Preview for an explicit loan id list (used to validate execute). */
export async function previewAssignmentBlitzForLoanIds(
  admin: SupabaseClient,
  tier: BlitzTier,
  loanIds: string[],
): Promise<PreviewResult> {
  const cfg = loadAutoAssignmentConfig();
  if (!configReadyForBlitz(cfg)) {
    return { ok: false, error: "Auto-assignment is disabled or EXEC_AUTO_ASSIGNMENT_JSON pools are incomplete." };
  }
  const unique = [...new Set(loanIds.filter(Boolean))];
  if (unique.length === 0) return { ok: false, error: "No loan IDs provided." };
  if (unique.length > cfg.maxBatchSize) {
    return { ok: false, error: `At most ${cfg.maxBatchSize} loans per batch.` };
  }

  const { data, error } = await admin
    .from("loans")
    .select(
      "id,borrower_first_name,borrower_last_name,loan_amount_cents,lead_tier,assigned_loan_officer_user_id,assigned_loan_officer_name,auto_assign_eligible",
    )
    .in("id", unique)
    .eq("lead_tier", tier)
    .eq("auto_assign_eligible", true)
    .order("id", { ascending: true });
  if (error) return { ok: false, error: error.message };

  const loans = (data ?? []) as LoanRow[];
  let nameById: Map<string, string>;
  try {
    nameById = await resolveUserNames(admin, cfg);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const rows = buildPreviewRows(loans, tier, cfg, nameById);
  return { ok: true, rows, limitedTo: unique.length, config: cfg };
}

export type ExecuteResult =
  | { ok: true; completed: number; failed: { loanId: string; message: string }[] }
  | { ok: false; error: string };

/**
 * Applies assignments. Inserts auto_assignment_queue rows and updates loans.
 */
export async function executeAssignmentBlitz(
  admin: SupabaseClient,
  tier: BlitzTier,
  loanIds: string[],
): Promise<ExecuteResult> {
  const cfg = loadAutoAssignmentConfig();
  if (!configReadyForBlitz(cfg)) {
    return { ok: false, error: "Auto-assignment is disabled or misconfigured." };
  }
  const unique = [...new Set(loanIds.filter(Boolean))];
  if (unique.length === 0) return { ok: false, error: "No loan IDs provided." };
  if (unique.length > cfg.maxBatchSize) {
    return { ok: false, error: `At most ${cfg.maxBatchSize} loans per batch.` };
  }

  const preview = await previewAssignmentBlitzForLoanIds(admin, tier, unique);
  if (!preview.ok) return preview;
  const byId = new Map(preview.rows.map((r) => [r.loanId, r]));
  const failed: { loanId: string; message: string }[] = [];
  let completed = 0;

  for (const loanId of unique) {
    const row = byId.get(loanId);
    if (!row) {
      failed.push({
        loanId,
        message: "Loan not eligible (wrong tier, not auto_assign_eligible, or missing).",
      });
      continue;
    }

    const { data: qRow, error: qInsErr } = await admin
      .from("auto_assignment_queue")
      .insert({
        loan_id: loanId,
        tier,
        priority_score: row.priorityScore,
        assignment_method: row.assignmentMethod,
        status: "pending",
        assigned_to: row.proposedUserId,
        payload: {
          proposed_name: row.proposedName,
          borrower: row.borrowerDisplay,
        },
      })
      .select("id")
      .single();
    if (qInsErr || !qRow) {
      failed.push({ loanId, message: qInsErr?.message ?? "Queue insert failed." });
      continue;
    }
    const queueId = qRow.id as string;

    const { error: loanErr } = await admin
      .from("loans")
      .update({
        assigned_loan_officer_user_id: row.proposedUserId,
        assigned_loan_officer_name: row.proposedName,
      })
      .eq("id", loanId)
      .eq("lead_tier", tier)
      .eq("auto_assign_eligible", true);

    if (loanErr) {
      await admin
        .from("auto_assignment_queue")
        .update({ status: "failed", error_message: loanErr.message, assigned_at: new Date().toISOString() })
        .eq("id", queueId);
      failed.push({ loanId, message: loanErr.message });
      continue;
    }

    await admin
      .from("auto_assignment_queue")
      .update({ status: "completed", assigned_at: new Date().toISOString() })
      .eq("id", queueId);
    completed += 1;
  }

  return { ok: true, completed, failed };
}
