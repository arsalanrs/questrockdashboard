import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseShapeKpiCsv } from "@/lib/import/shape-kpi";
import { buildLoanPayloadFromRow } from "@/lib/import/build-loan-payload";
import { buildLoUserIdLookup } from "@/lib/import/resolve-lo-user-id";

export async function runShapeKpiImport(params: { csvText: string; filename?: string | null; importedByUserId?: string }) {
  const rows = parseShapeKpiCsv(params.csvText);
  const admin = createSupabaseAdminClient();

  const { data: batch, error: batchError } = await admin
    .from("import_batches")
    .insert({ source: "shape_kpi_csv", source_filename: params.filename ?? null, imported_by: params.importedByUserId ?? null })
    .select("id")
    .single();
  if (batchError) throw batchError;

  const importBatchId = batch.id as string;

  const rawPayload = rows
    .map((r) => {
      const recordId = Number(String(r["recordId"] ?? "").trim());
      if (!Number.isFinite(recordId)) return null;
      return { import_batch_id: importBatchId, record_id: recordId, row: r };
    })
    .filter(Boolean) as Array<{ import_batch_id: string; record_id: number; row: unknown }>;

  for (let i = 0; i < rawPayload.length; i += 500) {
    const chunk = rawPayload.slice(i, i + 500);
    const { error } = await admin.from("raw_shape_kpi_leads").insert(chunk);
    if (error) throw error;
  }

  const { data: mappingRows, error: mappingError } = await admin
    .from("stage_mapping")
    .select("source_status,normalized_stage");
  if (mappingError) throw mappingError;

  const statusToStage = new Map<string, string | null>();
  (mappingRows ?? []).forEach((m) => statusToStage.set(m.source_status, m.normalized_stage));

  const { data: users, error: usersError } = await admin.from("users").select("id,full_name,email");
  if (usersError) throw usersError;
  const appUsers = users ?? [];
  const { nameToUserId, emailToUserId } = buildLoUserIdLookup(appUsers);

  const loansPayload = rows
    .map((r) =>
      buildLoanPayloadFromRow(r, statusToStage, nameToUserId, importBatchId, emailToUserId, appUsers),
    )
    .filter(Boolean) as Record<string, unknown>[];

  for (let i = 0; i < loansPayload.length; i += 500) {
    const chunk = loansPayload.slice(i, i + 500);
    const { error } = await admin.from("loans").upsert(chunk, { onConflict: "shape_record_id" });
    if (error) throw error;
  }

  return { importedRows: rows.length, importedLoans: loansPayload.length, importBatchId };
}

