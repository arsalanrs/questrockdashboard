import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { shapeBulkExport } from "@/lib/shape-api/client";
import { mapApiRecordToCsvLike } from "@/lib/shape-api/field-map";
import { SHAPE_BULK_EXPORT_FIELDS } from "@/lib/shape-api/fields";
import { buildLoanPayloadFromRow } from "@/lib/import/build-loan-payload";
import { backfillLoUserIdsFromNames, buildLoUserIdLookup } from "@/lib/import/resolve-lo-user-id";
import { detectChanges, type ActivityEvent, type ExistingLoanRow } from "@/lib/shape-api/change-detector";
import type { ShapeBulkExportResponse } from "@/lib/shape-api/types";

// Shape API returns "Referral Partners" (with 's'); CSV exports use "Referral Partner" (no 's').
// Both are excluded. "Contact" is also excluded.
const EXCLUDED_RECORD_TYPES = new Set(["Referral Partner", "Referral Partners", "Contact"]);
const EXCLUDED_SOURCES = new Set([
  "zWebLead - VISIT",
  "zWebLead - Visit",
  "zCRM Import",
  "Test Lead",
  "Inbound Shape Call",
]);

const PAGE_SIZE = 50;
// 500ms is safe for Shape's API — was 1500ms which caused 504s on large syncs
const PAGE_DELAY_MS = Number(process.env.SHAPE_PAGE_DELAY_MS ?? 500);
const MAX_PAGES = 1000;

/** First incremental run when no watermark: pull this many days of updates. */
const INCREMENTAL_BOOTSTRAP_DAYS = 30;

/** Columns fetched from loans for change detection. */
const EXISTING_LOAN_SELECT = [
  "id",
  "shape_record_id",
  "status_raw",
  "assigned_loan_officer_name",
  "notes_sidebar",
  "notes_sidebar_ai_note",
  "recent_notes",
  "borrower_first_name",
  "borrower_last_name",
  "loan_amount_cents",
  "current_stage",
  "source",
  "loan_type",
  "loan_purpose",
  "credit_score_mid",
  "lendingpad_loan_uuid",
  "appraisal_payment_collected_at",
  "esign_returned_at",
  "application_completed_at",
  "submitted_to_processing_at",
  "submitted_to_uw_at",
  "ctc_at",
  "funded_at",
  "closing_scheduled_at",
].join(",");

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
  activityEventsWritten: number;
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

  const { data: users, error: usersError } = await admin.from("users").select("id,full_name,email");
  if (usersError) throw usersError;
  const appUsers = users ?? [];
  const { nameToUserId, emailToUserId } = buildLoUserIdLookup(appUsers);

  let pages = 0;
  let recordsProcessed = 0;
  let recordsSkipped = 0;
  const allRawPayload: Array<{ import_batch_id: string; record_id: number; row: unknown }> = [];
  const allLoansPayload: Record<string, unknown>[] = [];
  // Map from shape_record_id → built loan payload (for post-upsert change detection)
  const incomingByRecordId = new Map<number, Record<string, unknown>>();
  let fieldsNotFound: string[] | undefined;
  const unmappedStatuses = new Set<string>();
  const seenPageFingerprints = new Set<string>();
  let stoppedEarlyReason: string | undefined;

  for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
    let res: ShapeBulkExportResponse;
    try {
      res = await shapeBulkExport({
        ...dateRange,
        fields: SHAPE_BULK_EXPORT_FIELDS,
        pageNumber,
      });
    } catch (err) {
      // Shape returns 400 "Record's not found" when a date range has no leads.
      // Treat it as end-of-data rather than a fatal error.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Record") && msg.includes("not found") || msg.includes("400 Bad Request")) {
        break;
      }
      throw err;
    }

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

      const loan = buildLoanPayloadFromRow(
        row,
        statusToStage,
        nameToUserId,
        importBatchId,
        emailToUserId,
        appUsers,
      );
      if (loan) {
        allLoansPayload.push(loan);
        incomingByRecordId.set(recordId, loan);
      }
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

  // ── Persist raw ───────────────────────────────────────────────────────────
  for (let i = 0; i < allRawPayload.length; i += 500) {
    const chunk = allRawPayload.slice(i, i + 500);
    const { error } = await admin.from("raw_shape_kpi_leads").insert(chunk);
    if (error) throw error;
  }

  // ── Fetch existing rows for change detection ──────────────────────────────
  const recordIds = allLoansPayload
    .map((l) => l.shape_record_id as number)
    .filter((id) => Number.isFinite(id));

  const existingByRecordId = new Map<number, ExistingLoanRow>();
  if (recordIds.length > 0) {
    // Query in batches of 500 to avoid URL length limits
    for (let i = 0; i < recordIds.length; i += 500) {
      const chunk = recordIds.slice(i, i + 500);
      const { data: existingRows, error: existingError } = await admin
        .from("loans")
        .select(EXISTING_LOAN_SELECT)
        .in("shape_record_id", chunk);
      if (existingError) {
        console.error("[sync] Failed to fetch existing rows for change detection:", existingError);
      } else {
        ((existingRows ?? []) as unknown as ExistingLoanRow[]).forEach((r) => {
          existingByRecordId.set(r.shape_record_id as number, r);
        });
      }
    }
  }

  // ── Persist loans ─────────────────────────────────────────────────────────
  for (let i = 0; i < allLoansPayload.length; i += 500) {
    const chunk = allLoansPayload.slice(i, i + 500);
    const { error } = await admin.from("loans").upsert(chunk, { onConflict: "shape_record_id" });
    if (error) throw error;
  }

  // ── Shape ↔ LP fuzzy UUID linking ─────────────────────────────────────────
  // For Shape loans with no lendingpad_loan_uuid in pipeline stages, attempt to
  // match against LP-only rows by normalised borrower name + lead_created_at ±30d.
  // This eliminates duplicate rows and connects LP conditions/docs to Shape leads.
  const PIPELINE_STATUSES_FOR_FUZZY = new Set([
    "Piped", "Registered", "Processing", "Submitted", "Underwriting",
    "Conditions Out", "Approval Conditions", "Clear to Close", "Closing",
    "Package Out", "Signed Not Piped", "Package Back",
  ]);

  const unlinkedRecordIds = allLoansPayload
    .filter((l) => !l.lendingpad_loan_uuid && PIPELINE_STATUSES_FOR_FUZZY.has(String(l.status_raw ?? "")))
    .map((l) => l.shape_record_id as number)
    .filter((id) => Number.isFinite(id));

  if (unlinkedRecordIds.length > 0) {
    // Fetch the LP-only rows (no shape_record_id) that have a UUID
    const { data: lpOnlyRows } = await admin
      .from("loans")
      .select("id,lendingpad_loan_uuid,borrower_first_name,borrower_last_name,lead_created_at")
      .is("shape_record_id", null)
      .not("lendingpad_loan_uuid", "is", null)
      .limit(2000);

    if (lpOnlyRows && lpOnlyRows.length > 0) {
      function normName(first: string | null, last: string | null): string {
        return `${String(first ?? "").trim()} ${String(last ?? "").trim()}`.toLowerCase().replace(/\s+/g, " ").trim();
      }

      // Fetch the unlinked Shape loans to get borrower names + dates
      for (let i = 0; i < unlinkedRecordIds.length; i += 200) {
        const chunk = unlinkedRecordIds.slice(i, i + 200);
        const { data: shapeRows } = await admin
          .from("loans")
          .select("id,shape_record_id,borrower_first_name,borrower_last_name,lead_created_at")
          .in("shape_record_id", chunk)
          .is("lendingpad_loan_uuid", null);

        for (const shapeRow of shapeRows ?? []) {
          const shapeName = normName(shapeRow.borrower_first_name as string | null, shapeRow.borrower_last_name as string | null);
          const shapeDate = shapeRow.lead_created_at ? new Date(shapeRow.lead_created_at as string).getTime() : null;
          if (!shapeName || !shapeDate) continue;

          const match = (lpOnlyRows as Array<{ id: string; lendingpad_loan_uuid: string; borrower_first_name: string | null; borrower_last_name: string | null; lead_created_at: string | null }>).find((lp) => {
            const lpName = normName(lp.borrower_first_name, lp.borrower_last_name);
            const lpDate = lp.lead_created_at ? new Date(lp.lead_created_at).getTime() : null;
            if (lpName !== shapeName) return false;
            if (!lpDate) return false;
            return Math.abs(shapeDate - lpDate) <= 30 * 24 * 60 * 60 * 1000; // ±30 days
          });

          if (match) {
            // Link Shape row to LP UUID
            await admin
              .from("loans")
              .update({ lendingpad_loan_uuid: match.lendingpad_loan_uuid })
              .eq("id", shapeRow.id as string);
            // Remove the now-duplicate LP-only row
            await admin.from("loans").delete().eq("id", match.id);
            // Remove from lpOnlyRows to prevent double-matching
            const idx = lpOnlyRows.findIndex((r) => r.id === match.id);
            if (idx >= 0) lpOnlyRows.splice(idx, 1);
          }
        }
      }
    }
  }

  // ── Fetch upserted loan IDs (we need the DB uuid for activity log FKs) ────
  const loanIdByRecordId = new Map<number, string>();
  if (recordIds.length > 0) {
    for (let i = 0; i < recordIds.length; i += 500) {
      const chunk = recordIds.slice(i, i + 500);
      const { data: idRows } = await admin
        .from("loans")
        .select("id,shape_record_id")
        .in("shape_record_id", chunk);
      (idRows ?? []).forEach((r) => {
        loanIdByRecordId.set(r.shape_record_id as number, r.id as string);
      });
    }
  }

  // ── Build activity events + stage events ─────────────────────────────────
  const syncedAt = new Date().toISOString();
  const allActivityEvents: ActivityEvent[] = [];
  const stageEventRows: Array<{ loan_id: string; stage: string; entered_at: string }> = [];
  // For touch log: map loan_id → latest event data
  const touchByLoanId = new Map<string, { lo_name: string | null; change_type: string }>();

  for (const [recordId, incoming] of incomingByRecordId) {
    const loanId = loanIdByRecordId.get(recordId);
    if (!loanId) continue;

    const existing = existingByRecordId.get(recordId) ?? null;
    const events = detectChanges(existing, incoming, loanId);

    for (const ev of events) {
      allActivityEvents.push({ ...ev, synced_at: syncedAt });
    }

    if (events.length > 0) {
      const loName = events[0].lo_name ?? null;
      touchByLoanId.set(loanId, { lo_name: loName, change_type: events[0].change_type });
    }

    // Append loan_stage_events when status/stage changed
    const statusEvent = events.find((e) => e.change_type === "status_changed");
    if (statusEvent && statusEvent.new_value) {
      const newStage = incoming.current_stage as string | null;
      if (newStage && newStage !== existing?.current_stage) {
        stageEventRows.push({ loan_id: loanId, stage: newStage, entered_at: syncedAt });
      }
    }
  }

  // ── Persist activity events ───────────────────────────────────────────────
  let activityEventsWritten = 0;
  if (allActivityEvents.length > 0) {
    for (let i = 0; i < allActivityEvents.length; i += 500) {
      const chunk = allActivityEvents.slice(i, i + 500);
      const { error } = await admin.from("shape_activity_log").insert(chunk);
      if (error) {
        console.error("[sync] Failed to insert activity events:", error);
      } else {
        activityEventsWritten += chunk.length;
      }
    }
  }

  // ── Persist stage events ──────────────────────────────────────────────────
  if (stageEventRows.length > 0) {
    for (let i = 0; i < stageEventRows.length; i += 500) {
      const chunk = stageEventRows.slice(i, i + 500);
      const { error } = await admin.from("loan_stage_events").insert(chunk);
      if (error) {
        console.error("[sync] Failed to insert stage events:", error);
      }
    }
  }

  // ── Upsert lead_touch_log ─────────────────────────────────────────────────
  const today8601 = today;
  if (touchByLoanId.size > 0) {
    const touchRows = Array.from(touchByLoanId.entries()).map(([loanId, info]) => ({
      loan_id: loanId,
      touch_date: today8601,
      touch_count: 1,
      last_touch_type: info.change_type,
      last_touch_at: syncedAt,
      lo_name: info.lo_name,
    }));

    for (let i = 0; i < touchRows.length; i += 500) {
      const chunk = touchRows.slice(i, i + 500);
      const { error } = await admin
        .from("lead_touch_log")
        .upsert(chunk, {
          onConflict: "loan_id,touch_date",
          ignoreDuplicates: false,
        });
      if (error) {
        console.error("[sync] Failed to upsert touch log:", error);
      }
    }
  }

  // ── Backfill LO user ids from names (comma order, nicknames, aliases) ───
  try {
    const loBackfill = await backfillLoUserIdsFromNames(admin);
    if (loBackfill.updated > 0) {
      console.log(
        `[sync] LO assignment backfill: ${loBackfill.updated} updated, ${loBackfill.stillUnmatched} still unmatched`,
      );
    }
  } catch (err) {
    console.error("[sync] LO assignment backfill failed:", err);
  }

  // ── Update watermark ──────────────────────────────────────────────────────
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
    activityEventsWritten,
    importBatchId,
    fields_not_found: fieldsNotFound,
    unmappedStatuses: unmappedStatuses.size ? Array.from(unmappedStatuses).sort() : undefined,
    syncMode: mode,
    dateRangeDescription: dateRangeDescription,
    stoppedEarlyReason,
  };
}
