/**
 * RED / ORANGE / GREEN lead tier classification (Supabase-only).
 *
 * - GREEN: funded / closed book (same idea as refi back-book eligibility).
 * - ORANGE: active LOS pipeline (registered → closing), excluding dead deals.
 * - RED: early funnel (lead through e-sign / pre-submission) and unclassified active leads.
 * - null: dispositions (denied, DNC, withdrawn, etc.) — exclude from tier campaigns.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { isFundedBackBookLoan } from "./refi";
import type { SignalLoanRow } from "./types";

export type LeadTier = "RED" | "ORANGE" | "GREEN";

const ORANGE_STAGES = new Set<string>([
  "registered",
  "processing",
  "submission",
  "underwriting",
  "conditions",
  "approval_conditions",
  "clear_to_close",
  "closing",
]);

const RED_STAGES = new Set<string>(["lead", "application", "verification", "esign_out"]);

function isDeadDisposition(loan: SignalLoanRow): boolean {
  if (loan.do_not_contact === true) return true;
  const s = (loan.status_raw ?? "").trim().toLowerCase();
  if (!s) return false;
  if (s.startsWith("denied")) return true;
  if (s.includes("do not call")) return true;
  if (s === "bad lead" || s === "bad contact info") return true;
  if (s === "not interested" || s === "turndown" || s === "no sale") return true;
  if (s === "withdrawn" || s.includes("withdraw")) return true;
  if (s === "long term nurture" && loan.closed_at) return true;
  return false;
}

/**
 * Human-readable reason when `lead_tier` is null: dead disposition rules, stale DB, or edge case.
 * Used in executive UI for the "Unset" bucket drill-down (not OpenAI — rule-based).
 */
export function explainLeadTierNullReason(loan: SignalLoanRow): string {
  const computed = classifyLoanTier(loan);
  if (computed !== null) {
    return `Tier should be ${computed} after refresh — classification hasn’t been saved to this row yet.`;
  }
  if (loan.do_not_contact === true) return "Do not contact — excluded from tier campaigns.";
  const s = (loan.status_raw ?? "").trim();
  const sl = s.toLowerCase();
  if (!sl) return "No status on file — treated as inactive for tiers until status/stage is set.";
  if (sl.startsWith("denied")) return `Disposition: denied — ${s}`;
  if (sl.includes("do not call")) return `Disposition: do not call — ${s}`;
  if (sl === "bad lead" || sl === "bad contact info") return `Disposition: bad lead / contact — ${s}`;
  if (sl === "not interested" || sl === "turndown" || sl === "no sale") return `Disposition: not proceeding — ${s}`;
  if (sl === "withdrawn" || sl.includes("withdraw")) return `Disposition: withdrawn — ${s}`;
  if (sl === "long term nurture" && loan.closed_at) return "Long-term nurture with close date — treated as inactive.";
  return `Inactive disposition — ${s || "see status"}`;
}

export function classifyLoanTier(loan: SignalLoanRow): LeadTier | null {
  if (isDeadDisposition(loan)) return null;
  if (isFundedBackBookLoan(loan)) return "GREEN";

  const stage = loan.current_stage ?? "";
  if (ORANGE_STAGES.has(stage)) return "ORANGE";
  if (RED_STAGES.has(stage)) return "RED";

  // LP-only rows sometimes have stage null but status_raw — treat in-flight Shape statuses as ORANGE
  const raw = (loan.status_raw ?? "").trim();
  if (
    raw &&
    [
      "Piped",
      "Appraisal Ordered",
      "Appraisal Received",
      "Registered",
      "Processing",
      "Submitted to UW",
      "Approved with Conditions",
      "Conditions Submitted",
      "Incomplete (ReSubmission)",
      "Clear to Close",
      "Closed",
    ].includes(raw) &&
    !isFundedBackBookLoan(loan)
  ) {
    if (raw === "Closed" && !loan.closed_at && !loan.funded_at) return "ORANGE";
    if (raw !== "Closed") return "ORANGE";
  }

  return "RED";
}

const TIER_SELECT =
  "id,current_stage,status_raw,closed_at,funded_at,do_not_contact,last_contacted_at,lead_created_at,lead_tier";

/**
 * Recompute `lead_tier` + timestamps for all loans (paged). Uses batched updates.
 */
export async function persistLeadTiers(admin: SupabaseClient): Promise<{ updated: number; scanned: number }> {
  const nowIso = new Date().toISOString();
  let scanned = 0;
  let updated = 0;
  const pageSize = 500;

  for (let from = 0; from < 100_000; from += pageSize) {
    const { data, error } = await admin.from("loans").select(TIER_SELECT).range(from, from + pageSize - 1);
    if (error) throw error;
    const chunk = (data ?? []) as unknown as SignalLoanRow[];
    if (chunk.length === 0) break;
    scanned += chunk.length;

    for (const row of chunk) {
      const tier = classifyLoanTier(row);
      const prev = (row as { lead_tier?: string | null }).lead_tier ?? null;
      const patch =
        prev === tier
          ? { last_tier_eval_at: nowIso }
          : { lead_tier: tier, lead_tier_updated_at: nowIso, last_tier_eval_at: nowIso };
      const { error: uErr } = await admin.from("loans").update(patch).eq("id", row.id);
      if (!uErr) updated += 1;
    }

    if (chunk.length < pageSize) break;
  }

  return { updated, scanned };
}
