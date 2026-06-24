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
import { getLendingPadLoanDetail, listLendingPadLoansWithAuth } from "./client";
import type { LendingPadAuthContext } from "./auth-fetch";
import { mapLendingPadStatusToStage } from "./map-lp-status-to-stage";
import type { NormalizedLpLoanDetail, NormalizedLpLoanListItem } from "./parse-response";
import { upsertRichLoanDataFromSync } from "./upsert-rich-loan-data";

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

type AppUser = {
  id: string;
  full_name: string | null;
};

function normalizeName(input: string | null | undefined): string {
  return String(input ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Canonical officer-name aliases for real-world provider drift.
 * Example: same LO appears as "Harrison Johnson" in LP but "Tyler Johnson" in app users.
 *
 * Optional override/extension via env:
 * LENDINGPAD_NAME_ALIASES_JSON='{"harrison johnson":"tyler johnson"}'
 */
let _cachedAliasMap: Map<string, string> | null = null;

function nameAliasMap(): Map<string, string> {
  if (_cachedAliasMap) return _cachedAliasMap;
  const map = new Map<string, string>([
    ["harrison johnson", "tyler johnson"],
  ]);
  const raw = process.env.LENDINGPAD_NAME_ALIASES_JSON?.trim();
  if (!raw) return map;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed && typeof parsed === "object") {
      for (const [k, v] of Object.entries(parsed)) {
        const from = normalizeName(k);
        const to = normalizeName(String(v ?? ""));
        if (from && to) map.set(from, to);
      }
    }
  } catch {
    // Ignore invalid alias JSON and keep built-in defaults.
  }
  _cachedAliasMap = map;
  return map;
}

function canonicalizeOfficerName(input: string | null | undefined): string {
  const n = normalizeName(input);
  if (!n) return "";
  return nameAliasMap().get(n) ?? n;
}

/**
 * Optional deterministic override:
 * LENDINGPAD_LIST_USER_MAP_JSON='[{"listUserId":"...","userId":"..."},{"listUserId":"...","fullName":"Jessica Sherard"}]'
 */
function parseListUserMapOverrides(users: AppUser[]): Map<string, string> {
  const out = new Map<string, string>();
  const raw = process.env.LENDINGPAD_LIST_USER_MAP_JSON?.trim();
  if (!raw) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!Array.isArray(parsed)) return out;
  const usersById = new Map(users.map((u) => [u.id, u]));
  const usersByNorm = new Map(
    users
      .filter((u) => u.full_name)
      .map((u) => [normalizeName(u.full_name), u.id]),
  );
  for (const row of parsed) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const listUserId = String(o.listUserId ?? o.list_user_id ?? "").trim();
    if (!listUserId) continue;
    const userId = String(o.userId ?? o.user_id ?? "").trim();
    if (userId && usersById.has(userId)) {
      out.set(listUserId, userId);
      continue;
    }
    const fullName = String(o.fullName ?? o.full_name ?? "").trim();
    if (fullName) {
      const mapped = usersByNorm.get(normalizeName(fullName));
      if (mapped) out.set(listUserId, mapped);
    }
  }
  return out;
}

function resolveUserIdByOfficerName(officerName: string | null | undefined, users: AppUser[]): string | null {
  const n = canonicalizeOfficerName(officerName);
  if (!n) return null;
  const exact = users.find((u) => canonicalizeOfficerName(u.full_name) === n);
  if (exact) return exact.id;

  // Fallback: first+last token match with prefix tolerance.
  const parts = n.split(" ").filter(Boolean);
  if (parts.length < 2) return null;
  const first = parts[0];
  const last = parts[parts.length - 1];
  for (const u of users) {
    const up = canonicalizeOfficerName(u.full_name).split(" ").filter(Boolean);
    if (up.length < 2) continue;
    const uFirst = up[0];
    const uLast = up[up.length - 1];
    const lastEq = last === uLast;
    const firstClose =
      first === uFirst ||
      first.startsWith(uFirst) ||
      uFirst.startsWith(first) ||
      (first.slice(0, 4) && uFirst.slice(0, 4) && first.slice(0, 4) === uFirst.slice(0, 4));
    if (lastEq && firstClose) return u.id;
  }
  return null;
}

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
  fixedAssignedLoName?: string | null,
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
    assigned_loan_officer_name: item.loanOfficerName ?? fixedAssignedLoName ?? null,
    assigned_loan_officer_user_id: assignedLoUserId,
    loan_type: item.loanType,
    loan_purpose: item.loanPurpose,
    credit_score_mid: item.creditScoreMid,
    property_value_cents: item.propertyValueCents,
    ltv_bps: item.ltvBps,
    funded_at: item.fundedAt,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Merge underwriting detail (rate / LTV / FICO / ARM / veteran) into a payload.
 * Keys that are null in the detail are omitted so we don't clobber existing
 * richer data (e.g. values that came from Shape).
 */
function mergeLoanDetail(
  payload: Record<string, unknown>,
  detail: NormalizedLpLoanDetail | null,
): Record<string, unknown> {
  if (!detail) return payload;
  const map: Record<string, unknown> = { ...payload };
  const setIf = (k: string, v: unknown) => {
    if (v !== null && v !== undefined) map[k] = v;
  };
  setIf("note_rate_bps", detail.noteRateBps);
  setIf("original_rate_bps", detail.originalRateBps);
  setIf("property_value_cents", detail.propertyValueCents);
  setIf("current_loan_balance_cents", detail.currentLoanBalanceCents);
  setIf("ltv_bps", detail.ltvBps);
  setIf("cltv_bps", detail.cltvBps);
  setIf("credit_score_mid", detail.creditScoreMid);
  setIf("dti_bps", detail.dtiBps);
  setIf("is_veteran", detail.isVeteran);
  setIf("arm_first_reset_date", detail.armFirstResetDate);
  setIf("arm_index", detail.armIndex);
  setIf("arm_margin_bps", detail.armMarginBps);
  setIf("loan_type", detail.loanType);
  setIf("loan_purpose", detail.loanPurpose);
  setIf("funded_at", detail.fundedAt);
  setIf("first_payment_date", detail.firstPaymentDate);
  setIf("note_date", detail.noteDate);
  return map;
}

function buildUpdatePayload(
  item: NormalizedLpLoanListItem,
  importBatchId: string,
  assignedLoUserId: string | null,
  existing: ExistingLoan,
  fixedAssignedLoName?: string | null,
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
  else if (fixedAssignedLoName) p.assigned_loan_officer_name = fixedAssignedLoName;
  if (assignedLoUserId) p.assigned_loan_officer_user_id = assignedLoUserId;
  if (item.loanType) p.loan_type = item.loanType;
  if (item.loanPurpose) p.loan_purpose = item.loanPurpose;
  if (item.creditScoreMid != null) p.credit_score_mid = item.creditScoreMid;
  if (item.propertyValueCents != null) p.property_value_cents = item.propertyValueCents;
  if (item.ltvBps != null) p.ltv_bps = item.ltvBps;
  if (item.fundedAt) p.funded_at = item.fundedAt;

  if (existing.shape_record_id == null) {
    if (item.statusRaw) p.status_raw = item.statusRaw;
    if (stage != null) p.current_stage = stage;
  }
  return p;
}

export type LendingPadLoansSyncOptions = {
  /** When false, skips GET loan-detail per row (much faster for bulk rebuild). Default true. */
  fetchDetail?: boolean;
};

export async function runLendingPadLoansSync(
  options?: LendingPadLoansSyncOptions,
): Promise<LendingPadLoansSyncResult> {
  const fetchDetail =
    options?.fetchDetail ?? process.env.LENDINGPAD_FETCH_LOAN_DETAIL !== "0";
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
  const appUsers: AppUser[] = (users ?? []) as AppUser[];
  appUsers.forEach((u) => {
    const raw = String(u.full_name ?? "").trim();
    if (raw) nameToUserId.set(raw.toLowerCase(), u.id);
  });
  const listUserOverrides = parseListUserMapOverrides(appUsers);
  const userNameById = new Map(
    appUsers
      .filter((u) => u.full_name)
      .map((u) => [u.id, String(u.full_name)]),
  );

  const baseCtx = envAuthContext();
  const cfg = getLendingPadReadConfig();

  async function runSource(
    kind: "env" | "user" | "officers_env",
    ctx: LendingPadAuthContext,
    listUserId: string,
    fixedAssignedLoUserId: string | null,
    fixedAssignedLoName: string | null,
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

        // Enrich with rate/LTV/FICO/ARM from loan-detail (optional — slow at scale).
        let detail: NormalizedLpLoanDetail | null = null;
        if (fetchDetail) {
          try {
            detail = await getLendingPadLoanDetail(item.id);
          } catch (e) {
            const m = e instanceof Error ? e.message : String(e);
            result.errors.push(`detail ${item.id}: ${m}`);
          }
        }

        const lpSyncedAt = new Date().toISOString();
        if (ex?.id) {
          const basePayload = buildUpdatePayload(
            item,
            result.importBatchId,
            assignedLoUserId,
            ex,
            fixedAssignedLoName,
          );
          const payload = { ...mergeLoanDetail(basePayload, detail), lp_last_synced_at: lpSyncedAt };
          const { error: upErr } = await admin.from("loans").update(payload).eq("id", ex.id);
          if (upErr) {
            result.errors.push(`update ${item.id}: ${upErr.message}`);
            continue;
          }
          upserted += 1;
          if (detail) {
            try {
              await upsertRichLoanDataFromSync(admin, ex.id, detail, item);
            } catch (e) {
              const m = e instanceof Error ? e.message : String(e);
              result.errors.push(`rich_data ${item.id}: ${m}`);
            }
          }
          if (item.statusRaw && item.statusRaw !== prevLpStatus && stage) {
            try {
              await recordLoanStageEventIfChanged(admin, ex.id, stage, enteredAt);
            } catch (e) {
              const m = e instanceof Error ? e.message : String(e);
              result.errors.push(`stage_event ${item.id}: ${m}`);
            }
          }
        } else {
          const basePayload = buildInsertPayload(
            item,
            result.importBatchId,
            assignedLoUserId,
            fixedAssignedLoName,
          );
          const payload = { ...mergeLoanDetail(basePayload, detail), lp_last_synced_at: lpSyncedAt };
          const { data: ins, error: insErr } = await admin.from("loans").insert(payload).select("id").single();
          if (insErr) {
            result.errors.push(`insert ${item.id}: ${insErr.message}`);
            continue;
          }
          upserted += 1;
          if (detail && ins?.id) {
            try {
              await upsertRichLoanDataFromSync(admin, ins.id as string, detail, item);
            } catch (e) {
              const m = e instanceof Error ? e.message : String(e);
              result.errors.push(`rich_data ${item.id}: ${m}`);
            }
          }
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
      const fixedName = userNameById.get(c.user_id) ?? null;
      await runSource("user", ctx, c.list_user_id.trim(), c.user_id, fixedName);
    }
  } else if (cfg.listUserId) {
    await runSource("env", baseCtx, cfg.listUserId, null, null);
  } else if (envOfficers.length > 0) {
    for (const o of envOfficers) {
      const listId = o.listUserId.trim();
      const overrideId = listUserOverrides.get(listId) ?? null;
      const byNameId = resolveUserIdByOfficerName(o.officerName, appUsers);
      const fixedId = overrideId ?? byNameId ?? null;
      const fixedName = fixedId ? (userNameById.get(fixedId) ?? o.officerName ?? null) : null;
      await runSource("officers_env", baseCtx, listId, fixedId, fixedName);
    }
  } else {
    result.errors.push(
      "No lendingpad_user_credentials rows, LENDINGPAD_LIST_USER_ID unset, and LENDINGPAD_OFFICERS_JSON empty — cannot list loans.",
    );
  }

  return result;
}
