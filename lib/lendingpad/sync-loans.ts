/**
 * Pull loan list from LendingPad GET /integrations/list/loans and merge into public.loans.
 * - Shape remains source for status_raw / current_stage when shape_record_id is set.
 * - LP writes lendingpad_status_raw + lendingpad_status_at always; updates current_stage for LP-only rows.
 * - Sources (in order): public.lendingpad_user_credentials; else LENDINGPAD_LIST_USER_ID; else LENDINGPAD_OFFICERS_JSON.
 * - API max take=25 per LendingPad guide.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordLoanStageEventIfChanged } from "@/lib/loans/record-stage-event";
import {
  getLendingPadReadConfig,
  parseLendingPadOfficersJson,
  hasLendingPadReadConfig,
} from "./config";
import { listLendingPadLoansWithAuth } from "./client";
import type { LendingPadAuthContext } from "./auth-fetch";
import { mapLendingPadStatusToStage } from "./map-lp-status-to-stage";
import type { NormalizedLpLoanListItem } from "./parse-response";

const PAGE_SIZE = 25;
const MAX_PAGES = 500;

export type LendingPadLoansSyncResult = {
  importBatchId: string;
  sources: Array<{
    kind: "env" | "user" | "officers_env";
    userId?: string;
    pages: number;
    loansUpserted: number;
  }>;
  loansConsidered: number;
  loansUpserted: number;
  errors: string[];
};

type CredRow = {
  user_id: string;
  api_username: string;
  api_password: string;
  list_user_id: string;
};

type ExistingLoan = {
  id: string;
  shape_record_id: number | null;
  lendingpad_status_raw: string | null;
};

function envAuthContext(): LendingPadAuthContext {
  const cfg = getLendingPadReadConfig();
  return {
    baseUrl: cfg.baseUrl,
    contactId: cfg.contactId,
    companyId: cfg.companyId,
    username: cfg.username,
    password: cfg.password,
  };
}

function lpStage(item: NormalizedLpLoanListItem) {
  return item.statusRaw ? mapLendingPadStatusToStage(item.statusRaw) : null;
}

function buildInsertPayload(
  item: NormalizedLpLoanListItem,
  importBatchId: string,
  assignedLoUserId: string | null,
): Record<string, unknown> {
  const stage = lpStage(item);
  return {
    import_batch_id: importBatchId,
    lendingpad_loan_uuid: item.id,
    lendingpad_loan_number: item.loanNumber,
    lendingpad_status_raw: item.statusRaw,
    lendingpad_status_at: item.statusAt,
    record_type: "Loan",
    status_raw: item.statusRaw,
    current_stage: stage,
    borrower_first_name: item.borrowerFirstName,
    borrower_last_name: item.borrowerLastName,
    loan_amount_cents: item.loanAmountCents,
    property_state: item.propertyState,
    assigned_loan_officer_name: item.loanOfficerName,
    assigned_loan_officer_user_id: assignedLoUserId,
    updated_at: new Date().toISOString(),
  };
}

function buildUpdatePayload(
  item: NormalizedLpLoanListItem,
  importBatchId: string,
  assignedLoUserId: string | null,
  existing: ExistingLoan,
): Record<string, unknown> {
  const stage = lpStage(item);
  const p: Record<string, unknown> = {
    import_batch_id: importBatchId,
    lendingpad_loan_uuid: item.id,
    lendingpad_status_raw: item.statusRaw,
    lendingpad_status_at: item.statusAt,
    updated_at: new Date().toISOString(),
  };
  if (item.loanNumber) p.lendingpad_loan_number = item.loanNumber;
  if (item.borrowerFirstName) p.borrower_first_name = item.borrowerFirstName;
  if (item.borrowerLastName) p.borrower_last_name = item.borrowerLastName;
  if (item.loanAmountCents != null) p.loan_amount_cents = item.loanAmountCents;
  if (item.propertyState) p.property_state = item.propertyState;
  if (item.loanOfficerName) p.assigned_loan_officer_name = item.loanOfficerName;
  if (assignedLoUserId) p.assigned_loan_officer_user_id = assignedLoUserId;

  if (existing.shape_record_id == null) {
    if (item.statusRaw) p.status_raw = item.statusRaw;
    if (stage != null) p.current_stage = stage;
  }
  return p;
}

export async function runLendingPadLoansSync(): Promise<LendingPadLoansSyncResult> {
  const result: LendingPadLoansSyncResult = {
    importBatchId: "",
    sources: [],
    loansConsidered: 0,
    loansUpserted: 0,
    errors: [],
  };

  if (!hasLendingPadReadConfig()) {
    result.errors.push("LendingPad env not configured.");
    return result;
  }

  const officersParsed = parseLendingPadOfficersJson();
  if (!officersParsed.ok) {
    result.errors.push(officersParsed.error);
    return result;
  }
  const envOfficers = officersParsed.officers;

  const admin = createSupabaseAdminClient();

  const { data: creds } = await admin
    .from("lendingpad_user_credentials")
    .select("user_id,api_username,api_password,list_user_id");

  const { data: batch, error: batchError } = await admin
    .from("import_batches")
    .insert({
      source: "lendingpad_loans_sync",
      source_filename: null,
      imported_by: null,
    })
    .select("id")
    .single();
  if (batchError) throw batchError;
  result.importBatchId = batch.id as string;

  const nameToUserId = new Map<string, string>();
  const { data: users, error: usersError } = await admin.from("users").select("id,full_name");
  if (usersError) throw usersError;
  (users ?? []).forEach((u) => nameToUserId.set(String(u.full_name).trim().toLowerCase(), u.id));

  const baseCtx = envAuthContext();
  const cfg = getLendingPadReadConfig();

  async function runSource(
    kind: "env" | "user" | "officers_env",
    ctx: LendingPadAuthContext,
    listUserId: string,
    fixedAssignedLoUserId: string | null,
  ) {
    let pages = 0;
    let upserted = 0;
    let skip = 0;
    let lastBatchLen = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      let items: NormalizedLpLoanListItem[] = [];
      try {
        items = await listLendingPadLoansWithAuth(ctx, listUserId, { skip, take: PAGE_SIZE });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        result.errors.push(msg);
        break;
      }
      pages += 1;
      lastBatchLen = items.length;
      if (items.length === 0) break;

      for (const item of items) {
        result.loansConsidered += 1;
        const loName = item.loanOfficerName?.trim();
        const assignedLoUserId =
          fixedAssignedLoUserId ??
          (loName ? nameToUserId.get(loName.toLowerCase()) ?? null : null);

        const { data: existing, error: exErr } = await admin
          .from("loans")
          .select("id,shape_record_id,lendingpad_status_raw")
          .eq("lendingpad_loan_uuid", item.id)
          .maybeSingle();
        if (exErr) {
          result.errors.push(`lookup ${item.id}: ${exErr.message}`);
          continue;
        }

        const ex = existing as ExistingLoan | null;
        const prevLpStatus = ex?.lendingpad_status_raw ?? null;
        const stage = lpStage(item);
        const enteredAt = item.statusAt ?? new Date().toISOString();

        if (ex?.id) {
          const payload = buildUpdatePayload(item, result.importBatchId, assignedLoUserId, ex);
          const { error: upErr } = await admin.from("loans").update(payload).eq("id", ex.id);
          if (upErr) {
            result.errors.push(`update ${item.id}: ${upErr.message}`);
            continue;
          }
          upserted += 1;
          if (item.statusRaw && item.statusRaw !== prevLpStatus && stage) {
            try {
              await recordLoanStageEventIfChanged(admin, ex.id, stage, enteredAt);
            } catch (e) {
              const m = e instanceof Error ? e.message : String(e);
              result.errors.push(`stage_event ${item.id}: ${m}`);
            }
          }
        } else {
          const payload = buildInsertPayload(item, result.importBatchId, assignedLoUserId);
          const { data: ins, error: insErr } = await admin.from("loans").insert(payload).select("id").single();
          if (insErr) {
            result.errors.push(`insert ${item.id}: ${insErr.message}`);
            continue;
          }
          upserted += 1;
          if (stage && ins?.id) {
            try {
              await recordLoanStageEventIfChanged(admin, ins.id as string, stage, enteredAt);
            } catch (e) {
              const m = e instanceof Error ? e.message : String(e);
              result.errors.push(`stage_event ${item.id}: ${m}`);
            }
          }
        }
      }

      if (lastBatchLen < PAGE_SIZE) break;
      skip += PAGE_SIZE;
    }
    result.sources.push({
      kind,
      userId: fixedAssignedLoUserId ?? undefined,
      pages,
      loansUpserted: upserted,
    });
    result.loansUpserted += upserted;
  }

  const credList = (creds ?? []) as unknown as CredRow[];
  if (credList.length > 0) {
    for (const c of credList) {
      const ctx: LendingPadAuthContext = {
        ...baseCtx,
        username: c.api_username,
        password: c.api_password,
      };
      await runSource("user", ctx, c.list_user_id.trim(), c.user_id);
    }
  } else if (cfg.listUserId) {
    await runSource("env", baseCtx, cfg.listUserId, null);
  } else if (envOfficers.length > 0) {
    for (const o of envOfficers) {
      const fixedId = o.officerName
        ? nameToUserId.get(o.officerName.trim().toLowerCase()) ?? null
        : null;
      await runSource("officers_env", baseCtx, o.listUserId.trim(), fixedId);
    }
  } else {
    result.errors.push(
      "No lendingpad_user_credentials rows, LENDINGPAD_LIST_USER_ID unset, and LENDINGPAD_OFFICERS_JSON empty — cannot list loans.",
    );
  }

  return result;
}
