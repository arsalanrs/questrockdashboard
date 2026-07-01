import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { mapLendingPadStatusToStage } from "./map-lp-status-to-stage";

type IdName = { id?: number | string; name?: string };

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

/** Convert a percentage (e.g. 75.5) to basis points (7550). */
function pctToBps(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.round(v * 100);
}

/** Convert a decimal rate (e.g. 0.06875) or percentage (6.875) to bps. */
function rateToBps(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  // LP returns rates as percentages (e.g. 6.875), not decimals
  return Math.round(v * 100);
}

function firstBorrower(exportRow: Record<string, unknown>) {
  const borrowers = exportRow.borrowers as Array<Record<string, unknown>> | undefined;
  return borrowers?.[0] ?? null;
}

function strField(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export type ProcessLpExportResult = {
  loansUpserted: number;
  notesWritten: number;
  conditionsWritten: number;
  documentsWritten: number;
};

/**
 * Upsert loans + rich_loan_data + conditions + documents + notes from LendingPad export webhook payload.
 */
export async function processLendingPadExportBatch(
  rows: Array<Record<string, unknown>>,
): Promise<ProcessLpExportResult> {
  const admin = createSupabaseAdminClient();
  const result: ProcessLpExportResult = {
    loansUpserted: 0,
    notesWritten: 0,
    conditionsWritten: 0,
    documentsWritten: 0,
  };

  for (const row of rows) {
    const loanIdUuid = String(row.loanId ?? "").trim();
    if (!loanIdUuid) continue;

    // ── Borrower & related fields ──────────────────────────────────────────
    const borrower = firstBorrower(row);
    const contacts = (borrower?.contacts as Record<string, unknown>) ?? {};
    const coborrower = borrower?.coBorrower as Record<string, unknown> | null;
    const cobContacts = coborrower ? ((coborrower.contacts as Record<string, unknown>) ?? {}) : {};
    const subject = (row.subjectPropertyAddress as Record<string, unknown>) ?? {};
    const dates = (row.dates as Record<string, unknown>) ?? {};

    // ── Stage & status ─────────────────────────────────────────────────────
    const loanStatusName = idNameName(row.loanStatus as IdName);
    const lpStage = mapLendingPadStatusToStage(loanStatusName);

    // ── Loan officer ───────────────────────────────────────────────────────
    const loRecord = row.loanOfficer as Record<string, unknown> | null;
    const loName = strField(loRecord?.name) ?? strField(row.loanOfficerName);
    const loEmail = strField(loRecord?.email) ?? strField(row.loanOfficerEmail);

    // ── Numeric fields ─────────────────────────────────────────────────────
    const ltvPct = (row.ltvRatioPercent ?? row.ltv) as number | null;
    const cltvPct = (row.combinedLtvRatioPercent ?? row.cltv) as number | null;
    const frontDti = (row.frontDti ?? row.frontEndDTI) as number | null;
    const backDti = (row.backDti ?? row.backEndDTI) as number | null;
    const noteRatePct = (row.noteRate ?? row.interestRate) as number | null;
    const propertyVal = (row.propertyValue ?? row.appraiserValue ?? row.purchasePrice) as number | null;

    // ── Occupancy / doc type / veteran ─────────────────────────────────────
    const occupancy = idNameName(row.occupancy as IdName) ?? strField(row.occupancyType);
    const docType = idNameName(row.documentationType as IdName) ?? strField(row.loanProgram);
    const propertyState = strField(subject.state) ?? strField(row.propertyState);
    const propertyCity = strField(subject.city) ?? strField(row.propertyCity);
    const propertyAddress = strField(subject.streetAddress) ?? strField(subject.address1);
    const propertyZip = strField(subject.zipCode) ?? strField(subject.zip);

    // VA / Self-employed flags — LP doesn't always export these; best-effort
    const isVeteran = row.isVeteran != null ? Boolean(row.isVeteran) : null;
    const isSelfEmployed = row.isSelfEmployed != null ? Boolean(row.isSelfEmployed) : null;

    // ── Lookup existing loan ───────────────────────────────────────────────
    const { data: existing } = await admin
      .from("loans")
      .select("id,shape_record_id,status_raw,current_stage")
      .eq("lendingpad_loan_uuid", loanIdUuid)
      .maybeSingle();

    // ── Loans payload ──────────────────────────────────────────────────────
    const loanPayload: Record<string, unknown> = {
      lendingpad_loan_uuid: loanIdUuid,
      lendingpad_loan_number: row.loanNumber ?? null,
      lendingpad_status_raw: loanStatusName,
      lendingpad_status_at:
        parseIso(String((dates as Record<string, unknown>).lastModified ?? "")) ??
        new Date().toISOString(),

      // Borrower
      borrower_first_name: borrower?.firstName ?? null,
      borrower_last_name: borrower?.lastName ?? null,
      borrower_phone:
        contacts.mobilePhone ?? contacts.homePhone ?? contacts.workPhone ?? null,
      borrower_email: contacts.email ?? null,

      // Co-borrower
      co_borrower_first_name: coborrower?.firstName ?? null,
      co_borrower_last_name: coborrower?.lastName ?? null,
      co_borrower_email: cobContacts.email ?? null,
      co_borrower_phone: cobContacts.mobilePhone ?? cobContacts.homePhone ?? null,

      // Loan officer
      ...(loName ? { assigned_loan_officer_name: loName } : {}),
      ...(loEmail ? { loan_officer_email: loEmail } : {}),

      // Financials
      loan_amount_cents: centsFromDecimal(row.loanAmount as number),
      property_value_cents: centsFromDecimal(propertyVal),
      credit_score_mid: row.creditScore ?? null,
      loan_type: idNameName(row.loanType as IdName),
      loan_purpose: idNameName(row.purpose as IdName),
      documentation_type: docType,
      occupancy_type: occupancy,

      // Numeric flags stored as bps on the loans table
      ltv_bps: pctToBps(ltvPct),
      cltv_bps: pctToBps(cltvPct),
      dti_bps: pctToBps(backDti),
      note_rate_bps: rateToBps(noteRatePct),

      // Property location
      property_state: propertyState,
      property_city: propertyCity,
      property_address: propertyAddress,
      property_zip: propertyZip,

      // Boolean flags
      ...(isVeteran !== null ? { is_veteran: isVeteran } : {}),
      ...(isSelfEmployed !== null ? { is_self_employed: isSelfEmployed } : {}),

      // Dates
      lock_expiration_at: parseIso(dates.lockExpiration as string),
      lock_expiration_date: dates.lockExpiration
        ? String(dates.lockExpiration).slice(0, 10)
        : null,
      estimated_closing_at: parseIso(dates.estimatedClosing as string),
      closing_date: dates.scheduleClosing
        ? String(dates.scheduleClosing).slice(0, 10)
        : null,
      appraisal_contingency_date: dates.appraisalContingency
        ? String(dates.appraisalContingency).slice(0, 10)
        : null,
      finance_contingency_date: dates.financingContingency
        ? String(dates.financingContingency).slice(0, 10)
        : null,

      lp_last_synced_at: new Date().toISOString(),
    };

    // Only set stage from LP if Shape hasn't given us one
    if (!existing?.status_raw && lpStage) {
      loanPayload.current_stage = lpStage;
    }

    // ── Upsert loan row ────────────────────────────────────────────────────
    let dbLoanId: string;
    if (existing?.id) {
      await admin.from("loans").update(loanPayload).eq("id", existing.id);
      dbLoanId = existing.id as string;
    } else {
      const { data: inserted, error } = await admin
        .from("loans")
        .insert({
          ...loanPayload,
          lead_created_at:
            parseIso(dates.created as string) ?? new Date().toISOString(),
        })
        .select("id")
        .single();
      if (error || !inserted) continue;
      dbLoanId = inserted.id as string;
    }
    result.loansUpserted++;

    // ── rich_loan_data ─────────────────────────────────────────────────────
    const richPayload = {
      loan_id: dbLoanId,
      front_dti: frontDti ?? null,
      back_dti: backDti ?? null,
      ltv_ratio_percent: ltvPct ?? null,
      combined_ltv_ratio_percent: cltvPct ?? null,
      note_rate: noteRatePct ?? null,
      apr: row.apr ?? null,
      rate_locked_at: parseIso(dates.rateLocked as string),
      lock_expiration_at: parseIso(dates.lockExpiration as string),
      estimated_closing_at: parseIso(dates.estimatedClosing as string),
      appraisal_contingency_at: parseIso(dates.appraisalContingency as string),
      financing_contingency_at: parseIso(dates.financingContingency as string),
      borrower_mobile_phone: contacts.mobilePhone
        ? String(contacts.mobilePhone)
        : null,
      borrower_email: contacts.email ? String(contacts.email) : null,
      borrower_address_json: subject,
      coborrower_first_name: coborrower?.firstName
        ? String(coborrower.firstName)
        : null,
      coborrower_last_name: coborrower?.lastName
        ? String(coborrower.lastName)
        : null,
      coborrower_phone: cobContacts.mobilePhone
        ? String(cobContacts.mobilePhone)
        : null,
      total_liquid_assets_cents: centsFromDecimal(row.totalLiquidAssets as number),
      lp_notes_json: row.notes ?? null,
      processing_checklist_json: dates.processingTrackingDates ?? null,
      service_providers_json: row.disclosure ?? null,
      lp_raw_json: row,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await admin
      .from("rich_loan_data")
      .upsert(richPayload, { onConflict: "loan_id" });

    // ── Conditions ─────────────────────────────────────────────────────────
    const conditions = (
      row.conditions as Array<Record<string, unknown>> | undefined
    ) ?? [];

    for (const c of conditions) {
      const extId = strField(c.id) ?? strField(c.conditionId);
      if (!extId) continue;

      const statusName = idNameName(c.status as IdName) ?? strField(c.status);
      const isCleared =
        c.isCleared === true ||
        /cleared|waived|satisfied/i.test(statusName ?? "");
      const lpStatus = isCleared ? "cleared" : "open";
      const title =
        strField(c.name) ??
        strField(c.conditionName) ??
        strField(c.description) ??
        "Untitled";
      const category = idNameName(c.categoryType as IdName) ?? idNameName(c.type as IdName);
      const dueDate = dates.lockExpiration
        ? String(dates.lockExpiration).slice(0, 10)
        : null;

      const { error } = await admin.from("conditions").upsert(
        {
          loan_id: dbLoanId,
          external_id: `lp:${extId}`,
          source: "lendingpad",
          title,
          status: lpStatus,
          category,
          description: strField(c.description),
          due_date: dueDate,
          cleared_at: isCleared ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "loan_id,external_id" },
      );
      if (!error) result.conditionsWritten++;
    }

    // ── Documents ──────────────────────────────────────────────────────────
    const documents = (
      row.documents as Array<Record<string, unknown>> | undefined
    ) ?? [];

    for (const d of documents) {
      const extId = strField(d.documentId) ?? strField(d.id);
      if (!extId) continue;

      const { error } = await admin.from("loan_documents").upsert(
        {
          loan_id: dbLoanId,
          source: "lendingpad",
          external_id: extId,
          name: strField(d.documentName) ?? strField(d.name) ?? "Untitled",
          category: strField(d.category) ?? strField(d.categoryName),
          uploaded_at: parseIso(strField(d.uploadedDate) ?? strField(d.uploadDate)),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "loan_id,source,external_id" },
      );
      if (!error) result.documentsWritten++;
    }

    // ── LP notes → loan_notes ──────────────────────────────────────────────
    const notes = (
      row.notes as Array<{ userName?: string; date?: string; message?: string }> | undefined
    ) ?? [];

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
  }

  return result;
}
