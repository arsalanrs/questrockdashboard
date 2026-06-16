/**
 * POST /api/sync/shape/page
 *
 * Syncs exactly ONE page (50 leads) from Shape API.
 * The client calls this in a loop, incrementing pageNumber until done=true.
 *
 * Each call completes in ~2s — safe on any Vercel plan (Hobby 10s limit included).
 *
 * Body: { pageNumber, dateFrom, dateTo, importBatchId? }
 * Response: { done, nextPage, importBatchId, loansUpserted, recordsProcessed,
 *             recordsSkipped, duplicatePage, unmappedStatuses? }
 *
 * Auth: admin session or cron secret.
 */
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { canAccessAdmin } from "@/lib/permissions";
import { isCronRequestAuthorized } from "@/lib/cron-auth";
import { hasShapeApiConfig } from "@/lib/shape-api/config";
import { shapeBulkExport } from "@/lib/shape-api/client";
import { mapApiRecordToCsvLike } from "@/lib/shape-api/field-map";
import { SHAPE_BULK_EXPORT_FIELDS } from "@/lib/shape-api/fields";
import { buildLoanPayloadFromRow } from "@/lib/import/build-loan-payload";
import { detectChanges } from "@/lib/shape-api/change-detector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const PAGE_SIZE = 50;
const EXCLUDED_RECORD_TYPES = new Set(["Referral Partner", "Referral Partners", "Contact"]);
const EXCLUDED_SOURCES = new Set(["zWebLead - VISIT"]);

const EXISTING_LOAN_SELECT = [
  "id", "shape_record_id", "status_raw", "assigned_loan_officer_name",
  "notes_sidebar", "notes_sidebar_ai_note", "recent_notes",
  "borrower_first_name", "borrower_last_name", "loan_amount_cents",
  "current_stage", "source", "loan_type", "loan_purpose", "credit_score_mid",
  "lendingpad_loan_uuid", "appraisal_payment_collected_at", "esign_returned_at",
  "application_completed_at", "submitted_to_processing_at", "submitted_to_uw_at",
  "ctc_at", "funded_at", "closing_scheduled_at",
].join(",");

async function authorize(request: Request): Promise<NextResponse | null> {
  if (isCronRequestAuthorized(request)) return null;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: appUser } = await supabase.from("users").select("id,role").eq("id", user.id).maybeSingle();
  if (!appUser || !canAccessAdmin(appUser.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return null;
}

export async function POST(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;

  if (!hasShapeApiConfig()) {
    return NextResponse.json({ error: "Shape API not configured." }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const pageNumber = Number(body.pageNumber ?? 1);
  const dateFrom = String(body.dateFrom ?? "").trim();
  const dateTo = String(body.dateTo ?? "").trim();
  let importBatchId = String(body.importBatchId ?? "").trim() || null;

  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: "dateFrom and dateTo are required." }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  // ── Setup (stage_mapping + users) ──────────────────────────────────────────
  const [mappingRes, usersRes] = await Promise.all([
    admin.from("stage_mapping").select("source_status,normalized_stage"),
    admin.from("users").select("id,full_name,email"),
  ]);

  const statusToStage = new Map<string, string | null>();
  (mappingRes.data ?? []).forEach((m) => statusToStage.set(m.source_status, m.normalized_stage));

  const nameToUserId = new Map<string, string>();
  const emailToUserId = new Map<string, string>();
  (usersRes.data ?? []).forEach((u) => {
    nameToUserId.set(String(u.full_name).trim().toLowerCase(), u.id);
    if (u.email) emailToUserId.set(String(u.email).trim().toLowerCase(), u.id);
  });

  // ── Create import batch on first page ──────────────────────────────────────
  if (!importBatchId) {
    const { data: batch, error: batchError } = await admin
      .from("import_batches")
      .insert({ source: "shape_api_sync_paged", source_filename: null, imported_by: null })
      .select("id")
      .single();
    if (batchError) return NextResponse.json({ error: batchError.message }, { status: 500 });
    importBatchId = batch.id as string;
  }

  // ── Fetch ONE page from Shape ──────────────────────────────────────────────
  let res;
  try {
    res = await shapeBulkExport({
      createdDateRange: { from: dateFrom, to: dateTo },
      fields: SHAPE_BULK_EXPORT_FIELDS,
      pageNumber,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Shape returns 400 "Record's not found" when a date range has no leads.
    // Treat it as an empty/done page rather than a fatal error.
    if (msg.includes("Record") && msg.includes("not found") || msg.includes("400")) {
      return NextResponse.json({
        done: true,
        nextPage: pageNumber,
        importBatchId,
        loansUpserted: 0,
        recordsProcessed: 0,
        recordsSkipped: 0,
        duplicatePage: false,
      });
    }
    return NextResponse.json({ error: `Shape API error: ${msg}` }, { status: 502 });
  }

  const data = res.data ?? {};
  const records = Object.values(data) as Record<string, unknown>[];

  // Safety: detect repeated/empty pages
  if (records.length === 0 || (pageNumber > 1 && records.length < PAGE_SIZE)) {
    // Could be a repeated page or end of data — treat as done
    return NextResponse.json({
      done: true,
      nextPage: pageNumber,
      importBatchId,
      loansUpserted: 0,
      recordsProcessed: 0,
      recordsSkipped: 0,
      duplicatePage: records.length === 0,
    });
  }

  // ── Map + build payloads ───────────────────────────────────────────────────
  const rawPayload: Array<{ import_batch_id: string; record_id: number; row: unknown }> = [];
  const loansPayload: Record<string, unknown>[] = [];
  const incomingByRecordId = new Map<number, Record<string, unknown>>();
  const unmappedStatuses = new Set<string>();
  let recordsSkipped = 0;

  for (const record of records) {
    const row = mapApiRecordToCsvLike(record);
    const recordId = Number(String(row["recordId"] ?? "").trim());
    if (!Number.isFinite(recordId)) continue;

    rawPayload.push({ import_batch_id: importBatchId, record_id: recordId, row });

    const recordType = String(row["Record Type"] ?? "").trim();
    const source = String(row["Source"] ?? "").trim();
    if (EXCLUDED_RECORD_TYPES.has(recordType) || EXCLUDED_SOURCES.has(source)) {
      recordsSkipped++;
      continue;
    }

    const statusRaw = String(row["Status"] ?? "").trim();
    if (statusRaw && !statusToStage.has(statusRaw)) unmappedStatuses.add(statusRaw);

    const loan = buildLoanPayloadFromRow(row, statusToStage, nameToUserId, importBatchId, emailToUserId);
    if (loan) {
      loansPayload.push(loan);
      incomingByRecordId.set(recordId, loan);
    }
  }

  // ── Persist raw ───────────────────────────────────────────────────────────
  if (rawPayload.length > 0) {
    const { error } = await admin.from("raw_shape_kpi_leads").insert(rawPayload);
    if (error) console.error("[sync/page] raw insert error:", error.message);
  }

  // ── Fetch existing rows for change detection ───────────────────────────────
  const recordIds = loansPayload.map((l) => l.shape_record_id as number).filter(Number.isFinite);
  const existingByRecordId = new Map<number, Record<string, unknown>>();
  if (recordIds.length > 0) {
    const { data: existing } = await admin
      .from("loans")
      .select(EXISTING_LOAN_SELECT)
      .in("shape_record_id", recordIds);
    (existing ?? []).forEach((r) => existingByRecordId.set(
      (r as unknown as Record<string, unknown>)["shape_record_id"] as number,
      r as unknown as Record<string, unknown>,
    ));
  }

  // ── Upsert loans ──────────────────────────────────────────────────────────
  if (loansPayload.length > 0) {
    const { error } = await admin.from("loans").upsert(loansPayload, { onConflict: "shape_record_id" });
    if (error) return NextResponse.json({ error: `Loan upsert failed: ${error.message}` }, { status: 500 });
  }

  // ── Fetch upserted loan IDs for activity log ──────────────────────────────
  const loanIdByRecordId = new Map<number, string>();
  if (recordIds.length > 0) {
    const { data: idRows } = await admin.from("loans").select("id,shape_record_id").in("shape_record_id", recordIds);
    (idRows ?? []).forEach((r) => loanIdByRecordId.set(r.shape_record_id as number, r.id as string));
  }

  // ── Change detection + activity events ────────────────────────────────────
  const syncedAt = new Date().toISOString();
  const activityEvents: unknown[] = [];
  const stageEvents: Array<{ loan_id: string; stage: string; entered_at: string }> = [];
  const touchByLoanId = new Map<string, { lo_name: string | null; change_type: string }>();

  for (const [recordId, incoming] of incomingByRecordId) {
    const loanId = loanIdByRecordId.get(recordId);
    if (!loanId) continue;
    const existing = (existingByRecordId.get(recordId) ?? null) as Parameters<typeof detectChanges>[0];
    const events = detectChanges(existing, incoming, loanId);
    for (const ev of events) activityEvents.push({ ...ev, synced_at: syncedAt });
    if (events.length > 0) touchByLoanId.set(loanId, { lo_name: events[0].lo_name ?? null, change_type: events[0].change_type });
    const statusEvent = events.find((e) => e.change_type === "status_changed");
    if (statusEvent) {
      const newStage = incoming.current_stage as string | null;
      const oldStage = (existing as Record<string, unknown> | null)?.current_stage as string | null;
      if (newStage && newStage !== oldStage) stageEvents.push({ loan_id: loanId, stage: newStage, entered_at: syncedAt });
    }
  }

  if (activityEvents.length > 0) {
    await admin.from("shape_activity_log").insert(activityEvents).then(({ error }) => {
      if (error) console.error("[sync/page] activity log error:", error.message);
    });
  }
  if (stageEvents.length > 0) {
    await admin.from("loan_stage_events").insert(stageEvents).then(({ error }) => {
      if (error) console.error("[sync/page] stage events error:", error.message);
    });
  }

  // ── Touch log ─────────────────────────────────────────────────────────────
  if (touchByLoanId.size > 0) {
    const todayDate = new Date().toISOString().slice(0, 10);
    const touchRows = Array.from(touchByLoanId.entries()).map(([loanId, info]) => ({
      loan_id: loanId,
      touch_date: todayDate,
      touch_count: 1,
      last_touch_type: info.change_type,
      last_touch_at: syncedAt,
      lo_name: info.lo_name,
    }));
    await admin.from("lead_touch_log").upsert(touchRows, { onConflict: "loan_id,touch_date" })
      .then(({ error }) => { if (error) console.error("[sync/page] touch log error:", error.message); });
  }

  const done = records.length < PAGE_SIZE;

  return NextResponse.json({
    done,
    nextPage: done ? pageNumber : pageNumber + 1,
    importBatchId,
    loansUpserted: loansPayload.length,
    recordsProcessed: records.length,
    recordsSkipped,
    unmappedStatuses: unmappedStatuses.size ? Array.from(unmappedStatuses) : undefined,
  });
}
