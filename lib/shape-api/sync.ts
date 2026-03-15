import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { shapeBulkExport } from "@/lib/shape-api/client";
import { mapApiRecordToCsvLike } from "@/lib/shape-api/field-map";
import { SHAPE_BULK_EXPORT_FIELDS } from "@/lib/shape-api/fields";
import { buildLoanPayloadFromRow } from "@/lib/import/build-loan-payload";
import type { ShapeBulkExportResponse } from "@/lib/shape-api/types";

const EXCLUDED_RECORD_TYPES = new Set(["Referral Partner", "Contact"]);
const EXCLUDED_SOURCES = new Set(["zWebLead - VISIT"]);

const PAGE_SIZE = 50;
const PAGE_DELAY_MS = 1500;

function twoYearsAgoIso(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 2);
  return d.toISOString().slice(0, 10);
}

function nowIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export type ShapeSyncOptions = {
  incremental?: boolean;
  lastSyncIso?: string;
  dateFrom?: string;
  dateTo?: string;
};

export type ShapeSyncResult = {
  pages: number;
  recordsProcessed: number;
  recordsSkipped: number;
  loansUpserted: number;
  importBatchId: string;
  fields_not_found?: string[];
  unmappedStatuses?: string[];
};

export async function runShapeApiSync(options: ShapeSyncOptions = {}): Promise<ShapeSyncResult> {
  const admin = createSupabaseAdminClient();

  const { data: batch, error: batchError } = await admin
    .from("import_batches")
    .insert({
      source: "shape_api_sync",
      source_filename: null,
      imported_by: null,
    })
    .select("id")
    .single();
  if (batchError) throw batchError;
  const importBatchId = batch.id as string;

  const dateRange =
    options.incremental && options.lastSyncIso
      ? { updatedDateRange: { from: options.lastSyncIso, to: nowIso() } }
      : options.dateFrom && options.dateTo
        ? { createdDateRange: { from: options.dateFrom, to: options.dateTo } }
        : { createdDateRange: { from: twoYearsAgoIso(), to: nowIso() } };

  const statusToStage = new Map<string, string | null>();
  const { data: mappingRows, error: mappingError } = await admin
    .from("stage_mapping")
    .select("source_status,normalized_stage");
  if (mappingError) throw mappingError;
  (mappingRows ?? []).forEach((m) => {
    statusToStage.set(m.source_status, m.normalized_stage);
  });

  const nameToUserId = new Map<string, string>();
  const { data: users, error: usersError } = await admin.from("users").select("id,full_name");
  if (usersError) throw usersError;
  (users ?? []).forEach((u) => nameToUserId.set(String(u.full_name).trim().toLowerCase(), u.id));

  let pages = 0;
  let recordsProcessed = 0;
  let recordsSkipped = 0;
  const allRawPayload: Array<{ import_batch_id: string; record_id: number; row: unknown }> = [];
  const allLoansPayload: Record<string, unknown>[] = [];
  let fieldsNotFound: string[] | undefined;
  const unmappedStatuses = new Set<string>();

  for (let pageNumber = 1; ; pageNumber++) {
    const res: ShapeBulkExportResponse = await shapeBulkExport({
      ...dateRange,
      fields: SHAPE_BULK_EXPORT_FIELDS,
      pageNumber,
    });

    if (res.fields_not_found?.length) {
      fieldsNotFound = res.fields_not_found;
    }

    const data = res.data ?? {};
    const records = Object.values(data) as Record<string, unknown>[];
    pages += 1;

    for (const record of records) {
      const row = mapApiRecordToCsvLike(record);
      const recordIdRaw = row["recordId"];
      const recordId = Number(String(recordIdRaw ?? "").trim());
      if (!Number.isFinite(recordId)) continue;

      recordsProcessed += 1;
      allRawPayload.push({ import_batch_id: importBatchId, record_id: recordId, row });

      const recordType = (row["Record Type"] ?? "").toString().trim();
      const source = (row["Source"] ?? "").toString().trim();

      if (EXCLUDED_RECORD_TYPES.has(recordType) || EXCLUDED_SOURCES.has(source)) {
        recordsSkipped += 1;
        continue;
      }

      const statusRaw = (row["Status"] ?? "").toString().trim();
      if (statusRaw && !statusToStage.has(statusRaw)) {
        unmappedStatuses.add(statusRaw);
      }

      const loan = buildLoanPayloadFromRow(row, statusToStage, nameToUserId, importBatchId);
      if (loan) allLoansPayload.push(loan);
    }

    if (records.length < PAGE_SIZE) break;
    await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
  }

  // Persist raw
  for (let i = 0; i < allRawPayload.length; i += 500) {
    const chunk = allRawPayload.slice(i, i + 500);
    const { error } = await admin.from("raw_shape_kpi_leads").insert(chunk);
    if (error) throw error;
  }

  // Persist loans
  for (let i = 0; i < allLoansPayload.length; i += 500) {
    const chunk = allLoansPayload.slice(i, i + 500);
    const { error } = await admin.from("loans").upsert(chunk, { onConflict: "shape_record_id" });
    if (error) throw error;
  }

  return {
    pages,
    recordsProcessed,
    recordsSkipped,
    loansUpserted: allLoansPayload.length,
    importBatchId,
    fields_not_found: fieldsNotFound,
    unmappedStatuses: unmappedStatuses.size ? Array.from(unmappedStatuses).sort() : undefined,
  };
}
