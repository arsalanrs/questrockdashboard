import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  type NormalizedInsellerateRow,
  parseInsellerateXlsx,
} from "@/lib/import/insellerate";

export type RunInsellerateImportParams = {
  buffer: Buffer | ArrayBuffer;
  filename?: string | null;
  importedByUserId?: string;
  mergeActiveToLoans?: boolean;
};

export type RunInsellerateImportResult = {
  importBatchId: string;
  totalRows: number;
  historicalUpserted: number;
  activeCandidates: number;
  loansUpserted: number;
  loansCreated: number;
  loansUpdated: number;
  unmatchedLoanOfficers: string[];
  unmappedStatuses: string[];
};

type LoanRowPayload = Record<string, unknown>;

const BATCH_SIZE = 500;

function buildHistoricalPayload(
  n: NormalizedInsellerateRow,
  importBatchId: string
): LoanRowPayload {
  return {
    source: "insellerate",
    import_batch_id: importBatchId,
    external_ref_id: n.externalRefId,
    insellerate_ref_id: n.externalRefId,

    first_name: n.firstName,
    last_name: n.lastName,
    email: n.email,
    phone: n.phone,

    status_raw: n.rawStatus,
    campaign: n.campaign,
    loan_officer_name: n.loanOfficerName,

    loan_amount_cents: n.loanAmountCents,
    loan_type: n.loanType,
    loan_purpose: n.loanPurpose,
    property_state: n.propertyState,
    mailing_state: n.mailingState,

    note_rate_bps: n.noteRateBps,
    original_rate_bps: n.originalRateBps,
    property_value_cents: n.propertyValueCents,
    current_loan_balance_cents: n.currentLoanBalanceCents,
    ltv_bps: n.ltvBps,
    credit_score_mid: n.creditScoreMid,
    dti_bps: n.dtiBps,
    is_veteran: n.isVeteran,

    created_at_source: n.createdAtSource,
    last_activity_at_source: n.lastActivityAtSource,
    funded_at_source: n.fundedAtSource,

    notes: n.notes,
    row: n.row,
  };
}

function buildLoanPayloadFromInsellerate(
  n: NormalizedInsellerateRow,
  loUserId: string | null,
  importBatchId: string
): LoanRowPayload {
  return {
    import_batch_id: importBatchId,

    borrower_first_name: n.firstName,
    borrower_last_name: n.lastName,
    borrower_email: n.email,
    borrower_phone: n.phone,

    mailing_state: n.mailingState,
    property_state: n.propertyState,

    loan_amount_cents: n.loanAmountCents,

    status_raw: n.rawStatus,
    current_stage: n.stage,

    source: "insellerate",
    utm_campaign: n.campaign,

    loan_type: n.loanType,
    loan_purpose: n.loanPurpose,

    note_rate_bps: n.noteRateBps,
    original_rate_bps: n.originalRateBps,
    property_value_cents: n.propertyValueCents,
    current_loan_balance_cents: n.currentLoanBalanceCents,
    ltv_bps: n.ltvBps,
    credit_score_mid: n.creditScoreMid,
    dti_bps: n.dtiBps,
    is_veteran: n.isVeteran,
    do_not_contact: n.doNotContact,

    insellerate_ref_id: n.externalRefId,

    lead_created_at: n.createdAtSource,
    last_contacted_at: n.lastActivityAtSource,
    funded_at: n.fundedAtSource,

    assigned_loan_officer_name: n.loanOfficerName,
    assigned_loan_officer_user_id: loUserId,
  };
}

export async function runInsellerateImport(
  params: RunInsellerateImportParams
): Promise<RunInsellerateImportResult> {
  const rows = parseInsellerateXlsx(params.buffer);
  const admin = createSupabaseAdminClient();
  console.log("[insellerate-import] start", {
    totalRows: rows.length,
    mergeActiveToLoans: params.mergeActiveToLoans !== false,
    filename: params.filename,
  });

  const { data: batch, error: batchError } = await admin
    .from("import_batches")
    .insert({
      source: "insellerate_xlsx",
      source_filename: params.filename ?? null,
      imported_by: params.importedByUserId ?? null,
    })
    .select("id")
    .single();
  if (batchError) throw batchError;
  const importBatchId = batch.id as string;

  const unmappedStatuses = new Set<string>();
  const seenKeys = new Set<string>();
  const deduped: NormalizedInsellerateRow[] = [];
  for (const row of rows) {
    if (seenKeys.has(row.externalRefId)) continue;
    seenKeys.add(row.externalRefId);
    deduped.push(row);
    if (row.rawStatus && !row.stage && row.rawStatus !== "Do Not Contact") {
      // not an "active pipeline" status, but record which statuses were skipped
      unmappedStatuses.add(row.rawStatus);
    }
  }

  const historicalPayload = deduped.map((r) => buildHistoricalPayload(r, importBatchId));

  for (let i = 0; i < historicalPayload.length; i += BATCH_SIZE) {
    const chunk = historicalPayload.slice(i, i + BATCH_SIZE);
    const { error } = await admin
      .from("historical_leads")
      .upsert(chunk, { onConflict: "external_ref_id" });
    if (error) throw error;
  }

  let loansUpserted = 0;
  let loansCreated = 0;
  let loansUpdated = 0;
  const unmatchedLoanOfficers = new Set<string>();

  if (params.mergeActiveToLoans !== false) {
    const activeRows = deduped.filter((r) => r.isActive);
    console.log("[insellerate-import] merge path taken", {
      dedupedCount: deduped.length,
      activeRowsCount: activeRows.length,
      sampleStages: activeRows.slice(0, 5).map((r) => ({ status: r.rawStatus, stage: r.stage })),
    });

    const { data: users, error: usersError } = await admin
      .from("users")
      .select("id,full_name")
      .in("role", ["loan_officer", "manager", "executive"]);
    if (usersError) throw usersError;
    const nameToUserId = new Map<string, string>();
    (users ?? []).forEach((u) => {
      if (u.full_name) nameToUserId.set(String(u.full_name).trim().toLowerCase(), u.id);
    });

    const keys = activeRows.map((r) => r.externalRefId);
    const existingIds = new Map<string, string>();
    for (let i = 0; i < keys.length; i += BATCH_SIZE) {
      const chunk = keys.slice(i, i + BATCH_SIZE);
      const { data, error } = await admin
        .from("loans")
        .select("id,insellerate_ref_id")
        .in("insellerate_ref_id", chunk);
      if (error) throw error;
      (data ?? []).forEach((r) => {
        if (r.insellerate_ref_id) existingIds.set(r.insellerate_ref_id, r.id as string);
      });
    }

    const loanPayloads: LoanRowPayload[] = activeRows.map((r) => {
      const loKey = r.loanOfficerName?.toLowerCase() ?? "";
      const loUserId = loKey ? nameToUserId.get(loKey) ?? null : null;
      if (r.loanOfficerName && !loUserId) unmatchedLoanOfficers.add(r.loanOfficerName);

      const base = buildLoanPayloadFromInsellerate(r, loUserId, importBatchId);
      const existingId = existingIds.get(r.externalRefId);
      if (existingId) {
        loansUpdated += 1;
        return { id: existingId, ...base };
      }
      loansCreated += 1;
      return base;
    });

    console.log("[insellerate-import] upserting loans", {
      payloadCount: loanPayloads.length,
      existingCount: existingIds.size,
      toCreate: loansCreated,
      toUpdate: loansUpdated,
    });
    for (let i = 0; i < loanPayloads.length; i += BATCH_SIZE) {
      const chunk = loanPayloads.slice(i, i + BATCH_SIZE);
      const { error, data } = await admin
        .from("loans")
        .upsert(chunk, { onConflict: "insellerate_ref_id" })
        .select("id");
      if (error) {
        console.error("[insellerate-import] loans upsert error", error);
        throw error;
      }
      console.log("[insellerate-import] loans upsert chunk ok", {
        chunkSize: chunk.length,
        returnedRows: data?.length ?? 0,
      });
      loansUpserted += chunk.length;
    }

    // Link historical_leads rows to their merged loans so the AI chat can join
    // historical context back to live pipeline.
    if (loanPayloads.length > 0) {
      const { data: merged, error: mergedErr } = await admin
        .from("loans")
        .select("id,insellerate_ref_id")
        .in("insellerate_ref_id", activeRows.map((r) => r.externalRefId));
      if (mergedErr) throw mergedErr;
      const refToLoan = new Map<string, string>();
      (merged ?? []).forEach((l) => {
        if (l.insellerate_ref_id) refToLoan.set(l.insellerate_ref_id, l.id as string);
      });

      const updates = activeRows
        .map((r) => ({
          external_ref_id: r.externalRefId,
          loan_id: refToLoan.get(r.externalRefId) ?? null,
        }))
        .filter((u) => u.loan_id);

      for (const u of updates) {
        await admin
          .from("historical_leads")
          .update({ merged_into_loan_id: u.loan_id })
          .eq("external_ref_id", u.external_ref_id);
      }
    }

    return {
      importBatchId,
      totalRows: rows.length,
      historicalUpserted: historicalPayload.length,
      activeCandidates: activeRows.length,
      loansUpserted,
      loansCreated,
      loansUpdated,
      unmatchedLoanOfficers: Array.from(unmatchedLoanOfficers).sort(),
      unmappedStatuses: Array.from(unmappedStatuses).sort(),
    };
  }

  console.log("[insellerate-import] no-merge path (mergeActiveToLoans=false)");
  return {
    importBatchId,
    totalRows: rows.length,
    historicalUpserted: historicalPayload.length,
    activeCandidates: deduped.filter((r) => r.isActive).length,
    loansUpserted: 0,
    loansCreated: 0,
    loansUpdated: 0,
    unmatchedLoanOfficers: [],
    unmappedStatuses: Array.from(unmappedStatuses).sort(),
  };
}
