/**
 * Tool definitions for the exec AI chat.
 *
 * Each tool exposes a narrow, typed Supabase query to the LLM (no raw SQL from
 * the model). Tools are executed server-side with the admin client, but only
 * after the caller has been verified as executive/admin by the route handler.
 */

import { differenceInCalendarDays } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";

import { previewAssignmentBlitz, executeAssignmentBlitz, type BlitzTier } from "@/lib/assignment/engine";
import { buildLeadTierRetentionSummary } from "@/lib/notifications/lead-tier-retention";
import {
  BOOK_RECENT_CLOSE_SUPPRESS_DAYS,
  shouldSuppressRefiForFhaSeasoning,
} from "@/lib/signals/book-outreach-policy";
import { persistLeadTiers } from "@/lib/signals/tier-classifier";
import type { SignalLoanRow } from "@/lib/signals/types";

/** OpenAI function-calling tool schema. */
export type ToolSpec = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ToolHandler = (args: Record<string, unknown>, admin: SupabaseClient) => Promise<unknown>;

/* ------------------------------------------------------------------ */
/*  Shared select lists                                                */
/* ------------------------------------------------------------------ */

const LOAN_CARD_COLS =
  "id,shape_record_id,current_stage,status_raw,loan_amount_cents,closing_date,closed_at,funded_at,borrower_first_name,borrower_last_name,assigned_loan_officer_name,loan_type,loan_purpose,lead_created_at,lendingpad_loan_uuid,note_rate_bps,ltv_bps,cltv_bps,arm_first_reset_date,lead_tier,credit_score_mid,first_payment_date,note_date";

const DEAL_FIND_COLS =
  "id,shape_record_id,status_raw,current_stage,borrower_first_name,borrower_last_name,assigned_loan_officer_name,loan_type,loan_purpose,lead_created_at,last_contacted_at,closed_at,funded_at,note_rate_bps,ltv_bps,cltv_bps,arm_first_reset_date,loan_amount_cents,do_not_contact,lendingpad_loan_uuid,note_date,first_payment_date,closing_date";

const NO_GO_NEW_LEAD_DAYS = 7;
const NO_GO_ACTIVE_CONTACT_DAYS = 3;
const ARM_RESET_WINDOW_DAYS = 180;
/** Rate stored like refi detectors: percent ≈ bps/100 (700 → 7.00%). */
const CONV_RATE_OVER_BPS = 700;
const FHA_RATE_OVER_BPS = 600;
const LTV_OVER_75_BPS = 7500;
const CONV_LTV_OVER_80_BPS = 8000;
const CLTV_SUBORDINATE_GAP_BPS = 25;

const PIPELINE_STAGES = [
  "lead",
  "application",
  "verification",
  "esign_out",
  "registered",
  "processing",
  "submission",
  "underwriting",
  "conditions",
  "approval_conditions",
  "clear_to_close",
  "closing",
];

type LoanRowRecord = Record<string, unknown>;

function borrowerDisplayFromRow(row: LoanRowRecord): string | null {
  const a = String(row.borrower_first_name ?? "").trim();
  const b = String(row.borrower_last_name ?? "").trim();
  const s = [a, b].filter(Boolean).join(" ").trim();
  return s || null;
}

function isClosedOrFundedLoan(row: LoanRowRecord): boolean {
  if (row.current_stage === "funded") return true;
  if (row.closed_at) return true;
  if (row.funded_at) return true;
  const st = String(row.status_raw ?? "").toLowerCase();
  return st === "closed" || st === "funded" || st === "purchased";
}

function isPipedNotClosed(row: LoanRowRecord): boolean {
  if (isClosedOrFundedLoan(row)) return false;
  const s = String(row.status_raw ?? "").toLowerCase();
  if (!s) return false;
  return s.includes("piped") && !s.includes("not piped");
}

function normLoanType(loanType: unknown): string {
  return String(loanType ?? "")
    .trim()
    .toUpperCase();
}

function isConventionalType(lt: string): boolean {
  return lt.includes("CONV") || lt === "CONVENTIONAL";
}

function isFhaType(lt: string): boolean {
  return lt.includes("FHA");
}

function armInResetWindow(row: LoanRowRecord, now: Date): boolean {
  const raw = row.arm_first_reset_date;
  if (raw == null || raw === "") return false;
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) return false;
  const daysUntil = differenceInCalendarDays(d, now);
  if (daysUntil >= 0 && daysUntil <= ARM_RESET_WINDOW_DAYS) return true;
  if (daysUntil < 0 && daysUntil >= -60) return true;
  return false;
}

function isNoGoDealCandidate(row: LoanRowRecord, now: Date): boolean {
  if (row.do_not_contact === true) return true;
  const leadRaw = row.lead_created_at;
  if (leadRaw) {
    const lead = new Date(String(leadRaw));
    if (!Number.isNaN(lead.getTime()) && differenceInCalendarDays(now, lead) < NO_GO_NEW_LEAD_DAYS) {
      return true;
    }
  }
  const contactedRaw = row.last_contacted_at;
  if (contactedRaw) {
    const contacted = new Date(String(contactedRaw));
    if (
      !Number.isNaN(contacted.getTime()) &&
      differenceInCalendarDays(now, contacted) < NO_GO_ACTIVE_CONTACT_DAYS
    ) {
      return true;
    }
  }
  const endRaw = row.closed_at ?? row.funded_at;
  if (endRaw) {
    const end = new Date(String(endRaw));
    if (
      !Number.isNaN(end.getTime()) &&
      differenceInCalendarDays(now, end) < BOOK_RECENT_CLOSE_SUPPRESS_DAYS
    ) {
      return true;
    }
  }
  if (isClosedOrFundedLoan(row) && isFhaType(normLoanType(row.loan_type))) {
    const loan = row as unknown as SignalLoanRow;
    if (shouldSuppressRefiForFhaSeasoning(loan, now)) return true;
  }
  return false;
}

function scoreDealLoan(row: LoanRowRecord, now: Date): { tags: string[]; reasons: string[] } {
  const tags: string[] = [];
  const reasons: string[] = [];
  const lt = normLoanType(row.loan_type);
  const noteBps = row.note_rate_bps;
  const noteNum = typeof noteBps === "number" ? noteBps : noteBps != null ? Number(noteBps) : null;

  if (isPipedNotClosed(row)) {
    tags.push("piped_not_closed");
    reasons.push("Pipeline status indicates Piped but loan is not closed/funded.");
  }

  if (noteNum != null && Number.isFinite(noteNum) && lt) {
    if (isConventionalType(lt) && noteNum > CONV_RATE_OVER_BPS) {
      tags.push("conventional_rate_high");
      reasons.push(
        `Conventional note rate ${(noteNum / 100).toFixed(2)}% (threshold > ${(CONV_RATE_OVER_BPS / 100).toFixed(2)}%).`,
      );
    }
    if (isFhaType(lt) && noteNum > FHA_RATE_OVER_BPS) {
      tags.push("fha_rate_high");
      reasons.push(
        `FHA note rate ${(noteNum / 100).toFixed(2)}% (threshold > ${(FHA_RATE_OVER_BPS / 100).toFixed(2)}%).`,
      );
    }
  }

  const ltvBps = row.ltv_bps;
  const ltvNum = typeof ltvBps === "number" ? ltvBps : ltvBps != null ? Number(ltvBps) : null;
  if (ltvNum != null && Number.isFinite(ltvNum) && ltvNum > LTV_OVER_75_BPS) {
    tags.push("ltv_above_75");
    reasons.push(`LTV ${(ltvNum / 100).toFixed(2)}% (above 75%).`);
  }

  if (ltvNum != null && Number.isFinite(ltvNum) && isConventionalType(lt) && ltvNum > CONV_LTV_OVER_80_BPS) {
    tags.push("conventional_high_ltv_likely_pmi");
    reasons.push(
      `Conventional LTV ${(ltvNum / 100).toFixed(2)}% — likely PMI; verify in file (no MI flag in DB).`,
    );
  }

  const cltvBps = row.cltv_bps;
  const cltvNum = typeof cltvBps === "number" ? cltvBps : cltvBps != null ? Number(cltvBps) : null;
  if (
    cltvNum != null &&
    ltvNum != null &&
    Number.isFinite(cltvNum) &&
    Number.isFinite(ltvNum) &&
    cltvNum > ltvNum + CLTV_SUBORDINATE_GAP_BPS
  ) {
    tags.push("combined_ltv_subordinate");
    reasons.push(
      `CLTV ${(cltvNum / 100).toFixed(2)}% vs LTV ${(ltvNum / 100).toFixed(2)}% — possible 2nd/subordinate; cash-out refi angle.`,
    );
  }

  if (armInResetWindow(row, now)) {
    tags.push("arm_reset_window");
    reasons.push("First rate adjustment date is within the watch window (≈6 mo / recent reset).");
  }

  return { tags, reasons };
}

async function borrowerNamesByLoanIds(
  admin: SupabaseClient,
  loanIds: string[],
): Promise<Map<string, { borrower_first_name: string | null; borrower_last_name: string | null }>> {
  const out = new Map<string, { borrower_first_name: string | null; borrower_last_name: string | null }>();
  const unique = [...new Set(loanIds.filter(Boolean))];
  const chunkSize = 150;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const { data, error } = await admin
      .from("loans")
      .select("id,borrower_first_name,borrower_last_name")
      .in("id", chunk);
    if (error) throw error;
    for (const r of data ?? []) {
      out.set(r.id as string, {
        borrower_first_name: (r.borrower_first_name as string | null) ?? null,
        borrower_last_name: (r.borrower_last_name as string | null) ?? null,
      });
    }
  }
  return out;
}

async function enrichSignalRowsWithBorrowers<
  T extends { loan_id: string | null | undefined },
>(admin: SupabaseClient, rows: T[]): Promise<Array<T & { borrower_display: string | null; borrower_first_name: string | null; borrower_last_name: string | null }>> {
  const ids = rows.map((r) => r.loan_id).filter((x): x is string => Boolean(x));
  const map = await borrowerNamesByLoanIds(admin, ids);
  return rows.map((r) => {
    const b = r.loan_id ? map.get(r.loan_id) : undefined;
    const first = b?.borrower_first_name ?? null;
    const last = b?.borrower_last_name ?? null;
    const borrower_display =
      [first, last].filter(Boolean).join(" ").trim() || null;
    return {
      ...r,
      borrower_first_name: first,
      borrower_last_name: last,
      borrower_display,
    };
  });
}

/* ------------------------------------------------------------------ */
/*  Tool: listLoans                                                    */
/* ------------------------------------------------------------------ */

const listLoansSpec: ToolSpec = {
  type: "function",
  function: {
    name: "listLoans",
    description:
      "List loans with optional filters (LO, stage(s), status, loan type FHA/VA/CONVENTIONAL, note rate bps, ARM reset horizon, amount/FICO, lead tier RED/ORANGE/GREEN, closing this month, ORANGE pipeline-hot CTC/closing with recent stage activity). Returns up to `limit` rows sorted by lead_created_at desc. Use for filtered exec questions instead of guessing.",
    parameters: {
      type: "object",
      properties: {
        lo: { type: "string", description: "Loan-officer full name (matches assigned_loan_officer_name)." },
        stage: { type: "string", description: "Single pipeline stage: " + PIPELINE_STAGES.join(", ") },
        currentStageIn: {
          type: "array",
          items: { type: "string" },
          description: "If set, loan's current_stage must be one of these (overrides single `stage`).",
        },
        status: { type: "string", description: "Raw status from Shape (e.g. 'Approved', 'Piped')." },
        loanType: {
          type: "string",
          enum: ["FHA", "VA", "CONVENTIONAL"],
          description: "Broad loan type bucket (matches loan_type text).",
        },
        minNoteRateBps: { type: "number", description: "Minimum note_rate_bps (e.g. 600 = 6.00%)." },
        maxNoteRateBps: { type: "number", description: "Maximum note_rate_bps." },
        armDueWithinDays: {
          type: "number",
          description: "Only loans whose arm_first_reset_date is within this many days (future), or recently past (60d).",
        },
        minLoanAmountCents: { type: "number" },
        maxLoanAmountCents: { type: "number" },
        minCreditScore: { type: "number", description: "Minimum credit_score_mid." },
        leadTier: {
          type: "string",
          enum: ["RED", "ORANGE", "GREEN"],
          description: "Persisted lead_tier on the loan row.",
        },
        closingThisMonth: {
          type: "boolean",
          description: "If true, closing_date falls in the current calendar month.",
        },
        pipelineHotOrange: {
          type: "boolean",
          description:
            "If true, only ORANGE tier loans in clear_to_close or closing with stage activity within ~21 days (active pipeline).",
        },
        maxDaysSinceStageActivity: {
          type: "number",
          description: "When set with pipelineHotOrange, max days since latest loan_stage_events.entered_at (default 21).",
        },
        minDaysInStage: {
          type: "number",
          description: "Only include loans whose most recent stage event is older than this many days.",
        },
        limit: { type: "number", description: "Max rows (default 25, max 200)." },
      },
    },
  },
};

function loanTypeIlike(loanType: string): string | null {
  const u = loanType.toUpperCase();
  if (u === "FHA") return "%FHA%";
  if (u === "VA") return "%VA%";
  if (u === "CONVENTIONAL") return "%CONV%";
  return null;
}

async function listLoansHandler(args: Record<string, unknown>, admin: SupabaseClient) {
  const lo = (args.lo as string | undefined)?.trim();
  const stage = (args.stage as string | undefined)?.trim();
  const status = (args.status as string | undefined)?.trim();
  const minDaysInStage = typeof args.minDaysInStage === "number" ? args.minDaysInStage : null;
  const limit = Math.min(Math.max(Number(args.limit ?? 25) || 25, 1), 200);
  const currentStageIn = Array.isArray(args.currentStageIn)
    ? (args.currentStageIn as unknown[]).map((x) => String(x).trim()).filter(Boolean)
    : null;
  const loanTypeRaw = (args.loanType as string | undefined)?.trim();
  const minNoteRateBps = typeof args.minNoteRateBps === "number" ? args.minNoteRateBps : null;
  const maxNoteRateBps = typeof args.maxNoteRateBps === "number" ? args.maxNoteRateBps : null;
  const armDueWithinDays = typeof args.armDueWithinDays === "number" ? args.armDueWithinDays : null;
  const minLoanAmountCents = typeof args.minLoanAmountCents === "number" ? args.minLoanAmountCents : null;
  const maxLoanAmountCents = typeof args.maxLoanAmountCents === "number" ? args.maxLoanAmountCents : null;
  const minCreditScore = typeof args.minCreditScore === "number" ? args.minCreditScore : null;
  const leadTier = (args.leadTier as string | undefined)?.trim().toUpperCase() ?? null;
  const closingThisMonth = args.closingThisMonth === true;
  const pipelineHotOrange = args.pipelineHotOrange === true;
  const maxDaysSinceActivity =
    typeof args.maxDaysSinceStageActivity === "number" ? args.maxDaysSinceStageActivity : 21;

  const now = new Date();
  const fetchCap = Math.min(Math.max(limit * 5, 50), 500);

  let q = admin
    .from("loans")
    .select(LOAN_CARD_COLS)
    .order("lead_created_at", { ascending: false, nullsFirst: false })
    .limit(fetchCap);
  if (lo) q = q.eq("assigned_loan_officer_name", lo);
  if (currentStageIn && currentStageIn.length > 0) q = q.in("current_stage", currentStageIn);
  else if (stage) q = q.eq("current_stage", stage);
  if (status) q = q.ilike("status_raw", `%${status}%`);
  if (loanTypeRaw) {
    const pat = loanTypeIlike(loanTypeRaw);
    if (pat) q = q.ilike("loan_type", pat);
  }
  if (minNoteRateBps != null) q = q.gte("note_rate_bps", minNoteRateBps);
  if (maxNoteRateBps != null) q = q.lte("note_rate_bps", maxNoteRateBps);
  if (minLoanAmountCents != null) q = q.gte("loan_amount_cents", minLoanAmountCents);
  if (maxLoanAmountCents != null) q = q.lte("loan_amount_cents", maxLoanAmountCents);
  if (minCreditScore != null) q = q.gte("credit_score_mid", minCreditScore);
  if (leadTier === "RED" || leadTier === "ORANGE" || leadTier === "GREEN") q = q.eq("lead_tier", leadTier);

  if (closingThisMonth) {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const a = start.toISOString().slice(0, 10);
    const b = end.toISOString().slice(0, 10);
    q = q.gte("closing_date", a).lt("closing_date", b);
  }

  if (pipelineHotOrange) {
    q = q.eq("lead_tier", "ORANGE").in("current_stage", ["clear_to_close", "closing"]);
  }

  const { data, error } = await q;
  if (error) throw error;

  let rows = data ?? [];

  if (armDueWithinDays != null && rows.length > 0) {
    rows = rows.filter((r) => {
      const raw = r.arm_first_reset_date;
      if (raw == null || raw === "") return false;
      const d = new Date(String(raw));
      if (Number.isNaN(d.getTime())) return false;
      const daysUntil = differenceInCalendarDays(d, now);
      if (daysUntil >= 0 && daysUntil <= armDueWithinDays) return true;
      if (daysUntil < 0 && daysUntil >= -60) return true;
      return false;
    });
  }

  const needsStageEvents = Boolean(minDaysInStage) || pipelineHotOrange;
  if (needsStageEvents && rows.length > 0) {
    const loanIds = rows.map((r) => r.id as string);
    const { data: events } = await admin
      .from("loan_stage_events")
      .select("loan_id,stage,entered_at")
      .in("loan_id", loanIds);

    const latest = new Map<string, string>();
    for (const e of events ?? []) {
      const existing = latest.get(e.loan_id as string);
      if (!existing || new Date(existing).getTime() < new Date(e.entered_at as string).getTime()) {
        latest.set(e.loan_id as string, e.entered_at as string);
      }
    }

    if (minDaysInStage) {
      const cutoff = Date.now() - minDaysInStage * 86_400_000;
      rows = rows.filter((r) => {
        const ts = latest.get(r.id as string);
        return ts ? new Date(ts).getTime() <= cutoff : true;
      });
    }

    if (pipelineHotOrange) {
      const actCutoff = Date.now() - maxDaysSinceActivity * 86_400_000;
      rows = rows.filter((r) => {
        const ts = latest.get(r.id as string);
        return ts ? new Date(ts).getTime() >= actCutoff : false;
      });
    }
  }

  const trimmed = rows.slice(0, limit);
  return { count: trimmed.length, rows: trimmed };
}

/* ------------------------------------------------------------------ */
/*  Tool: getLoanDetail                                                */
/* ------------------------------------------------------------------ */

const getLoanDetailSpec: ToolSpec = {
  type: "function",
  function: {
    name: "getLoanDetail",
    description: "Fetch a single loan plus stage event history and open conditions by loan id (UUID) or Shape record id.",
    parameters: {
      type: "object",
      properties: {
        loanId: { type: "string", description: "Loan UUID." },
        shapeRecordId: { type: "number", description: "Shape numeric record id." },
      },
    },
  },
};

async function getLoanDetailHandler(args: Record<string, unknown>, admin: SupabaseClient) {
  const loanId = args.loanId as string | undefined;
  const shapeRecordId = args.shapeRecordId as number | undefined;

  let q = admin
    .from("loans")
    .select(
      LOAN_CARD_COLS +
        ",loan_stage_events(stage,entered_at),conditions(title,status,created_at,cleared_at)",
    )
    .limit(1);
  if (loanId) q = q.eq("id", loanId);
  else if (shapeRecordId) q = q.eq("shape_record_id", shapeRecordId);
  else return { error: "Provide loanId or shapeRecordId." };

  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  if (!data) return { error: "Not found." };
  return data;
}

/* ------------------------------------------------------------------ */
/*  Tool: listSignals                                                  */
/* ------------------------------------------------------------------ */

const listSignalsSpec: ToolSpec = {
  type: "function",
  function: {
    name: "listSignals",
    description:
      "List active deal-detection signals (stalls, refi radar, etc.) with optional filters by LO, signal type, or minimum priority.",
    parameters: {
      type: "object",
      properties: {
        lo: {
          type: "string",
          description:
            "Optional exact LO full name. Omit for company-wide. Never use 'Team' or 'Everyone' as a name unless that is literally the LO's name in the database.",
        },
        signalType: {
          type: "string",
          description:
            "One of piped_never_closed, app_no_movement, approved_never_funded, ctc_stall, esign_stuck, rate_above_market, cash_out_candidate, fha_to_conventional, va_irrrl, arm_reset_window, credit_score_improved, never_contacted, pre_signature, packaged_not_closed, ctc_expired, appraisal_ordered_stalled, closing_8month_due, epo_window_opening.",
        },
        minPriority: { type: "number", description: "1-5; default 1." },
        limit: { type: "number", description: "Default 25, max 200." },
        category: {
          type: "string",
          description: "Optional: stall, refi, life_event, portfolio, lead_tier.",
        },
      },
    },
  },
};

async function listSignalsHandler(args: Record<string, unknown>, admin: SupabaseClient) {
  const lo = (args.lo as string | undefined)?.trim();
  const signalType = (args.signalType as string | undefined)?.trim();
  const category = (args.category as string | undefined)?.trim();
  const minPriority = Number(args.minPriority ?? 1);
  const limit = Math.min(Math.max(Number(args.limit ?? 25) || 25, 1), 200);

  let q = admin
    .from("deal_signals")
    .select(
      "id,loan_id,signal_type,category,priority,reason,lo_name,lo_user_id,meta,computed_at",
    )
    .is("dismissed_at", null)
    .gte("priority", minPriority)
    .order("priority", { ascending: false })
    .order("computed_at", { ascending: false })
    .limit(limit);
  if (lo) q = q.eq("lo_name", lo);
  if (signalType) q = q.eq("signal_type", signalType);
  if (category) q = q.eq("category", category);

  const { data, error } = await q;
  if (error) throw error;
  const rows = await enrichSignalRowsWithBorrowers(admin, data ?? []);
  return { count: rows.length, rows };
}

/* ------------------------------------------------------------------ */
/*  Tool: listStalledByLO                                              */
/* ------------------------------------------------------------------ */

const listStalledByLOSpec: ToolSpec = {
  type: "function",
  function: {
    name: "listStalledByLO",
    description:
      "List stall-category signals (Piped never closed / App no movement / CTC stall / Approved never funded). Omit `lo` for company-wide / whole-team focus lists.",
    parameters: {
      type: "object",
      properties: {
        lo: {
          type: "string",
          description:
            "Optional. Exact LO full name as stored on the loan/signal. Do NOT pass words like Team, Everyone, or Company — omit `lo` instead for org-wide results.",
        },
        limit: { type: "number" },
      },
    },
  },
};

async function listStalledByLOHandler(args: Record<string, unknown>, admin: SupabaseClient) {
  const lo = (args.lo as string | undefined)?.trim();
  const limit = Math.min(Math.max(Number(args.limit ?? 25) || 25, 1), 200);
  let q = admin
    .from("deal_signals")
    .select("id,loan_id,signal_type,priority,reason,lo_name,meta,computed_at")
    .is("dismissed_at", null)
    .eq("category", "stall")
    .order("priority", { ascending: false })
    .order("computed_at", { ascending: false })
    .limit(limit);
  if (lo) q = q.eq("lo_name", lo);
  const { data, error } = await q;
  if (error) throw error;
  const rows = await enrichSignalRowsWithBorrowers(admin, data ?? []);
  return { count: rows.length, rows };
}

/* ------------------------------------------------------------------ */
/*  Tool: findDealCandidates                                           */
/* ------------------------------------------------------------------ */

const findDealCandidatesSpec: ToolSpec = {
  type: "function",
  function: {
    name: "findDealCandidates",
    description:
      "Quest Rock deal finder: scan loans for refi/pipeline patterns using DB fields only — high conventional (>7%) / FHA (>6%) note rates, LTV>75%, conventional LTV>80% (likely PMI), CLTV>LTV (subordinate/cash-out angle), ARM reset window, Piped-not-closed. EXCLUDES do_not_contact, leads newer than 7 days, last_contacted_at within 3 days, loans closed/funded within ~30 days, and funded FHA until ~210 days after note/close anchor (CEO seasoning). Does NOT use external scrapers or credit-card data. Prefer this when the user asks who to call, good deals, or focus lists. Each row includes borrower_display and loan_id.",
    parameters: {
      type: "object",
      properties: {
        lo: { type: "string", description: "Optional filter: assigned_loan_officer_name exact match." },
        limit: { type: "number", description: "Max loans to return (default 40, max 100)." },
      },
    },
  },
};

async function findDealCandidatesHandler(args: Record<string, unknown>, admin: SupabaseClient) {
  const lo = (args.lo as string | undefined)?.trim();
  const limit = Math.min(Math.max(Number(args.limit ?? 40) || 40, 1), 100);
  const maxScan = 4000;
  let q = admin.from("loans").select(DEAL_FIND_COLS).limit(maxScan);
  if (lo) q = q.eq("assigned_loan_officer_name", lo);
  const { data, error } = await q;
  if (error) throw error;

  const now = new Date();
  type OutRow = {
    loan_id: string;
    borrower_display: string | null;
    borrower_first_name: string | null;
    borrower_last_name: string | null;
    assigned_loan_officer_name: string | null;
    loan_type: string | null;
    status_raw: string | null;
    current_stage: string | null;
    shape_record_id: number | null;
    lendingpad_loan_uuid: string | null;
    loan_amount_cents: number | null;
    note_rate_pct: number | null;
    ltv_pct: number | null;
    cltv_pct: number | null;
    arm_first_reset_date: string | null;
    tags: string[];
    reasons: string[];
  };

  const candidates: OutRow[] = [];
  for (const raw of data ?? []) {
    const row = raw as LoanRowRecord;
    if (isNoGoDealCandidate(row, now)) continue;
    const { tags, reasons } = scoreDealLoan(row, now);
    if (tags.length === 0) continue;

    const noteBps = row.note_rate_bps;
    const noteNum = typeof noteBps === "number" ? noteBps : noteBps != null ? Number(noteBps) : null;
    const ltvBps = row.ltv_bps;
    const ltvNum = typeof ltvBps === "number" ? ltvBps : ltvBps != null ? Number(ltvBps) : null;
    const cltvBps = row.cltv_bps;
    const cltvNum = typeof cltvBps === "number" ? cltvBps : cltvBps != null ? Number(cltvBps) : null;

    candidates.push({
      loan_id: String(row.id),
      borrower_display: borrowerDisplayFromRow(row),
      borrower_first_name: (row.borrower_first_name as string | null) ?? null,
      borrower_last_name: (row.borrower_last_name as string | null) ?? null,
      assigned_loan_officer_name: (row.assigned_loan_officer_name as string | null) ?? null,
      loan_type: (row.loan_type as string | null) ?? null,
      status_raw: (row.status_raw as string | null) ?? null,
      current_stage: (row.current_stage as string | null) ?? null,
      shape_record_id: row.shape_record_id != null ? Number(row.shape_record_id) : null,
      lendingpad_loan_uuid: (row.lendingpad_loan_uuid as string | null) ?? null,
      loan_amount_cents: row.loan_amount_cents != null ? Number(row.loan_amount_cents) : null,
      note_rate_pct: noteNum != null && Number.isFinite(noteNum) ? noteNum / 100 : null,
      ltv_pct: ltvNum != null && Number.isFinite(ltvNum) ? ltvNum / 100 : null,
      cltv_pct: cltvNum != null && Number.isFinite(cltvNum) ? cltvNum / 100 : null,
      arm_first_reset_date: row.arm_first_reset_date ? String(row.arm_first_reset_date) : null,
      tags,
      reasons,
    });
  }

  candidates.sort((a, b) => {
    if (b.tags.length !== a.tags.length) return b.tags.length - a.tags.length;
    return (b.loan_amount_cents ?? 0) - (a.loan_amount_cents ?? 0);
  });

  const rows = candidates.slice(0, limit);
  return {
    count: rows.length,
    scanned: (data ?? []).length,
    noGoRules:
      "Excluded: do_not_contact; lead_created_at within 7d; last_contacted_at within 3d; closed_at/funded_at within ~30d; funded FHA before ~210d seasoning anchor. External scraper / credit-card data not in DB.",
    rows,
  };
}

/* ------------------------------------------------------------------ */
/*  Tool: countsByStage                                                */
/* ------------------------------------------------------------------ */

const countsByStageSpec: ToolSpec = {
  type: "function",
  function: {
    name: "countsByStage",
    description: "Pipeline snapshot: count of loans in each current_stage. Optional LO filter.",
    parameters: {
      type: "object",
      properties: {
        lo: { type: "string", description: "LO full name." },
      },
    },
  },
};

async function countsByStageHandler(args: Record<string, unknown>, admin: SupabaseClient) {
  const lo = (args.lo as string | undefined)?.trim();
  let q = admin.from("loans").select("current_stage,loan_amount_cents", { count: "exact" }).limit(5000);
  if (lo) q = q.eq("assigned_loan_officer_name", lo);
  const { data, error } = await q;
  if (error) throw error;

  const counts: Record<string, { count: number; volumeCents: number }> = {};
  for (const r of data ?? []) {
    const k = (r.current_stage as string | null) ?? "(none)";
    const bucket = counts[k] ?? { count: 0, volumeCents: 0 };
    bucket.count += 1;
    bucket.volumeCents += (r.loan_amount_cents as number | null) ?? 0;
    counts[k] = bucket;
  }
  const rows = Object.entries(counts)
    .map(([stage, v]) => ({ stage, count: v.count, volumeCents: v.volumeCents }))
    .sort((a, b) => b.count - a.count);
  return { totalLoans: (data ?? []).length, stages: rows };
}

/* ------------------------------------------------------------------ */
/*  Tool: rankLOs                                                      */
/* ------------------------------------------------------------------ */

const rankLOsSpec: ToolSpec = {
  type: "function",
  function: {
    name: "rankLOs",
    description:
      "Rank loan officers by a metric: total leads, funded count, funded volume, stalled signals, or hot (priority>=4) signals.",
    parameters: {
      type: "object",
      properties: {
        metric: {
          type: "string",
          enum: ["leads", "funded", "fundedVolume", "stalled", "hot"],
          description: "Which metric to rank by.",
        },
        limit: { type: "number", description: "Default 10." },
      },
      required: ["metric"],
    },
  },
};

async function rankLOsHandler(args: Record<string, unknown>, admin: SupabaseClient) {
  const metric = String(args.metric ?? "leads") as "leads" | "funded" | "fundedVolume" | "stalled" | "hot";
  const limit = Math.min(Math.max(Number(args.limit ?? 10) || 10, 1), 50);

  if (metric === "stalled" || metric === "hot") {
    const { data, error } = await admin
      .from("deal_signals")
      .select("lo_name,priority,category")
      .is("dismissed_at", null);
    if (error) throw error;
    const agg = new Map<string, number>();
    for (const r of data ?? []) {
      const ln = (r.lo_name as string | null) ?? "Unassigned";
      if (metric === "stalled" && r.category !== "stall") continue;
      if (metric === "hot" && (r.priority as number) < 4) continue;
      agg.set(ln, (agg.get(ln) ?? 0) + 1);
    }
    const rows = [...agg.entries()]
      .map(([lo, value]) => ({ lo, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, limit);
    return { metric, rows };
  }

  const { data, error } = await admin
    .from("loans")
    .select("assigned_loan_officer_name,loan_amount_cents,closed_at")
    .limit(10000);
  if (error) throw error;

  const agg = new Map<string, { leads: number; funded: number; fundedVolume: number }>();
  for (const r of data ?? []) {
    const ln = (r.assigned_loan_officer_name as string | null) ?? "Unassigned";
    const bucket = agg.get(ln) ?? { leads: 0, funded: 0, fundedVolume: 0 };
    bucket.leads += 1;
    if (r.closed_at) {
      bucket.funded += 1;
      bucket.fundedVolume += (r.loan_amount_cents as number | null) ?? 0;
    }
    agg.set(ln, bucket);
  }

  const rows = [...agg.entries()]
    .map(([lo, v]) => ({
      lo,
      value: metric === "funded" ? v.funded : metric === "fundedVolume" ? v.fundedVolume : v.leads,
      leads: v.leads,
      funded: v.funded,
      fundedVolumeCents: v.fundedVolume,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
  return { metric, rows };
}

/* ------------------------------------------------------------------ */
/*  Tool: getLoanDocumentStatus                                        */
/* ------------------------------------------------------------------ */

const getLoanDocumentStatusSpec: ToolSpec = {
  type: "function",
  function: {
    name: "getLoanDocumentStatus",
    description:
      "For a single loan, return provided vs required documents. Pass loanId (UUID) OR shapeRecordId. Useful for 'what docs is this loan missing?'.",
    parameters: {
      type: "object",
      properties: {
        loanId: { type: "string" },
        shapeRecordId: { type: "number" },
      },
    },
  },
};

async function getLoanDocumentStatusHandler(args: Record<string, unknown>, admin: SupabaseClient) {
  const loanId = args.loanId as string | undefined;
  const shapeRecordId = args.shapeRecordId as number | undefined;

  let loanQ = admin
    .from("loans")
    .select(
      "id,shape_record_id,borrower_first_name,borrower_last_name,loan_type,loan_purpose,current_stage,assigned_loan_officer_name",
    )
    .limit(1);
  if (loanId) loanQ = loanQ.eq("id", loanId);
  else if (shapeRecordId) loanQ = loanQ.eq("shape_record_id", shapeRecordId);
  else return { error: "Provide loanId or shapeRecordId." };

  const { data: loan, error: loanErr } = await loanQ.maybeSingle();
  if (loanErr) throw loanErr;
  if (!loan) return { error: "Loan not found." };

  const { data: status, error: statusErr } = await admin
    .from("loan_document_status_vw")
    .select("doc_name,doc_category,priority,is_provided")
    .eq("loan_id", loan.id as string)
    .order("priority", { ascending: true });
  if (statusErr) throw statusErr;

  const { data: docs, error: docsErr } = await admin
    .from("loan_documents")
    .select("name,category,uploaded_at,source")
    .eq("loan_id", loan.id as string)
    .order("uploaded_at", { ascending: false, nullsFirst: false });
  if (docsErr) throw docsErr;

  const provided = (status ?? []).filter((r) => r.is_provided);
  const missing = (status ?? []).filter((r) => !r.is_provided);

  return {
    loan,
    summary: {
      totalRequired: status?.length ?? 0,
      providedCount: provided.length,
      missingCount: missing.length,
      totalDocsOnFile: docs?.length ?? 0,
    },
    provided,
    missing,
    documentsOnFile: docs ?? [],
  };
}

/* ------------------------------------------------------------------ */
/*  Tool: loansWithMissingDocs                                         */
/* ------------------------------------------------------------------ */

const loansWithMissingDocsSpec: ToolSpec = {
  type: "function",
  function: {
    name: "loansWithMissingDocs",
    description:
      "Rank loans by MISSING high-priority documents. IMPORTANT: pass loanIds (from findDealCandidates or listSignals) when possible — scanning all loans is slow and may time out. Without loanIds, only the most recently updated ~400 loans (optional lo/stage filter) are checked.",
    parameters: {
      type: "object",
      properties: {
        loanIds: {
          type: "array",
          items: { type: "string" },
          description:
            "Required for follow-up after findDealCandidates: array of loan UUID strings (field name exactly loanIds).",
        },
        lo: { type: "string", description: "LO full name filter (used when loanIds omitted)." },
        stage: { type: "string", description: "Pipeline stage filter (used when loanIds omitted)." },
        maxPriority: {
          type: "number",
          description: "Only count missing docs with priority <= this (default 3 = top priority only).",
        },
        limit: { type: "number", description: "Max loans (default 25, max 200)." },
      },
    },
  },
};

/** Full-table scans of loan_document_status_vw cross-join all loans × templates and time out. */
const MISSING_DOCS_CAP_WITHOUT_IDS = 250;
const MISSING_DOCS_IN_CHUNK = 15;
const MISSING_DOCS_MAX_EXPLICIT_IDS = 50;
const MISSING_DOCS_PARALLEL = 6;

function coerceLoanIdsFromArgs(args: Record<string, unknown>): string[] {
  const raw = args.loanIds ?? args.loan_ids;
  if (Array.isArray(raw)) {
    return [...new Set(raw.map((x) => String(x).trim()).filter(Boolean))];
  }
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return [];
    try {
      const parsed = JSON.parse(t) as unknown;
      if (Array.isArray(parsed)) {
        return [...new Set(parsed.map((x) => String(x).trim()).filter(Boolean))];
      }
    } catch {
      /* single id */
    }
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(t)) {
      return [t];
    }
  }
  return [];
}

async function fetchMissingDocsRowsForLoan(
  admin: SupabaseClient,
  loanId: string,
  maxPriority: number,
): Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }> {
  const { data, error } = await admin
    .from("loan_document_status_vw")
    .select(
      "loan_id,loan_type,loan_purpose,current_stage,assigned_loan_officer_name,borrower_first_name,borrower_last_name,doc_name,priority,is_provided",
    )
    .eq("loan_id", loanId)
    .eq("is_provided", false)
    .lte("priority", maxPriority);
  if (error) return { data: null, error: { message: error.message } };
  return { data: (data ?? []) as Record<string, unknown>[], error: null };
}

async function loansWithMissingDocsHandler(args: Record<string, unknown>, admin: SupabaseClient) {
  const lo = (args.lo as string | undefined)?.trim();
  const stage = (args.stage as string | undefined)?.trim();
  const maxPriority = Math.min(
    20,
    Math.max(1, Math.floor(Number(args.maxPriority ?? 3)) || 3),
  );
  const limit = Math.min(Math.max(Number(args.limit ?? 25) || 25, 1), 200);
  let explicitIds = coerceLoanIdsFromArgs(args).slice(0, MISSING_DOCS_MAX_EXPLICIT_IDS);

  let loanIds: string[];
  if (explicitIds.length > 0) {
    loanIds = explicitIds;
  } else {
    let lq = admin
      .from("loans")
      .select("id")
      .order("updated_at", { ascending: false })
      .limit(MISSING_DOCS_CAP_WITHOUT_IDS);
    if (lo) lq = lq.eq("assigned_loan_officer_name", lo);
    if (stage) lq = lq.eq("current_stage", stage);
    const { data: loanRows, error: loanErr } = await lq;
    if (loanErr) throw loanErr;
    loanIds = (loanRows ?? []).map((r) => r.id as string);
  }

  const data: Record<string, unknown>[] = [];

  if (explicitIds.length > 0) {
    for (let i = 0; i < loanIds.length; i += MISSING_DOCS_PARALLEL) {
      const batch = loanIds.slice(i, i + MISSING_DOCS_PARALLEL);
      const results = await Promise.all(
        batch.map((id) => fetchMissingDocsRowsForLoan(admin, id, maxPriority)),
      );
      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        if (r.error) {
          throw new Error(
            `loan_document_status_vw query failed for loan ${batch[j]}: ${r.error.message}`,
          );
        }
        data.push(...(r.data ?? []));
      }
    }
  } else {
    for (let i = 0; i < loanIds.length; i += MISSING_DOCS_IN_CHUNK) {
      const chunk = loanIds.slice(i, i + MISSING_DOCS_IN_CHUNK);
      if (chunk.length === 0) continue;
      let q = admin
        .from("loan_document_status_vw")
        .select(
          "loan_id,loan_type,loan_purpose,current_stage,assigned_loan_officer_name,borrower_first_name,borrower_last_name,doc_name,priority,is_provided",
        )
        .eq("is_provided", false)
        .lte("priority", maxPriority)
        .in("loan_id", chunk);
      if (lo) q = q.eq("assigned_loan_officer_name", lo);
      if (stage) q = q.eq("current_stage", stage);
      const { data: chunkData, error } = await q;
      if (error) throw error;
      data.push(...(chunkData ?? []));
    }
  }

  const agg = new Map<
    string,
    {
      loan_id: string;
      loan_type: string | null;
      loan_purpose: string | null;
      current_stage: string | null;
      assigned_loan_officer_name: string | null;
      borrower_first_name: string | null;
      borrower_last_name: string | null;
      missingCount: number;
      missingDocs: string[];
      topPriority: number;
    }
  >();
  for (const r of data ?? []) {
    const id = r.loan_id as string;
    const bucket =
      agg.get(id) ?? {
        loan_id: id,
        loan_type: (r.loan_type as string | null) ?? null,
        loan_purpose: (r.loan_purpose as string | null) ?? null,
        current_stage: (r.current_stage as string | null) ?? null,
        assigned_loan_officer_name: (r.assigned_loan_officer_name as string | null) ?? null,
        borrower_first_name: (r.borrower_first_name as string | null) ?? null,
        borrower_last_name: (r.borrower_last_name as string | null) ?? null,
        missingCount: 0,
        missingDocs: [] as string[],
        topPriority: 99,
      };
    bucket.missingCount += 1;
    bucket.missingDocs.push(r.doc_name as string);
    bucket.topPriority = Math.min(bucket.topPriority, r.priority as number);
    agg.set(id, bucket);
  }
  const rows = [...agg.values()]
    .sort((a, b) => b.missingCount - a.missingCount || a.topPriority - b.topPriority)
    .slice(0, limit);
  return {
    count: rows.length,
    rows,
    scannedLoanIds: loanIds.length,
    scopedWithLoanIds: explicitIds.length > 0,
  };
}

/* ------------------------------------------------------------------ */
/*  Tool: getTierBreakdown                                             */
/* ------------------------------------------------------------------ */

const getTierBreakdownSpec: ToolSpec = {
  type: "function",
  function: {
    name: "getTierBreakdown",
    description:
      "Recompute and persist RED/ORANGE/GREEN lead tiers for all loans, then return counts and loan_amount_cents per tier. Call this for an up-to-date tier snapshot — no separate cron step required.",
    parameters: { type: "object", properties: {} },
  },
};

async function getTierBreakdownHandler(_args: Record<string, unknown>, admin: SupabaseClient) {
  const tierJob = await persistLeadTiers(admin);
  const { data, error } = await admin.from("loans").select("lead_tier,loan_amount_cents").limit(25000);
  if (error) throw error;
  const byTier = new Map<string | null, { count: number; volumeCents: number }>();
  for (const r of data ?? []) {
    const t = (r.lead_tier as string | null) ?? null;
    const b = byTier.get(t) ?? { count: 0, volumeCents: 0 };
    b.count += 1;
    b.volumeCents += (r.loan_amount_cents as number | null) ?? 0;
    byTier.set(t, b);
  }
  const rows = [...byTier.entries()]
    .map(([lead_tier, v]) => ({ lead_tier, count: v.count, volumeCents: v.volumeCents }))
    .sort((a, b) => b.count - a.count);
  return {
    scanned: (data ?? []).length,
    tiers: rows,
    leadTierRefresh: { scanned: tierJob.scanned, rowsUpdated: tierJob.updated },
  };
}

/* ------------------------------------------------------------------ */
/*  Tool: get8MonthCheckIns                                            */
/* ------------------------------------------------------------------ */

const get8MonthCheckInsSpec: ToolSpec = {
  type: "function",
  function: {
    name: "get8MonthCheckIns",
    description:
      "Funded-book retention snapshot: counts and samples for CEO book cadence (6mo/12mo check-ins, post-close skip-payment window, first-payment touch, FHA ~180d prep, ARM fixed-period check-in) plus EPO 30–60d window. Uses the same rules as deal_signals lead_tier detectors. (Legacy name retained for tool compatibility.)",
    parameters: { type: "object", properties: {} },
  },
};

async function get8MonthCheckInsHandler(_args: Record<string, unknown>, admin: SupabaseClient) {
  const built = await buildLeadTierRetentionSummary(admin);
  return {
    bookCadenceDueCount: built.bookCadenceDueCount,
    bookCadenceBreakdown: built.bookCadenceBreakdown,
    epoWindowCount: built.epoWindowCount,
    bookCadenceSamples: built.bookCadenceLines,
    epoSamples: built.epoLines,
    truncatedBookCadence: Math.max(0, built.bookCadenceDueCount - built.bookCadenceLines.length),
    truncatedEpo: Math.max(0, built.epoWindowCount - built.epoLines.length),
  };
}

/* ------------------------------------------------------------------ */
/*  Tool: previewBlitzAssignment                                       */
/* ------------------------------------------------------------------ */

const previewBlitzAssignmentSpec: ToolSpec = {
  type: "function",
  function: {
    name: "previewBlitzAssignment",
    description:
      "Preview auto-assignment for RED or ORANGE loans with auto_assign_eligible=true. Requires EXEC_AUTO_ASSIGNMENT_JSON pools. Returns proposed assignees — does not write the database.",
    parameters: {
      type: "object",
      properties: {
        tier: { type: "string", enum: ["RED", "ORANGE"], description: "Lead tier to target." },
        limit: { type: "number", description: "Max loans (default 15, max 100)." },
      },
      required: ["tier"],
    },
  },
};

async function previewBlitzAssignmentHandler(args: Record<string, unknown>, admin: SupabaseClient) {
  const tier = String(args.tier ?? "").toUpperCase();
  if (tier !== "RED" && tier !== "ORANGE") return { error: "tier must be RED or ORANGE." };
  const limit = Math.min(Math.max(Number(args.limit ?? 15) || 15, 1), 100);
  const res = await previewAssignmentBlitz(admin, tier as BlitzTier, limit);
  if (!res.ok) return { error: res.error };
  return {
    tier,
    count: res.rows.length,
    limitedTo: res.limitedTo,
    rows: res.rows.map((r) => ({
      loanId: r.loanId,
      borrowerDisplay: r.borrowerDisplay,
      loanAmountCents: r.loanAmountCents,
      currentLoName: r.currentLoName,
      proposedName: r.proposedName,
      proposedUserId: r.proposedUserId,
      assignmentMethod: r.assignmentMethod,
    })),
  };
}

/* ------------------------------------------------------------------ */
/*  Tool: runBlitzAssignment (preview ± execute — agent-driven)       */
/* ------------------------------------------------------------------ */

const runBlitzAssignmentSpec: ToolSpec = {
  type: "function",
  function: {
    name: "runBlitzAssignment",
    description:
      "Agent-first blitz workflow: previews RED/ORANGE auto-assignment for eligible loans (auto_assign_eligible, matching tier), then optionally executes in the same tool call. Set executeNow=true when the user’s message authorizes applying assignments (one-shot ok: e.g. “run a RED blitz of 10 and execute”). Max 25 loans per call. Use executeNow=false for preview only.",
    parameters: {
      type: "object",
      properties: {
        tier: { type: "string", enum: ["RED", "ORANGE"] },
        limit: { type: "number", description: "Max loans (default 15, max 25 when executing)." },
        executeNow: {
          type: "boolean",
          description:
            "If true, updates assigned LO on each previewed loan immediately after preview. Only true when the user clearly authorized execution.",
        },
      },
      required: ["tier", "executeNow"],
    },
  },
};

async function runBlitzAssignmentHandler(args: Record<string, unknown>, admin: SupabaseClient) {
  const tier = String(args.tier ?? "").toUpperCase();
  if (tier !== "RED" && tier !== "ORANGE") return { error: "tier must be RED or ORANGE." };
  const executeNow = args.executeNow === true;
  const cap = executeNow ? 25 : 100;
  const limit = Math.min(Math.max(Number(args.limit ?? 15) || 15, 1), cap);

  const preview = await previewAssignmentBlitz(admin, tier as BlitzTier, limit);
  if (!preview.ok) return { error: preview.error };

  const previewOut = {
    tier,
    previewCount: preview.rows.length,
    limitedTo: preview.limitedTo,
    rows: preview.rows.map((r) => ({
      loanId: r.loanId,
      borrowerDisplay: r.borrowerDisplay,
      loanAmountCents: r.loanAmountCents,
      currentLoName: r.currentLoName,
      proposedName: r.proposedName,
      proposedUserId: r.proposedUserId,
      assignmentMethod: r.assignmentMethod,
    })),
  };

  if (!executeNow || preview.rows.length === 0) {
    return { phase: "preview_only", ...previewOut, executed: false };
  }

  const exec = await executeAssignmentBlitz(
    admin,
    tier as BlitzTier,
    preview.rows.map((r) => r.loanId),
  );
  if (!exec.ok) {
    return { phase: "execute_failed_after_preview", ...previewOut, executed: false, error: exec.error };
  }
  return {
    phase: "preview_and_executed",
    ...previewOut,
    executed: true,
    completed: exec.completed,
    failed: exec.failed,
  };
}

/* ------------------------------------------------------------------ */
/*  Tool: executeBlitzAssignment                                       */
/* ------------------------------------------------------------------ */

const executeBlitzAssignmentSpec: ToolSpec = {
  type: "function",
  function: {
    name: "executeBlitzAssignment",
    description:
      "Execute bulk assignment after previewBlitzAssignment with the SAME tier and loan IDs. Prefer runBlitzAssignment with executeNow=true for one-shot agent flows. HIGH IMPACT: sets assigned_loan_officer on each loan. Caller must pass confirmed=true and at most 25 loan IDs.",
    parameters: {
      type: "object",
      properties: {
        tier: { type: "string", enum: ["RED", "ORANGE"] },
        loanIds: { type: "array", items: { type: "string" }, description: "UUIDs from preview rows." },
        confirmed: {
          type: "boolean",
          description: "Must be true — model must obtain explicit user confirmation before calling.",
        },
      },
      required: ["tier", "loanIds", "confirmed"],
    },
  },
};

async function executeBlitzAssignmentHandler(args: Record<string, unknown>, admin: SupabaseClient) {
  if (args.confirmed !== true) {
    return { error: "Refusing to execute without confirmed: true and explicit user approval." };
  }
  const tier = String(args.tier ?? "").toUpperCase();
  if (tier !== "RED" && tier !== "ORANGE") return { error: "tier must be RED or ORANGE." };
  const rawIds = Array.isArray(args.loanIds) ? args.loanIds.map((x) => String(x).trim()).filter(Boolean) : [];
  const loanIds = rawIds.slice(0, 25);
  if (loanIds.length === 0) return { error: "loanIds required." };
  if (rawIds.length > 25) return { error: "At most 25 loans per exec tool call." };
  const res = await executeAssignmentBlitz(admin, tier as BlitzTier, loanIds);
  if (!res.ok) return { error: res.error };
  return { completed: res.completed, failed: res.failed };
}

/* ------------------------------------------------------------------ */
/*  Registry                                                           */
/* ------------------------------------------------------------------ */

export const TOOL_SPECS: ToolSpec[] = [
  listLoansSpec,
  getLoanDetailSpec,
  findDealCandidatesSpec,
  listSignalsSpec,
  listStalledByLOSpec,
  countsByStageSpec,
  rankLOsSpec,
  getLoanDocumentStatusSpec,
  loansWithMissingDocsSpec,
  getTierBreakdownSpec,
  get8MonthCheckInsSpec,
  runBlitzAssignmentSpec,
  previewBlitzAssignmentSpec,
  executeBlitzAssignmentSpec,
];

export const TOOL_HANDLERS: Record<string, ToolHandler> = {
  listLoans: listLoansHandler,
  getLoanDetail: getLoanDetailHandler,
  findDealCandidates: findDealCandidatesHandler,
  listSignals: listSignalsHandler,
  listStalledByLO: listStalledByLOHandler,
  countsByStage: countsByStageHandler,
  rankLOs: rankLOsHandler,
  getLoanDocumentStatus: getLoanDocumentStatusHandler,
  loansWithMissingDocs: loansWithMissingDocsHandler,
  getTierBreakdown: getTierBreakdownHandler,
  get8MonthCheckIns: get8MonthCheckInsHandler,
  runBlitzAssignment: runBlitzAssignmentHandler,
  previewBlitzAssignment: previewBlitzAssignmentHandler,
  executeBlitzAssignment: executeBlitzAssignmentHandler,
};
