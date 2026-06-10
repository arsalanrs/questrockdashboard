/**
 * Daily digest for lead-tier retention: book cadence (6/12 mo, skip payment, FHA prep,
 * ARM period, first payment) and EPO window. Uses the same detector logic as the signal engine.
 */

import { differenceInCalendarDays } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  detectArmBookCheckinDue,
  detectBookCheckin12m,
  detectBookCheckin6m,
  detectFhaSeasoningPrep,
  detectFirstPaymentTouch,
  detectPostCloseSkipPaymentDue,
} from "@/lib/signals/lead-tier-detectors";
import type { SignalLoanRow } from "@/lib/signals/types";
import { SIGNAL_LABEL } from "@/lib/signals/types";
import type { DetectorContext } from "@/lib/signals/stall";

type ExecUser = { id: string };

type LoanDigestRow = {
  id: string;
  borrower_first_name: string | null;
  borrower_last_name: string | null;
  current_stage: string | null;
  status_raw: string | null;
  closed_at: string | null;
  funded_at: string | null;
  closing_date: string | null;
  do_not_contact: boolean | null;
  epo_date: string | null;
  epo_window_activated: boolean | null;
  loan_type: string | null;
  note_date: string | null;
  first_payment_date: string | null;
  arm_first_reset_date: string | null;
  loan_amount_cents: number | null;
  credit_score_mid: number | null;
};

const DIGEST_DETECTORS = [
  detectBookCheckin6m,
  detectBookCheckin12m,
  detectPostCloseSkipPaymentDue,
  detectFirstPaymentTouch,
  detectFhaSeasoningPrep,
  detectArmBookCheckinDue,
] as const;

function rowToSignalLoan(row: LoanDigestRow): SignalLoanRow {
  return {
    id: row.id,
    current_stage: row.current_stage,
    status_raw: row.status_raw,
    loan_amount_cents: row.loan_amount_cents,
    appraisal_ordered_at: null,
    closed_at: row.closed_at,
    closing_date: row.closing_date,
    esign_returned_at: null,
    esign_requested_at: null,
    application_completed_at: null,
    submitted_to_processing_at: null,
    submitted_to_uw_at: null,
    ctc_at: null,
    lead_created_at: null,
    assigned_loan_officer_user_id: null,
    assigned_loan_officer_name: null,
    borrower_first_name: row.borrower_first_name,
    borrower_last_name: row.borrower_last_name,
    loan_type: row.loan_type,
    loan_purpose: null,
    shape_record_id: null,
    lendingpad_loan_uuid: null,
    is_restructure_hold: null,
    note_rate_bps: null,
    original_rate_bps: null,
    property_value_cents: null,
    current_loan_balance_cents: null,
    ltv_bps: null,
    cltv_bps: null,
    dti_bps: null,
    credit_score_mid: row.credit_score_mid,
    is_veteran: null,
    arm_first_reset_date: row.arm_first_reset_date,
    arm_index: null,
    arm_margin_bps: null,
    do_not_contact: row.do_not_contact,
    last_contacted_at: null,
    funded_at: row.funded_at,
    loan_age_months: null,
    lead_tier: null,
    epo_date: row.epo_date,
    epo_window_activated: row.epo_window_activated,
    reengagement_8month_completed_at: null,
    appraisal_received_at: null,
    first_payment_date: row.first_payment_date,
    note_date: row.note_date,
  };
}

function borrowerLabel(row: LoanDigestRow): string {
  const s = [row.borrower_first_name, row.borrower_last_name].filter(Boolean).join(" ").trim();
  return s || "Borrower";
}

function startOfUtcDay(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0)).toISOString();
}

async function alreadyDigestToday(admin: SupabaseClient, userId: string): Promise<boolean> {
  const start = startOfUtcDay();
  const { count, error } = await admin
    .from("executive_notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("kind", "lead_tier_retention_digest")
    .gte("created_at", start);
  if (error) throw error;
  return (count ?? 0) > 0;
}

export type BookCadenceBreakdown = {
  book_checkin_6m: number;
  book_checkin_12m: number;
  post_close_skip_payment_due: number;
  first_payment_touch: number;
  fha_seasoning_prep: number;
  arm_book_checkin_due: number;
};

export type LeadTierRetentionSummary = {
  /** Sum of all book-cadence detector hits (a loan may contribute more than once). */
  bookCadenceDueCount: number;
  bookCadenceBreakdown: BookCadenceBreakdown;
  epoWindowCount: number;
  generatedAt: string;
};

export async function buildLeadTierRetentionSummary(
  admin: SupabaseClient,
  now = new Date(),
): Promise<
  LeadTierRetentionSummary & { bookCadenceLines: string[]; epoLines: string[] }
> {
  const { data, error } = await admin
    .from("loans")
    .select(
      "id,borrower_first_name,borrower_last_name,current_stage,status_raw,closed_at,funded_at,closing_date,do_not_contact,epo_date,epo_window_activated,loan_type,note_date,first_payment_date,arm_first_reset_date,loan_amount_cents,credit_score_mid",
    )
    .limit(15000);
  if (error) throw error;

  const rows = (data ?? []) as LoanDigestRow[];
  const breakdown: BookCadenceBreakdown = {
    book_checkin_6m: 0,
    book_checkin_12m: 0,
    post_close_skip_payment_due: 0,
    first_payment_touch: 0,
    fha_seasoning_prep: 0,
    arm_book_checkin_due: 0,
  };
  const bookCadenceLines: string[] = [];
  const epoLines: string[] = [];
  let bookCadenceDueCount = 0;
  let epoWindowCount = 0;

  const ctx: DetectorContext = {
    now,
    latestStageEvent: new Map(),
    latestEventByLoanStage: new Map(),
    openConditionsByLoan: new Map(),
  };

  for (const row of rows) {
    if (row.do_not_contact === true) continue;

    const loan = rowToSignalLoan(row);
    for (const det of DIGEST_DETECTORS) {
      const sig = det(loan, ctx);
      if (!sig) continue;
      const k = sig.signalType as keyof BookCadenceBreakdown;
      if (k in breakdown) {
        breakdown[k] += 1;
        bookCadenceDueCount += 1;
        if (bookCadenceLines.length < 48) {
          const label = SIGNAL_LABEL[sig.signalType] ?? sig.signalType;
          bookCadenceLines.push(`• ${borrowerLabel(row)} — ${label}: ${sig.reason}`);
        }
      }
    }

    if (row.epo_date && row.epo_window_activated !== true) {
      const epo = new Date(row.epo_date);
      if (!Number.isNaN(epo.getTime())) {
        const daysUntil = differenceInCalendarDays(epo, now);
        if (daysUntil >= 30 && daysUntil <= 60) {
          epoWindowCount += 1;
          if (epoLines.length < 40) {
            epoLines.push(`• ${borrowerLabel(row)} — EPO in ~${daysUntil}d (${row.epo_date})`);
          }
        }
      }
    }
  }

  return {
    bookCadenceDueCount,
    bookCadenceBreakdown: breakdown,
    epoWindowCount,
    generatedAt: now.toISOString(),
    bookCadenceLines,
    epoLines,
  };
}

export async function deliverLeadTierRetentionDigest(admin: SupabaseClient): Promise<{
  execsNotified: number;
  summary: LeadTierRetentionSummary;
}> {
  const built = await buildLeadTierRetentionSummary(admin);
  const summary: LeadTierRetentionSummary = {
    bookCadenceDueCount: built.bookCadenceDueCount,
    bookCadenceBreakdown: built.bookCadenceBreakdown,
    epoWindowCount: built.epoWindowCount,
    generatedAt: built.generatedAt,
  };

  if (built.bookCadenceDueCount === 0 && built.epoWindowCount === 0) {
    return { execsNotified: 0, summary };
  }

  const { data: execs, error: execErr } = await admin
    .from("users")
    .select("id")
    .in("role", ["executive", "admin"]);
  if (execErr) throw execErr;

  const lines: string[] = [];
  const { bookCadenceBreakdown: b } = built;
  lines.push(
    `**Retention snapshot** — ${built.bookCadenceDueCount} book-cadence touchpoints · ${built.epoWindowCount} EPO windows (30–60d)`,
  );
  lines.push(
    `Breakdown — 6mo: ${b.book_checkin_6m} · 12mo: ${b.book_checkin_12m} · skip pay: ${b.post_close_skip_payment_due} · 1st pmt: ${b.first_payment_touch} · FHA prep: ${b.fha_seasoning_prep} · ARM: ${b.arm_book_checkin_due}`,
  );
  lines.push("");
  if (built.bookCadenceLines.length > 0) {
    lines.push("**Book cadence & funded-book outreach**");
    lines.push(...built.bookCadenceLines);
    lines.push("");
  }
  if (built.epoLines.length > 0) {
    lines.push("**EPO window**");
    lines.push(...built.epoLines);
  }

  const body = lines.join("\n");
  const insertRows: {
    user_id: string;
    kind: string;
    title: string;
    body: string;
    payload: Record<string, unknown>;
  }[] = [];

  for (const u of (execs ?? []) as ExecUser[]) {
    if (await alreadyDigestToday(admin, u.id)) continue;
    insertRows.push({
      user_id: u.id,
      kind: "lead_tier_retention_digest",
      title: `Lead tier retention — ${built.bookCadenceDueCount + built.epoWindowCount} follow-ups`,
      body,
      payload: {
        ...summary,
        truncatedBookCadence: Math.max(0, built.bookCadenceDueCount - built.bookCadenceLines.length),
        truncatedEpo: Math.max(0, built.epoWindowCount - built.epoLines.length),
      },
    });
  }

  if (insertRows.length === 0) {
    return { execsNotified: 0, summary };
  }

  const { error: insErr } = await admin.from("executive_notifications").insert(insertRows);
  if (insErr) throw insErr;
  return { execsNotified: insertRows.length, summary };
}
