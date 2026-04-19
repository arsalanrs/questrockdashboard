/**
 * Tool definitions for the exec AI chat.
 *
 * Each tool exposes a narrow, typed Supabase query to the LLM (no raw SQL from
 * the model). Tools are executed server-side with the admin client, but only
 * after the caller has been verified as executive/admin by the route handler.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

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
  "id,shape_record_id,current_stage,status_raw,loan_amount_cents,closing_date,closed_at,borrower_first_name,borrower_last_name,assigned_loan_officer_name,loan_type,loan_purpose,lead_created_at,lendingpad_loan_uuid";

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

/* ------------------------------------------------------------------ */
/*  Tool: listLoans                                                    */
/* ------------------------------------------------------------------ */

const listLoansSpec: ToolSpec = {
  type: "function",
  function: {
    name: "listLoans",
    description:
      "List loans matching simple filters (LO name, current stage, raw status). Returns up to `limit` rows sorted by lead_created_at desc.",
    parameters: {
      type: "object",
      properties: {
        lo: { type: "string", description: "Loan-officer full name (matches assigned_loan_officer_name)." },
        stage: { type: "string", description: "Pipeline stage: " + PIPELINE_STAGES.join(", ") },
        status: { type: "string", description: "Raw status from Shape (e.g. 'Approved', 'Piped')." },
        minDaysInStage: {
          type: "number",
          description: "Only include loans whose most recent stage event is older than this many days.",
        },
        limit: { type: "number", description: "Max rows (default 25, max 200)." },
      },
    },
  },
};

async function listLoansHandler(args: Record<string, unknown>, admin: SupabaseClient) {
  const lo = (args.lo as string | undefined)?.trim();
  const stage = (args.stage as string | undefined)?.trim();
  const status = (args.status as string | undefined)?.trim();
  const minDaysInStage = typeof args.minDaysInStage === "number" ? args.minDaysInStage : null;
  const limit = Math.min(Math.max(Number(args.limit ?? 25) || 25, 1), 200);

  let q = admin
    .from("loans")
    .select(LOAN_CARD_COLS)
    .order("lead_created_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (lo) q = q.eq("assigned_loan_officer_name", lo);
  if (stage) q = q.eq("current_stage", stage);
  if (status) q = q.ilike("status_raw", `%${status}%`);

  const { data, error } = await q;
  if (error) throw error;

  if (!minDaysInStage || !data?.length) return { count: data?.length ?? 0, rows: data ?? [] };

  const loanIds = data.map((r) => r.id as string);
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
  const cutoff = Date.now() - minDaysInStage * 86_400_000;
  const filtered = data.filter((r) => {
    const ts = latest.get(r.id as string);
    return ts ? new Date(ts).getTime() <= cutoff : true;
  });
  return { count: filtered.length, rows: filtered };
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
        lo: { type: "string", description: "LO full name." },
        signalType: {
          type: "string",
          description:
            "One of piped_never_closed, app_no_movement, approved_never_funded, ctc_stall, esign_stuck, rate_above_market, cash_out_candidate, fha_to_conventional, va_irrrl, arm_reset_window, credit_score_improved.",
        },
        minPriority: { type: "number", description: "1-5; default 1." },
        limit: { type: "number", description: "Default 25, max 200." },
      },
    },
  },
};

async function listSignalsHandler(args: Record<string, unknown>, admin: SupabaseClient) {
  const lo = (args.lo as string | undefined)?.trim();
  const signalType = (args.signalType as string | undefined)?.trim();
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

  const { data, error } = await q;
  if (error) throw error;
  return { count: data?.length ?? 0, rows: data ?? [] };
}

/* ------------------------------------------------------------------ */
/*  Tool: listStalledByLO                                              */
/* ------------------------------------------------------------------ */

const listStalledByLOSpec: ToolSpec = {
  type: "function",
  function: {
    name: "listStalledByLO",
    description: "Convenience: list stall-category signals (Piped never closed / App no movement / CTC stall / Approved never funded) for a given LO.",
    parameters: {
      type: "object",
      properties: {
        lo: { type: "string", description: "LO full name." },
        limit: { type: "number" },
      },
      required: ["lo"],
    },
  },
};

async function listStalledByLOHandler(args: Record<string, unknown>, admin: SupabaseClient) {
  const lo = (args.lo as string | undefined)?.trim();
  if (!lo) return { error: "Provide lo." };
  const limit = Math.min(Math.max(Number(args.limit ?? 25) || 25, 1), 200);
  const { data, error } = await admin
    .from("deal_signals")
    .select("id,loan_id,signal_type,priority,reason,meta,computed_at")
    .is("dismissed_at", null)
    .eq("category", "stall")
    .eq("lo_name", lo)
    .order("priority", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return { count: data?.length ?? 0, rows: data ?? [] };
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
      "Rank loans by the number of MISSING high-priority documents. Use to find which deals have the biggest documentation gaps.",
    parameters: {
      type: "object",
      properties: {
        lo: { type: "string", description: "LO full name filter." },
        stage: { type: "string", description: "Pipeline stage filter." },
        maxPriority: {
          type: "number",
          description: "Only count missing docs with priority <= this (default 3 = top priority only).",
        },
        limit: { type: "number", description: "Max loans (default 25, max 200)." },
      },
    },
  },
};

async function loansWithMissingDocsHandler(args: Record<string, unknown>, admin: SupabaseClient) {
  const lo = (args.lo as string | undefined)?.trim();
  const stage = (args.stage as string | undefined)?.trim();
  const maxPriority = Number(args.maxPriority ?? 3);
  const limit = Math.min(Math.max(Number(args.limit ?? 25) || 25, 1), 200);

  let q = admin
    .from("loan_document_status_vw")
    .select(
      "loan_id,loan_type,loan_purpose,current_stage,assigned_loan_officer_name,borrower_first_name,borrower_last_name,doc_name,priority,is_provided",
    )
    .eq("is_provided", false)
    .lte("priority", maxPriority);
  if (lo) q = q.eq("assigned_loan_officer_name", lo);
  if (stage) q = q.eq("current_stage", stage);
  const { data, error } = await q.limit(10000);
  if (error) throw error;

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
  return { count: rows.length, rows };
}

/* ------------------------------------------------------------------ */
/*  Registry                                                           */
/* ------------------------------------------------------------------ */

export const TOOL_SPECS: ToolSpec[] = [
  listLoansSpec,
  getLoanDetailSpec,
  listSignalsSpec,
  listStalledByLOSpec,
  countsByStageSpec,
  rankLOsSpec,
  getLoanDocumentStatusSpec,
  loansWithMissingDocsSpec,
];

export const TOOL_HANDLERS: Record<string, ToolHandler> = {
  listLoans: listLoansHandler,
  getLoanDetail: getLoanDetailHandler,
  listSignals: listSignalsHandler,
  listStalledByLO: listStalledByLOHandler,
  countsByStage: countsByStageHandler,
  rankLOs: rankLOsHandler,
  getLoanDocumentStatus: getLoanDocumentStatusHandler,
  loansWithMissingDocs: loansWithMissingDocsHandler,
};
