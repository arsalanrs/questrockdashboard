/**
 * Pull document metadata from LendingPad (GET only) and mirror into
 * public.loan_documents. We store metadata only (id, name, category,
 * uploadedAt) — never binary file contents.
 *
 * This is what powers the "Document Health" executive card + the
 * get_loan_document_status AI tool ("what's missing for this loan?").
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hasLendingPadReadConfig } from "./config";
import { getLendingPadLoanDocuments } from "./client";

export type LendingPadDocumentsSyncResult = {
  loansConsidered: number;
  loansSynced: number;
  documentsWritten: number;
  errors: string[];
};

function syncMaxLoans(): number {
  const raw = process.env.LENDINGPAD_SYNC_MAX_LOANS?.trim();
  const n = raw ? Number(raw) : 150;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 2000) : 150;
}

export async function runLendingPadDocumentsSync(): Promise<LendingPadDocumentsSyncResult> {
  const result: LendingPadDocumentsSyncResult = {
    loansConsidered: 0,
    loansSynced: 0,
    documentsWritten: 0,
    errors: [],
  };

  if (!hasLendingPadReadConfig()) {
    result.errors.push("LendingPad env not configured");
    return result;
  }

  const admin = createSupabaseAdminClient();
  const max = syncMaxLoans();

  const { data: rows, error } = await admin
    .from("loans")
    .select("id,lendingpad_loan_uuid")
    .not("lendingpad_loan_uuid", "is", null)
    .limit(max);

  if (error) {
    result.errors.push(error.message);
    return result;
  }

  const loans = (rows ?? []) as { id: string; lendingpad_loan_uuid: string | null }[];
  result.loansConsidered = loans.length;

  for (const row of loans) {
    const lpId = row.lendingpad_loan_uuid?.trim();
    if (!lpId) continue;
    try {
      const docs = await getLendingPadLoanDocuments(lpId);
      const dedup = new Map<string, (typeof docs)[0]>();
      for (const d of docs) {
        if (!dedup.has(d.id)) dedup.set(d.id, d);
      }
      const normalized = [...dedup.values()];
      const keepIds = new Set(normalized.map((d) => d.id));

      const { data: existing, error: exErr } = await admin
        .from("loan_documents")
        .select("id,external_id")
        .eq("loan_id", row.id)
        .eq("source", "lendingpad");
      if (exErr) throw exErr;

      for (const e of existing ?? []) {
        const ext = (e as { external_id: string | null }).external_id;
        if (ext && !keepIds.has(ext)) {
          await admin.from("loan_documents").delete().eq("id", (e as { id: string }).id);
        }
      }

      for (const d of normalized) {
        const { error: upErr } = await admin.from("loan_documents").upsert(
          {
            loan_id: row.id,
            source: "lendingpad",
            external_id: d.id,
            name: d.name,
            category: d.category,
            uploaded_at: d.uploadedAt,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "loan_id,source,external_id" },
        );
        if (upErr) throw upErr;
      }

      result.documentsWritten += normalized.length;
      result.loansSynced += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(`loan ${row.id}: ${msg}`);
    }
  }

  return result;
}
