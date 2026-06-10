/**
 * Shape Archive Sync
 *
 * Bulk-exports historical Shape leads (created before the active-data cutoff,
 * default 2026-01-01) and stores them in shape_archive_leads +
 * shape_archive_notes for AI-assisted search.
 *
 * Unlike the regular sync this pulls ALL sources — no source or record-type
 * filter is applied. The goal is a complete historical picture for the /chat
 * assistant, not a live pipeline view.
 *
 * Designed to run as a one-time or on-demand operation from the admin UI;
 * it is not part of the nightly incremental cron.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { shapeBulkExport } from "@/lib/shape-api/client";
import { SHAPE_BULK_EXPORT_FIELDS } from "@/lib/shape-api/fields";
import type { ShapeBulkExportResponse } from "@/lib/shape-api/types";

const PAGE_SIZE = 50;
const PAGE_DELAY_MS = 1500;
const MAX_PAGES = 2000;

// Default historical window: everything before current-year (2026)
const DEFAULT_ARCHIVE_FROM = "2020-01-01";
const DEFAULT_ARCHIVE_TO = "2025-12-31";

export type ArchiveSyncOptions = {
  dateFrom?: string; // ISO date, default DEFAULT_ARCHIVE_FROM
  dateTo?: string;   // ISO date, default DEFAULT_ARCHIVE_TO
};

export type ArchiveSyncResult = {
  batchId: string;
  pages: number;
  leadsUpserted: number;
  notesInserted: number;
  stoppedEarlyReason?: string;
};

// ---------------------------------------------------------------------------
// HTML → plain-text helper (no external deps)
// ---------------------------------------------------------------------------
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Split a notes string into non-empty segments (max ~2 000 chars each).
function splitNotes(raw: string): string[] {
  const text = htmlToText(raw);
  if (!text) return [];
  // Split on double-newline paragraph boundaries first.
  const paras = text.split(/\n{2,}/);
  const out: string[] = [];
  for (const para of paras) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    // If a single paragraph is huge, chunk it.
    if (trimmed.length <= 2000) {
      out.push(trimmed);
    } else {
      for (let i = 0; i < trimmed.length; i += 2000) {
        out.push(trimmed.slice(i, i + 2000));
      }
    }
  }
  return out;
}

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function parseDateOrNull(v: unknown): string | null {
  if (!v) return null;
  const d = new Date(String(v).trim());
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function parseCentsOrNull(v: unknown): number | null {
  if (!v) return null;
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export async function runShapeArchiveSync(
  options: ArchiveSyncOptions = {}
): Promise<ArchiveSyncResult> {
  const admin = createSupabaseAdminClient();
  const dateFrom = options.dateFrom ?? DEFAULT_ARCHIVE_FROM;
  const dateTo = options.dateTo ?? DEFAULT_ARCHIVE_TO;

  // Create a batch record
  const { data: batch, error: batchErr } = await admin
    .from("shape_archive_batches")
    .insert({ date_from: dateFrom, date_to: dateTo, status: "running" })
    .select("id")
    .single();
  if (batchErr) throw batchErr;
  const batchId = batch.id as string;

  let pages = 0;
  let leadsUpserted = 0;
  let notesInserted = 0;
  let stoppedEarlyReason: string | undefined;
  const seenFingerprints = new Set<string>();

  try {
    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
      const res: ShapeBulkExportResponse = await shapeBulkExport({
        createdDateRange: { from: dateFrom, to: dateTo },
        fields: SHAPE_BULK_EXPORT_FIELDS,
        pageNumber,
      });

      const data = res.data ?? {};
      const records = Object.values(data) as Record<string, unknown>[];
      pages += 1;

      const pageIds = records
        .map((r) => str(r["leadid"] ?? r["leadId"] ?? r["Lead ID"]))
        .filter(Boolean)
        .slice(0, 5);

      const fp = `${records.length}|${pageIds.join(",")}`;
      if (seenFingerprints.has(fp)) {
        stoppedEarlyReason = `Repeated page at ${pageNumber}; stopping.`;
        break;
      }
      seenFingerprints.add(fp);

      // Build lead upsert rows
      const leadRows: Record<string, unknown>[] = [];
      const noteRows: Record<string, unknown>[] = [];

      for (const record of records) {
        const rawId = str(record["leadid"] ?? record["leadId"] ?? record["Lead ID"]);
        const leadId = Number(rawId);
        if (!Number.isFinite(leadId) || leadId === 0) continue;

        const notesSidebar = str(
          record["Notes Sidebar"] ?? record["notes_sidebar"]
        );
        const notesAi = str(
          record["Notes Sidebar AI Note"] ?? record["notes_sidebar_ai_note"]
        );
        const recentNotes = str(
          record["Recent Note"] ?? record["recent_notes"]
        );

        leadRows.push({
          shape_lead_id: leadId,
          first_name: str(record["First Name"] ?? record["firstname"]) || null,
          last_name: str(record["Last Name"] ?? record["lastname"]) || null,
          phone: str(record["Phone"] ?? record["phone"] ?? record["Mobile Phone"]) || null,
          email: str(record["Email"] ?? record["email"]) || null,
          lead_source: str(record["Source"] ?? record["leadsource"]) || null,
          status_raw: str(
            record["Shape File Status"] ??
            record["Lead Status"] ??
            record["mstrstatus1"] ??
            record["Status"] ??
            record["status"]
          ) || null,
          loan_officer_name: str(
            record["LOA User Name"] ??
            record["Loan Officer User Name"] ??
            record["depursLo"]
          ) || null,
          loan_amount_cents: parseCentsOrNull(
            record["Loan Amount"] ??
            record["LoanAmount"] ??
            record["loanAmount"] ??
            record["borLoanAmount"] ??
            record["Purchase Price"] ??
            record["borpurchasePrice"]
          ),
          property_state: str(
            record["Property State"] ?? record["prState"]
          ) || null,
          created_date: parseDateOrNull(record["Created Date"] ?? record["createdDate"]),
          last_activity_date: parseDateOrNull(
            record["Date Loan Last Updated"] ?? record["lastActivityDate"]
          ),
          notes_sidebar: notesSidebar || null,
          notes_sidebar_ai_note: notesAi || null,
          recent_notes: recentNotes || null,
          bulk_fields: record,
          updated_at: new Date().toISOString(),
        });

        // Parse sidebar notes → individual rows
        const sources: Array<{ text: string; source: string }> = [
          { text: notesSidebar, source: "shape_sidebar" },
          { text: notesAi, source: "shape_ai_note" },
          { text: recentNotes, source: "shape_recent" },
        ];

        for (const { text, source } of sources) {
          if (!text) continue;
          const segments = splitNotes(text);
          segments.forEach((content, idx) => {
            noteRows.push({
              shape_lead_id: leadId,
              note_source: source,
              content,
              external_id: `${source}:${leadId}:${idx}`,
            });
          });
        }
      }

      // Upsert leads
      for (let i = 0; i < leadRows.length; i += 200) {
        const chunk = leadRows.slice(i, i + 200);
        const { error } = await admin
          .from("shape_archive_leads")
          .upsert(chunk, { onConflict: "shape_lead_id" });
        if (error) throw error;
        leadsUpserted += chunk.length;
      }

      // Insert notes (ignore conflicts on external_id)
      for (let i = 0; i < noteRows.length; i += 200) {
        const chunk = noteRows.slice(i, i + 200);
        const { error } = await admin
          .from("shape_archive_notes")
          .upsert(chunk, { onConflict: "external_id", ignoreDuplicates: true });
        if (error) throw error;
        notesInserted += chunk.length;
      }

      if (records.length < PAGE_SIZE) break;
      await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
    }

    // Mark batch complete
    await admin
      .from("shape_archive_batches")
      .update({
        status: "complete",
        leads_count: leadsUpserted,
        notes_count: notesInserted,
        finished_at: new Date().toISOString(),
      })
      .eq("id", batchId);
  } catch (err) {
    await admin
      .from("shape_archive_batches")
      .update({
        status: "error",
        error_msg: String(err),
        finished_at: new Date().toISOString(),
      })
      .eq("id", batchId);
    throw err;
  }

  return { batchId, pages, leadsUpserted, notesInserted, stoppedEarlyReason };
}
