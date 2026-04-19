import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { shapeBulkExport } from "@/lib/shape-api/client";
import { mapApiRecordToCsvLike } from "@/lib/shape-api/field-map";
import { SHAPE_BULK_EXPORT_FIELDS } from "@/lib/shape-api/fields";
import { buildLoanPayloadFromRow } from "@/lib/import/build-loan-payload";
import type { ShapeBulkExportResponse } from "@/lib/shape-api/types";

// Shape API returns "Referral Partners" (with 's'); CSV exports use "Referral Partner" (no 's').
// Both are excluded. "Contact" is also excluded.
const EXCLUDED_RECORD_TYPES = new Set(["Referral Partner", "Referral Partners", "Contact"]);
const EXCLUDED_SOURCES = new Set(["zWebLead - VISIT"]);

const PAGE_SIZE = 50;
const PAGE_DELAY_MS = 1500;
const MAX_PAGES = 1000;

/** First incremental run when no watermark: pull this many days of updates. */
const INCREMENTAL_BOOTSTRAP_DAYS = 30;

export type ShapeSyncMode = "incremental" | "full";

export type ShapeSyncOptions = {
  mode?: ShapeSyncMode;
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
  syncMode: ShapeSyncMode;
  /** Which API range was used (for logs / debugging). */
  dateRangeDescription: string;
  /** Non-empty when sync loop stops early due a safety guard. */
  stoppedEarlyReason?: string;
};

function twoYearsAgoIso(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 2);
  return d.toISOString().slice(0, 10);
}

function nowIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addCalendarDaysIso(isoDate: string, deltaDays: number): string {
  const d = new Date(`${isoDate}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

type DateRangeArg =
  | { createdDateRange: { from: string; to: string } }
  | { updatedDateRange: { from: string; to: string } };

async function resolveDateRange(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  mode: ShapeSyncMode,
  options: ShapeSyncOptions,
  today: string,
): Promise<{ dateRange: DateRangeArg; description: string }> {
  if (mode === "incremental") {
    const { data: wmRow, error: wmError } = await admin
      .from("shape_sync_watermark")
      .select("last_updated_sync_to")
      .eq("id", 1)
      .maybeSingle();
    if (wmError) throw wmError;

    const lastTo = wmRow?.last_updated_sync_to as string | undefined;
    if (!lastTo) {
      const from = addCalendarDaysIso(today, -INCREMENTAL_BOOTSTRAP_DAYS);
      return {
        dateRange: { updatedDateRange: { from, to: today } },
        description: `updatedDateRange ${from}..${today} (bootstrap ${INCREMENTAL_BOOTSTRAP_DAYS}d, no watermark)`,
      };
    }
    const from = addCalendarDaysIso(lastTo, -1);
    return {
      dateRange: { updatedDateRange: { from, to: today } },
      description: `updatedDateRange ${from}..${today} (incremental, 1d overlap)`,
    };
  }

  if (options.dateFrom && options.dateTo) {
    return {
      dateRange: { createdDateRange: { from: options.dateFrom, to: options.dateTo } },
      description: `createdDateRange ${options.dateFrom}..${options.dateTo} (custom)`,
    };
  }
  const from = twoYearsAgoIso();
  return {
    dateRange: { createdDateRange: { from, to: today } },
    description: `createdDateRange ${from}..${today} (full default ~2y)`,
  };
}

export async function runShapeApiSync(options: ShapeSyncOptions = {}): Promise<ShapeSyncResult> {
  const admin = createSupabaseAdminClient();
  const today = nowIso();

  const mode: ShapeSyncMode = options.mode ?? "full";
  const { dateRange, description: dateRangeDescription } = await resolveDateRange(
    admin,
    mode,
    options,
    today,
  );

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
  const seenPageFingerprints = new Set<string>();
  let stoppedEarlyReason: string | undefined;

  for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
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
    const pageRecordIds: number[] = [];

    for (const record of records) {
      const row = mapApiRecordToCsvLike(record);
      const recordIdRaw = row["recordId"];
      const recordId = Number(String(recordIdRaw ?? "").trim());
      if (!Number.isFinite(recordId)) continue;
      pageRecordIds.push(recordId);

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

    // Safety guard: some Shape accounts keep returning 50 rows even after the
    // end of the range (repeating page-1 forever). Fingerprint each page and
    // break if we see the same page content again.
    const fp = `${records.length}|${pageRecordIds.slice(0, 5).join(",")}|${pageRecordIds.slice(-5).join(",")}`;
    if (seenPageFingerprints.has(fp)) {
      stoppedEarlyReason = `Detected repeated page payload at page ${pageNumber}; stopping to avoid infinite loop.`;
      break;
    }
    seenPageFingerprints.add(fp);

    if (records.length < PAGE_SIZE) break;
    await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
  }

  if (pages >= MAX_PAGES && !stoppedEarlyReason) {
    stoppedEarlyReason = `Reached MAX_PAGES (${MAX_PAGES}); stopping to avoid infinite loop.`;
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

  const watermarkIso = new Date().toISOString();
  const { error: wmUpsertError } = await admin.from("shape_sync_watermark").upsert(
    { id: 1, last_updated_sync_to: today, updated_at: watermarkIso },
    { onConflict: "id" },
  );
  if (wmUpsertError) throw wmUpsertError;

  return {
    pages,
    recordsProcessed,
    recordsSkipped,
    loansUpserted: allLoansPayload.length,
    importBatchId,
    fields_not_found: fieldsNotFound,
    unmappedStatuses: unmappedStatuses.size ? Array.from(unmappedStatuses).sort() : undefined,
    syncMode: mode,
    dateRangeDescription: dateRangeDescription,
    stoppedEarlyReason,
  };
}
