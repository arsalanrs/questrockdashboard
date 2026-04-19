import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Executive-dashboard summary of document completeness across the pipeline.
 *
 * - Top blockers: loans with the most missing priority-1/2 docs, capped to 20.
 * - Aggregate stats: total required, total provided, percentage complete.
 *
 * Relies on the public.loan_document_status_vw view (one row per loan/template,
 * is_provided=true/false) and public.loan_documents for raw doc counts.
 */

const PRIORITY_BLOCKER_MAX = 3;
const TOP_LOANS_LIMIT = 20;

export type DocumentHealthTopLoan = {
  loanId: string;
  borrower: string;
  lo: string | null;
  stage: string | null;
  loanType: string | null;
  loanPurpose: string | null;
  missingCount: number;
  missingDocs: string[];
};

export type DocumentHealthSummary = {
  loansTracked: number;
  totalRequired: number;
  totalProvided: number;
  completionPct: number;
  missingByCategory: { category: string; count: number }[];
  topBlockers: DocumentHealthTopLoan[];
  missingByLO: { lo: string; missingCount: number; loansAffected: number }[];
};

export async function loadDocumentHealth(admin: SupabaseClient): Promise<DocumentHealthSummary> {
  const { data, error } = await admin
    .from("loan_document_status_vw")
    .select(
      "loan_id,doc_name,doc_category,priority,is_provided,current_stage,loan_type,loan_purpose,assigned_loan_officer_name,borrower_first_name,borrower_last_name",
    )
    .limit(50000);
  if (error) throw error;

  const rows = data ?? [];
  if (rows.length === 0) {
    return {
      loansTracked: 0,
      totalRequired: 0,
      totalProvided: 0,
      completionPct: 0,
      missingByCategory: [],
      topBlockers: [],
      missingByLO: [],
    };
  }

  const loansTracked = new Set(rows.map((r) => r.loan_id as string)).size;
  const totalRequired = rows.length;
  const totalProvided = rows.filter((r) => r.is_provided).length;
  const completionPct = totalRequired > 0 ? Math.round((totalProvided / totalRequired) * 100) : 0;

  const missingByCategoryMap = new Map<string, number>();
  for (const r of rows) {
    if (r.is_provided) continue;
    const cat = (r.doc_category as string | null) ?? "Other";
    missingByCategoryMap.set(cat, (missingByCategoryMap.get(cat) ?? 0) + 1);
  }
  const missingByCategory = [...missingByCategoryMap.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const loanAgg = new Map<
    string,
    {
      loanId: string;
      borrower: string;
      lo: string | null;
      stage: string | null;
      loanType: string | null;
      loanPurpose: string | null;
      missingCount: number;
      missingDocs: string[];
      topPriority: number;
    }
  >();

  for (const r of rows) {
    if (r.is_provided) continue;
    const priority = r.priority as number;
    if (priority > PRIORITY_BLOCKER_MAX) continue;
    const id = r.loan_id as string;
    const bucket =
      loanAgg.get(id) ?? {
        loanId: id,
        borrower:
          [r.borrower_first_name, r.borrower_last_name].filter(Boolean).join(" ").trim() ||
          "Unknown borrower",
        lo: (r.assigned_loan_officer_name as string | null) ?? null,
        stage: (r.current_stage as string | null) ?? null,
        loanType: (r.loan_type as string | null) ?? null,
        loanPurpose: (r.loan_purpose as string | null) ?? null,
        missingCount: 0,
        missingDocs: [] as string[],
        topPriority: 99,
      };
    bucket.missingCount += 1;
    bucket.missingDocs.push(r.doc_name as string);
    bucket.topPriority = Math.min(bucket.topPriority, priority);
    loanAgg.set(id, bucket);
  }

  const topBlockers: DocumentHealthTopLoan[] = [...loanAgg.values()]
    .sort((a, b) => b.missingCount - a.missingCount || a.topPriority - b.topPriority)
    .slice(0, TOP_LOANS_LIMIT)
    .map((b) => ({
      loanId: b.loanId,
      borrower: b.borrower,
      lo: b.lo,
      stage: b.stage,
      loanType: b.loanType,
      loanPurpose: b.loanPurpose,
      missingCount: b.missingCount,
      missingDocs: b.missingDocs.slice(0, 5),
    }));

  const loMissingCount = new Map<string, { missingCount: number; loanSet: Set<string> }>();
  for (const r of rows) {
    if (r.is_provided) continue;
    const lo = (r.assigned_loan_officer_name as string | null) ?? "Unassigned";
    const bucket = loMissingCount.get(lo) ?? { missingCount: 0, loanSet: new Set<string>() };
    bucket.missingCount += 1;
    bucket.loanSet.add(r.loan_id as string);
    loMissingCount.set(lo, bucket);
  }
  const missingByLO = [...loMissingCount.entries()]
    .map(([lo, v]) => ({ lo, missingCount: v.missingCount, loansAffected: v.loanSet.size }))
    .sort((a, b) => b.missingCount - a.missingCount)
    .slice(0, 8);

  return {
    loansTracked,
    totalRequired,
    totalProvided,
    completionPct,
    missingByCategory,
    topBlockers,
    missingByLO,
  };
}
