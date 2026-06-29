/**
 * Shape-driven LendingPad enrichment — after Shape sync, walk each Shape loan and
 * fetch LP detail, documents, conditions, and probe all known endpoints.
 *
 * Writes a JSON report to data/probe-results/ for diagnosing which LP APIs work
 * on this account (vs needing company report ingest).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { linkShapeLoansToLendingPad, PIPELINE_STATUSES_FOR_LP_FUZZY } from "@/lib/shape-api/link-shape-lp";
import { hasLendingPadReadConfig } from "./config";
import { getLendingPadLoanDetail } from "./client";
import type { NormalizedLpLoanDetail } from "./parse-response";
import { probeLendingPadLoanEndpoints, type LpEndpointProbeResult } from "./probe-loan-endpoints";
import { syncConditionsForLoan } from "./sync-conditions";
import { syncDocumentsForLoan } from "./sync-documents";
import { upsertLpApiProbe, upsertRichLoanDataFromSync } from "./upsert-rich-loan-data";

export type ShapeLoansLpEnrichmentOptions = {
  /** Max Shape loans to process (default: all with pagination). */
  maxLoans?: number;
  /** Probe milestone/timeline/etc. paths (slower). Default true. */
  probeExtraEndpoints?: boolean;
  /** Write report JSON under data/probe-results/. Default true. */
  writeReport?: boolean;
  /** Also probe LP-only rows (no Shape link) to validate LP APIs. Default true. */
  alsoEnrichLpOnlyRows?: boolean;
};

export type ShapeLoanEnrichmentSample = {
  loanId: string;
  shapeRecordId: number | null;
  lendingpadLoanUuid: string | null;
  borrowerName: string | null;
  detailParsed: boolean;
  documentsCount: number | null;
  conditionsCount: number | null;
  endpointKinds: Record<string, string>;
  linkedFromCache?: boolean;
};

export type ShapeLoansLpEnrichmentResult = {
  shapeLoansConsidered: number;
  withLpUuid: number;
  withoutLpUuid: number;
  enriched: number;
  detailParsed: number;
  documentsLoans: number;
  documentsWritten: number;
  conditionsLoans: number;
  conditionsWritten: number;
  endpointSummary: Record<string, { json: number; html: number; empty: number; error: number }>;
  recommendCompanyReport: boolean;
  recommendation: string;
  reportPath: string | null;
  shapeLpLinks: { shapeCandidates: number; linked: number; duplicatesRemoved: number };
  lpOnlyEnriched: number;
  samples: ShapeLoanEnrichmentSample[];
  errors: string[];
};

type ShapeLoanRow = {
  id: string;
  shape_record_id: number | null;
  lendingpad_loan_uuid: string | null;
  borrower_first_name: string | null;
  borrower_last_name: string | null;
  lead_created_at: string | null;
  status_raw: string | null;
};

type LpOnlyRow = {
  id: string;
  lendingpad_loan_uuid: string;
  borrower_first_name: string | null;
  borrower_last_name: string | null;
  lead_created_at: string | null;
};

function normBorrowerName(first: string | null, last: string | null): string {
  return `${String(first ?? "").trim()} ${String(last ?? "").trim()}`.toLowerCase().replace(/\s+/g, " ").trim();
}

function resolveLpUuidFromCache(row: ShapeLoanRow, lpOnlyRows: LpOnlyRow[]): LpOnlyRow | null {
  const shapeName = normBorrowerName(row.borrower_first_name, row.borrower_last_name);
  const shapeDate = row.lead_created_at ? new Date(row.lead_created_at).getTime() : null;
  if (!shapeName) return null;

  const nameMatches = lpOnlyRows.filter(
    (lp) => normBorrowerName(lp.borrower_first_name, lp.borrower_last_name) === shapeName,
  );
  if (nameMatches.length === 0) return null;
  if (nameMatches.length === 1) return nameMatches[0]!;

  if (!shapeDate) return null;
  return (
    nameMatches.find((lp) => {
      const lpDate = lp.lead_created_at ? new Date(lp.lead_created_at).getTime() : null;
      if (!lpDate) return false;
      return Math.abs(shapeDate - lpDate) <= 30 * 24 * 60 * 60 * 1000;
    }) ?? null
  );
}

function enrichMaxLoans(override?: number): number {
  if (override != null) return override;
  const raw = process.env.LENDINGPAD_ENRICH_MAX_LOANS?.trim();
  if (!raw) return 10_000;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10_000) : 10_000;
}

function loanDetailUpdateFields(detail: NormalizedLpLoanDetail): Record<string, unknown> {
  const map: Record<string, unknown> = { lp_last_synced_at: new Date().toISOString() };
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

function summarizeEndpoints(rows: LpEndpointProbeResult[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    out[r.path] = r.kind;
  }
  return out;
}

function bumpEndpointSummary(
  summary: ShapeLoansLpEnrichmentResult["endpointSummary"],
  rows: LpEndpointProbeResult[],
): void {
  for (const r of rows) {
    if (!summary[r.path]) {
      summary[r.path] = { json: 0, html: 0, empty: 0, error: 0 };
    }
    summary[r.path][r.kind] += 1;
  }
}

function buildRecommendation(
  endpointSummary: ShapeLoansLpEnrichmentResult["endpointSummary"],
  detailParsed: number,
  withLpUuid: number,
): { recommendCompanyReport: boolean; recommendation: string } {
  const detailPaths = Object.keys(endpointSummary).filter(
    (p) => p.includes("/detail") || p.endsWith("/integrations/loans"),
  );
  const detailJson =
    detailPaths.reduce((n, p) => n + (endpointSummary[p]?.json ?? 0), 0) > 0;
  const documentsJson = (endpointSummary["/integrations/loans/documents"]?.json ?? 0) > 0;
  const conditionsJson = (endpointSummary["/integrations/loans/conditions"]?.json ?? 0) > 0;
  const extraJson = Object.entries(endpointSummary).some(
    ([p, c]) =>
      !detailPaths.includes(p) &&
      !p.includes("/documents") &&
      !p.includes("/conditions") &&
      c.json > 0,
  );

  if (detailParsed === 0 && withLpUuid > 0 && !detailJson) {
    return {
      recommendCompanyReport: true,
      recommendation:
        "LP detail/milestone endpoints return HTML or errors on this account. Use LendingPad company report export (process-export.ts) for full dates, DTI, notes, and milestone history.",
    };
  }
  if (documentsJson && !conditionsJson) {
    return {
      recommendCompanyReport: false,
      recommendation:
        "Documents API works; conditions API is disabled for this contact. Enable inbound conditions in LendingPad or use company report for conditions.",
    };
  }
  if (detailJson || detailParsed > 0) {
    return {
      recommendCompanyReport: !extraJson,
      recommendation: extraJson
        ? "Core LP APIs work. Some extra endpoints (milestones/timeline) may still need company report for full history."
        : "List + detail APIs work for linked loans. Continue list sync; use company report only for fields not in list/detail.",
    };
  }
  return {
    recommendCompanyReport: true,
    recommendation:
      "Insufficient LP JSON from per-loan APIs. Run company report ingest for rich milestone dates and underwriting fields.",
  };
}

async function fetchPipelineShapeLoans(max: number): Promise<{
  pipelineShape: ShapeLoanRow[];
  totalShape: number;
  pipelineCount: number;
  lpOnlyRows: LpOnlyRow[];
}> {
  const admin = createSupabaseAdminClient();

  const { count: totalShape } = await admin
    .from("loans")
    .select("*", { count: "exact", head: true })
    .not("shape_record_id", "is", null);

  const statuses = [...PIPELINE_STATUSES_FOR_LP_FUZZY];
  const { count: pipelineCount } = await admin
    .from("loans")
    .select("*", { count: "exact", head: true })
    .not("shape_record_id", "is", null)
    .in("status_raw", statuses);

  const pageSize = 500;
  const pipelineShape: ShapeLoanRow[] = [];
  let offset = 0;

  while (pipelineShape.length < max) {
    const { data, error } = await admin
      .from("loans")
      .select(
        "id,shape_record_id,lendingpad_loan_uuid,borrower_first_name,borrower_last_name,lead_created_at,status_raw",
      )
      .not("shape_record_id", "is", null)
      .in("status_raw", statuses)
      .order("lead_created_at", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as ShapeLoanRow[];
    if (batch.length === 0) break;
    pipelineShape.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }

  const { data: lpOnlyRowsRaw } = await admin
    .from("loans")
    .select("id,lendingpad_loan_uuid,borrower_first_name,borrower_last_name,lead_created_at")
    .is("shape_record_id", null)
    .not("lendingpad_loan_uuid", "is", null)
    .limit(2000);

  return {
    pipelineShape: pipelineShape.slice(0, max),
    totalShape: totalShape ?? 0,
    pipelineCount: pipelineCount ?? 0,
    lpOnlyRows: (lpOnlyRowsRaw ?? []) as LpOnlyRow[],
  };
}

export async function runShapeLoansLpEnrichmentSync(
  options?: ShapeLoansLpEnrichmentOptions,
): Promise<ShapeLoansLpEnrichmentResult> {
  const result: ShapeLoansLpEnrichmentResult = {
    shapeLoansConsidered: 0,
    withLpUuid: 0,
    withoutLpUuid: 0,
    enriched: 0,
    detailParsed: 0,
    documentsLoans: 0,
    documentsWritten: 0,
    conditionsLoans: 0,
    conditionsWritten: 0,
    endpointSummary: {},
    recommendCompanyReport: false,
    recommendation: "",
    reportPath: null,
    shapeLpLinks: { shapeCandidates: 0, linked: 0, duplicatesRemoved: 0 },
    lpOnlyEnriched: 0,
    samples: [],
    errors: [],
  };

  if (!hasLendingPadReadConfig()) {
    result.errors.push("LendingPad env not configured");
    return result;
  }

  const admin = createSupabaseAdminClient();
  const max = enrichMaxLoans(options?.maxLoans);
  const probeExtra = options?.probeExtraEndpoints !== false;
  const writeReport = options?.writeReport !== false;
  const alsoEnrichLpOnly = options?.alsoEnrichLpOnlyRows !== false;

  try {
    result.shapeLpLinks = await linkShapeLoansToLendingPad(admin);
  } catch (e) {
    result.errors.push(`shape-lp link: ${e instanceof Error ? e.message : String(e)}`);
  }

  let shapeLoans: ShapeLoanRow[];
  let lpOnlyRows: LpOnlyRow[] = [];
  try {
    const fetched = await fetchPipelineShapeLoans(max);
    shapeLoans = fetched.pipelineShape;
    lpOnlyRows = fetched.lpOnlyRows;
    result.shapeLoansConsidered = fetched.totalShape;
    result.withoutLpUuid = 0;
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : String(e));
    return result;
  }

  result.withLpUuid = 0;
  const probedAt = new Date().toISOString();
  const fullReportLoans: Array<{
    loanId: string;
    shapeRecordId: number | null;
    lendingpadLoanUuid: string | null;
    probe: LpEndpointProbeResult[];
    detailParsed: boolean;
    documentsCount: number | null;
    conditionsCount: number | null;
    errors: string[];
  }> = [];

  async function enrichOneLoan(
    row: { id: string; shape_record_id: number | null },
    lpUuid: string,
    meta: { borrowerName: string | null; linkedFromCache?: boolean },
  ): Promise<void> {
    const loanErrors: string[] = [];
    let detailParsed = false;
    let documentsCount: number | null = null;
    let conditionsCount: number | null = null;
    let probeRows: LpEndpointProbeResult[] = [];

    try {
      probeRows = await probeLendingPadLoanEndpoints(lpUuid, {
        includeExtraPaths: probeExtra,
      });
      bumpEndpointSummary(result.endpointSummary, probeRows);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      loanErrors.push(`probe: ${msg}`);
      result.errors.push(`probe ${row.id}: ${msg}`);
    }

    try {
      const detail = await getLendingPadLoanDetail(lpUuid);
      if (detail) {
        detailParsed = true;
        result.detailParsed += 1;
        const { error: upErr } = await admin.from("loans").update(loanDetailUpdateFields(detail)).eq("id", row.id);
        if (upErr) throw upErr;
        await upsertRichLoanDataFromSync(admin, row.id, detail, null);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      loanErrors.push(`detail: ${msg}`);
      result.errors.push(`detail ${row.id}: ${msg}`);
    }

    try {
      const { written } = await syncDocumentsForLoan(admin, row.id, lpUuid);
      documentsCount = written;
      result.documentsWritten += written;
      result.documentsLoans += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      loanErrors.push(`documents: ${msg}`);
      result.errors.push(`documents ${row.id}: ${msg}`);
    }

    try {
      const { written } = await syncConditionsForLoan(admin, row.id, lpUuid);
      conditionsCount = written;
      result.conditionsWritten += written;
      result.conditionsLoans += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      loanErrors.push(`conditions: ${msg}`);
      result.errors.push(`conditions ${row.id}: ${msg}`);
    }

    try {
      await upsertLpApiProbe(admin, row.id, {
        probedAt,
        lendingpadLoanUuid: lpUuid,
        endpoints: probeRows,
        detailParsed,
        documentsCount,
        conditionsCount,
        errors: loanErrors,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(`apiProbe ${row.id}: ${msg}`);
    }

    result.enriched += 1;

    if (result.samples.length < 12) {
      result.samples.push({
        loanId: row.id,
        shapeRecordId: row.shape_record_id,
        lendingpadLoanUuid: lpUuid,
        borrowerName: meta.borrowerName,
        detailParsed,
        documentsCount,
        conditionsCount,
        endpointKinds: summarizeEndpoints(probeRows),
        linkedFromCache: meta.linkedFromCache,
      });
    }

    if (fullReportLoans.length < 50) {
      fullReportLoans.push({
        loanId: row.id,
        shapeRecordId: row.shape_record_id,
        lendingpadLoanUuid: lpUuid,
        probe: probeRows,
        detailParsed,
        documentsCount,
        conditionsCount,
        errors: loanErrors,
      });
    }
  }

  for (const row of shapeLoans) {
    let lpUuid = row.lendingpad_loan_uuid?.trim() || null;
    let linkedFromCache = false;

    if (!lpUuid) {
      const match = resolveLpUuidFromCache(row, lpOnlyRows);
      if (match) {
        lpUuid = match.lendingpad_loan_uuid;
        linkedFromCache = true;
        try {
          await admin.from("loans").update({ lendingpad_loan_uuid: lpUuid }).eq("id", row.id);
          await admin.from("loans").delete().eq("id", match.id);
          const idx = lpOnlyRows.findIndex((r) => r.id === match.id);
          if (idx >= 0) lpOnlyRows.splice(idx, 1);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          result.errors.push(`link ${row.id}: ${msg}`);
        }
      }
    }

    if (!lpUuid) {
      result.withoutLpUuid += 1;
      continue;
    }
    result.withLpUuid += 1;

    await enrichOneLoan(row, lpUuid, {
      borrowerName: [row.borrower_first_name, row.borrower_last_name].filter(Boolean).join(" ") || null,
      linkedFromCache,
    });
  }

  if (alsoEnrichLpOnly && result.enriched < max) {
    const remaining = max - result.enriched;
    for (const lpRow of lpOnlyRows.slice(0, remaining)) {
      result.lpOnlyEnriched += 1;
      result.withLpUuid += 1;
      await enrichOneLoan(
        { id: lpRow.id, shape_record_id: null },
        lpRow.lendingpad_loan_uuid,
        {
          borrowerName:
            [lpRow.borrower_first_name, lpRow.borrower_last_name].filter(Boolean).join(" ") || null,
        },
      );
    }
  }

  const rec = buildRecommendation(result.endpointSummary, result.detailParsed, result.withLpUuid);
  result.recommendCompanyReport = rec.recommendCompanyReport;
  result.recommendation = rec.recommendation;

  if (writeReport) {
    try {
      const outDir = join(process.cwd(), "data", "probe-results");
      mkdirSync(outDir, { recursive: true });
      const stamp = probedAt.replace(/[:.]/g, "-");
      const reportPath = join(outDir, `lp-enrichment-report-${stamp}.json`);
      writeFileSync(
        reportPath,
        JSON.stringify(
          {
            probedAt,
            summary: {
              shapeLoansTotal: result.shapeLoansConsidered,
              pipelineLoansProcessed: shapeLoans.length,
              shapeLpLinks: result.shapeLpLinks,
              withLpUuid: result.withLpUuid,
              withoutLpUuid: result.withoutLpUuid,
              enriched: result.enriched,
              detailParsed: result.detailParsed,
              documentsWritten: result.documentsWritten,
              conditionsWritten: result.conditionsWritten,
              endpointSummary: result.endpointSummary,
              recommendCompanyReport: result.recommendCompanyReport,
              recommendation: result.recommendation,
              errorCount: result.errors.length,
              sampleErrors: result.errors.slice(0, 20),
            },
            samples: result.samples,
            loans: fullReportLoans,
          },
          null,
          2,
        ),
      );
      result.reportPath = reportPath;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(`report write: ${msg}`);
    }
  }

  return result;
}
