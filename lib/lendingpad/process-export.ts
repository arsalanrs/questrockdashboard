import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { mapLendingPadStatusToStage } from "./map-lp-status-to-stage";

type IdName = { id?: number; name?: string };

function parseIso(s: string | null | undefined): string | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function idNameName(v: IdName | null | undefined): string | null {
  return v?.name?.trim() || null;
}

function centsFromDecimal(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.round(v * 100);
}

function firstBorrower(exportRow: Record<string, unknown>) {
  const borrowers = exportRow.borrowers as Array<Record<string, unknown>> | undefined;
  return borrowers?.[0] ?? null;
}

export type ProcessLpExportResult = {
  loansUpserted: number;
  notesWritten: number;
  conditionsWritten: number;
};

/**
 * Upsert loans + rich_loan_data + notes from LendingPad export webhook payload.
 */
export async function processLendingPadExportBatch(
  rows: Array<Record<string, unknown>>,
): Promise<ProcessLpExportResult> {
  const admin = createSupabaseAdminClient();
  const result: ProcessLpExportResult = { loansUpserted: 0, notesWritten: 0, conditionsWritten: 0 };

  for (const row of rows) {
    const loanIdUuid = String(row.loanId ?? "").trim();
    if (!loanIdUuid) continue;

    const borrower = firstBorrower(row);
    const contacts = (borrower?.contacts as Record<string, unknown>) ?? {};
    const subject = (row.subjectPropertyAddress as Record<string, unknown>) ?? {};
    const dates = (row.dates as Record<string, unknown>) ?? {};
    const loanStatusName = idNameName(row.loanStatus as IdName);
    const lpStage = mapLendingPadStatusToStage(loanStatusName);

    const { data: existing } = await admin
      .from("loans")
      .select("id,shape_record_id,status_raw,current_stage")
      .eq("lendingpad_loan_uuid", loanIdUuid)
      .maybeSingle();

    const loanPayload: Record<string, unknown> = {
      lendingpad_loan_uuid: loanIdUuid,
      lendingpad_loan_number: row.loanNumber ?? null,
      lendingpad_status_raw: loanStatusName,
      lendingpad_status_at: parseIso(String((dates as Record<string, unknown>).lastModified ?? "")) ?? new Date().toISOString(),
      borrower_first_name: borrower?.firstName ?? null,
      borrower_last_name: borrower?.lastName ?? null,
      borrower_phone: contacts.mobilePhone ?? contacts.homePhone ?? contacts.workPhone ?? null,
      borrower_email: contacts.email ?? null,
      loan_amount_cents: centsFromDecimal(row.loanAmount as number),
      credit_score_mid: row.creditScore ?? null,
      loan_type: idNameName(row.loanType as IdName),
      loan_purpose: idNameName(row.purpose as IdName),
      lock_expiration_at: parseIso(dates.lockExpiration as string),
      lock_expiration_date: dates.lockExpiration ? String(dates.lockExpiration).slice(0, 10) : null,
      estimated_closing_at: parseIso(dates.estimatedClosing as string),
      closing_date: dates.scheduleClosing ? String(dates.scheduleClosing).slice(0, 10) : null,
      appraisal_contingency_date: dates.appraisalContingency
        ? String(dates.appraisalContingency).slice(0, 10)
        : null,
      finance_contingency_date: dates.financingContingency
        ? String(dates.financingContingency).slice(0, 10)
        : null,
      lp_last_synced_at: new Date().toISOString(),
    };

    if (!existing?.status_raw && lpStage) {
      loanPayload.current_stage = lpStage;
    }

    let dbLoanId: string;
    if (existing?.id) {
      await admin.from("loans").update(loanPayload).eq("id", existing.id);
      dbLoanId = existing.id as string;
    } else {
      const { data: inserted, error } = await admin
        .from("loans")
        .insert({ ...loanPayload, lead_created_at: parseIso(dates.created as string) ?? new Date().toISOString() })
        .select("id")
        .single();
      if (error || !inserted) continue;
      dbLoanId = inserted.id as string;
    }
    result.loansUpserted++;

    const coborrower = borrower?.coBorrower as Record<string, unknown> | null;
    const cobContacts = coborrower ? ((coborrower.contacts as Record<string, unknown>) ?? {}) : {};

    const richPayload = {
      loan_id: dbLoanId,
      front_dti: row.frontDti ?? null,
      back_dti: row.backDti ?? null,
      ltv_ratio_percent: row.ltvRatioPercent ?? null,
      combined_ltv_ratio_percent: row.combinedLtvRatioPercent ?? null,
      note_rate: row.noteRate ?? null,
      apr: row.apr ?? null,
      rate_locked_at: parseIso(dates.rateLocked as string),
      lock_expiration_at: parseIso(dates.lockExpiration as string),
      estimated_closing_at: parseIso(dates.estimatedClosing as string),
      appraisal_contingency_at: parseIso(dates.appraisalContingency as string),
      financing_contingency_at: parseIso(dates.financingContingency as string),
      borrower_mobile_phone: contacts.mobilePhone ? String(contacts.mobilePhone) : null,
      borrower_email: contacts.email ? String(contacts.email) : null,
      borrower_address_json: subject,
      coborrower_first_name: coborrower?.firstName ? String(coborrower.firstName) : null,
      coborrower_last_name: coborrower?.lastName ? String(coborrower.lastName) : null,
      coborrower_phone: cobContacts.mobilePhone ? String(cobContacts.mobilePhone) : null,
      total_liquid_assets_cents: centsFromDecimal(row.totalLiquidAssets as number),
      lp_notes_json: row.notes ?? null,
      processing_checklist_json: dates.processingTrackingDates ?? null,
      service_providers_json: row.disclosure ?? null,
      lp_raw_json: row,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await admin.from("rich_loan_data").upsert(richPayload, { onConflict: "loan_id" });

    const notes = (row.notes as Array<{ userName?: string; date?: string; message?: string }>) ?? [];
    for (const n of notes) {
      if (!n.message?.trim()) continue;
      const notedAt = parseIso(n.date) ?? new Date().toISOString();
      const externalId = `lp:${notedAt}:${n.message.slice(0, 40)}`;
      const { error } = await admin.from("loan_notes").insert({
        loan_id: dbLoanId,
        source: "lendingpad",
        author: n.userName ?? null,
        body: n.message,
        noted_at: notedAt,
        external_id: externalId,
      });
      if (!error) result.notesWritten++;
    }

    // Shape sidebar notes into loan_notes if linked
    if (existing?.id) {
      const { data: loanRow } = await admin
        .from("loans")
        .select("notes_sidebar,notes_sidebar_ai_note,recent_notes")
        .eq("id", dbLoanId)
        .maybeSingle();
      if (loanRow?.notes_sidebar_ai_note) {
        await admin.from("loan_notes").upsert(
          {
            loan_id: dbLoanId,
            source: "shape",
            author: "Shape AI",
            body: String(loanRow.notes_sidebar_ai_note),
            noted_at: new Date().toISOString(),
            external_id: "shape:ai_note",
          },
          { onConflict: "loan_id,source,external_id" },
        );
      }
    }
  }

  return result;
}
