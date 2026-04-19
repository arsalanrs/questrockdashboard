"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/current-user";
import { canAccessAdmin } from "@/lib/permissions";
import { runInsellerateImport } from "@/lib/import/run-insellerate-import";
import { runShapeKpiImport } from "@/lib/import/run-shape-kpi-import";
import { generateMockLoans, mockEnrichLoans } from "@/lib/mock/enrich";
import { hasShapeApiConfig } from "@/lib/shape-api/config";
import { runShapeApiPreview } from "@/lib/shape-api/preview";
import { runShapeApiSync } from "@/lib/shape-api/sync";
import { hasLendingPadReadConfig } from "@/lib/lendingpad/config";
import { runLendingPadConditionsSync } from "@/lib/lendingpad/sync-conditions";
import { runLendingPadLoansSync } from "@/lib/lendingpad/sync-loans";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const MAX_ERROR_PARAM_LENGTH = 200;

function errorParam(msg: string): string {
  const safe = msg.replace(/\s+/g, " ").replace(/<[^>]*>/g, "").trim();
  return encodeURIComponent(safe.length > MAX_ERROR_PARAM_LENGTH ? `${safe.slice(0, MAX_ERROR_PARAM_LENGTH)}…` : safe);
}

/**
 * Extract a readable message from anything thrown. Supabase throws plain
 * objects like { code, details, hint, message } that are not instanceof Error,
 * so generic fallbacks would otherwise swallow the real cause.
 */
function messageFrom(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    const parts = [
      typeof o.message === "string" ? o.message : null,
      typeof o.hint === "string" ? o.hint : null,
      typeof o.details === "string" ? o.details : null,
      typeof o.code === "string" ? `(${o.code})` : null,
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(" — ");
    try {
      return JSON.stringify(err);
    } catch {
      return fallback;
    }
  }
  return typeof err === "string" && err.trim() ? err : fallback;
}

async function runImportShapeKpiCsv(formData: FormData) {
  const { appUser } = await requireCurrentUser();
  if (!canAccessAdmin(appUser.role)) notFound();

  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("Missing CSV file.");

  const csvText = await file.text();
  const result = await runShapeKpiImport({ csvText, filename: file.name, importedByUserId: appUser.id });

  revalidatePath("/dashboard/lo");
  revalidatePath("/dashboard/manager");
  revalidatePath("/dashboard/executive");
  revalidatePath("/admin/import");

  return result;
}

export async function importShapeKpiCsv(formData: FormData) {
  try {
    const result = await runImportShapeKpiCsv(formData);
    redirect(
      `/admin/import?ok=1&batch=${encodeURIComponent(result.importBatchId)}&rows=${result.importedRows}&loans=${result.importedLoans}`
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Import failed";
    redirect(`/admin/import?error=${errorParam(msg)}`);
  }
}

export async function importInsellerateXlsx(formData: FormData) {
  const { appUser } = await requireCurrentUser();
  if (!canAccessAdmin(appUser.role)) notFound();

  const file = formData.get("file");
  if (!(file instanceof File)) {
    redirect(`/admin/import?error=${errorParam("Missing .xlsx file.")}`);
  }
  const noMerge = String(formData.get("noMerge") ?? "") === "1";

  try {
    const arrayBuffer = await (file as File).arrayBuffer();
    const result = await runInsellerateImport({
      buffer: arrayBuffer,
      filename: (file as File).name,
      importedByUserId: appUser.id,
      mergeActiveToLoans: !noMerge,
    });
    revalidatePath("/dashboard/executive");
    revalidatePath("/admin/import");
    const params = new URLSearchParams({
      ok: "1",
      insellerate: "1",
      batch: result.importBatchId,
      insRows: String(result.totalRows),
      insHistorical: String(result.historicalUpserted),
      insLoans: String(result.loansUpserted),
      insActive: String(result.activeCandidates),
    });
    if (result.unmatchedLoanOfficers.length) {
      params.set("insUnmatchedLOs", result.unmatchedLoanOfficers.slice(0, 10).join(","));
    }
    redirect(`/admin/import?${params.toString()}`);
  } catch (e) {
    // next/navigation `redirect()` throws a NEXT_REDIRECT internally — let it bubble.
    if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
    console.error("Insellerate import failed:", e);
    const msg = messageFrom(e, "Insellerate import failed");
    redirect(`/admin/import?error=${errorParam(msg)}`);
  }
}

export async function mockEnrichImportedLoans(formData: FormData) {
  const { appUser } = await requireCurrentUser();
  if (!canAccessAdmin(appUser.role)) notFound();

  const importBatchId = String(formData.get("importBatchId") || "").trim() || undefined;
  const limit = Number(String(formData.get("limit") || "").trim() || "0") || undefined;

  try {
    const result = await mockEnrichLoans({ importBatchId, limit });
    revalidatePath("/dashboard/lo");
    revalidatePath("/dashboard/manager");
    revalidatePath("/dashboard/executive");
    redirect(`/admin/import?ok=1&enriched=${result.enriched}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Enrichment failed";
    redirect(`/admin/import?error=${errorParam(msg)}`);
  }
}

export async function generateMockLoanData(formData: FormData) {
  const { appUser } = await requireCurrentUser();
  if (!canAccessAdmin(appUser.role)) notFound();

  const count = Number(String(formData.get("count") || "").trim() || "100") || 100;

  try {
    const result = await generateMockLoans({ count });
    revalidatePath("/dashboard/lo");
    revalidatePath("/dashboard/manager");
    revalidatePath("/dashboard/executive");
    redirect(`/admin/import?ok=1&created=${result.created}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Mock generation failed";
    redirect(`/admin/import?error=${errorParam(msg)}`);
  }
}

export async function runShapeApiPreviewAction(): Promise<
  { ok: true; data: Awaited<ReturnType<typeof runShapeApiPreview>> } | { ok: false; error: string }
> {
  const { appUser } = await requireCurrentUser();
  if (!canAccessAdmin(appUser.role)) notFound();

  if (!hasShapeApiConfig()) {
    return { ok: false, error: "Shape API sync is not configured. Set SHAPE_API_KEY in .env.local." };
  }

  try {
    const data = await runShapeApiPreview({});
    return { ok: true, data };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Preview failed";
    return { ok: false, error: msg };
  }
}

export async function runShapeApiSyncAction(formData: FormData) {
  const { appUser } = await requireCurrentUser();
  if (!canAccessAdmin(appUser.role)) notFound();

  if (!hasShapeApiConfig()) {
    redirect(
      `/admin/import?error=${encodeURIComponent("Shape API sync is not configured. Set SHAPE_API_KEY in .env.local.")}`
    );
  }

  const dateFrom = (formData.get("dateFrom") as string)?.trim() || undefined;
  const dateTo = (formData.get("dateTo") as string)?.trim() || undefined;

  try {
    const result = await runShapeApiSync({ mode: "full", dateFrom, dateTo });
    revalidatePath("/dashboard/lo");
    revalidatePath("/dashboard/manager");
    revalidatePath("/dashboard/executive");
    revalidatePath("/admin/import");
    const params = new URLSearchParams({
      ok: "1",
      sync: "1",
      syncPages: String(result.pages),
      syncRecords: String(result.recordsProcessed),
      syncSkipped: String(result.recordsSkipped),
      syncLoans: String(result.loansUpserted),
    });
    if (result.unmappedStatuses?.length) {
      params.set("unmapped", result.unmappedStatuses.slice(0, 20).join(","));
    }
    redirect(`/admin/import?${params.toString()}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Shape API sync failed";
    redirect(`/admin/import?error=${errorParam(msg)}`);
  }
}

/** Returns sync result without redirect (avoids long error URLs). Use from client component. */
export async function runShapeApiSyncReturn(formData: FormData): Promise<
  | { ok: true; result: Awaited<ReturnType<typeof runShapeApiSync>> }
  | { ok: false; error: string }
> {
  const { appUser } = await requireCurrentUser();
  if (!canAccessAdmin(appUser.role)) {
    return { ok: false, error: "Forbidden" };
  }

  if (!hasShapeApiConfig()) {
    return { ok: false, error: "Shape API sync is not configured. Set SHAPE_API_KEY in .env.local." };
  }

  const dateFrom = (formData.get("dateFrom") as string)?.trim() || undefined;
  const dateTo = (formData.get("dateTo") as string)?.trim() || undefined;

  try {
    const result = await runShapeApiSync({ mode: "full", dateFrom, dateTo });
    revalidatePath("/dashboard/lo");
    revalidatePath("/dashboard/manager");
    revalidatePath("/dashboard/executive");
    revalidatePath("/admin/import");
    return { ok: true, result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Shape API sync failed";
    return { ok: false, error: msg.length > 300 ? `${msg.slice(0, 300)}…` : msg };
  }
}

/** LendingPad loans list + conditions sync; returns JSON for admin UI (no redirect). */
export async function runLendingPadSyncReturn(): Promise<
  | {
      ok: true;
      loans: Awaited<ReturnType<typeof runLendingPadLoansSync>>;
      conditions: Awaited<ReturnType<typeof runLendingPadConditionsSync>>;
    }
  | { ok: false; error: string }
> {
  const { appUser } = await requireCurrentUser();
  if (!canAccessAdmin(appUser.role)) {
    return { ok: false, error: "Forbidden" };
  }

  if (!hasLendingPadReadConfig()) {
    return {
      ok: false,
      error:
        "LendingPad is not configured. Set LENDINGPAD_USERNAME, LENDINGPAD_PASSWORD, LENDINGPAD_CONTACT_ID, LENDINGPAD_COMPANY_ID.",
    };
  }

  try {
    const loans = await runLendingPadLoansSync();
    const conditions = await runLendingPadConditionsSync();
    revalidatePath("/dashboard/lo");
    revalidatePath("/dashboard/manager");
    revalidatePath("/dashboard/executive");
    revalidatePath("/dashboard/processor");
    revalidatePath("/admin/import");
    return { ok: true, loans, conditions };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "LendingPad sync failed";
    return { ok: false, error: msg.length > 300 ? `${msg.slice(0, 300)}…` : msg };
  }
}

export async function clearSyncData() {
  const { appUser } = await requireCurrentUser();
  if (!canAccessAdmin(appUser.role)) notFound();

  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc("truncate_sync_data");
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/lo");
  revalidatePath("/dashboard/manager");
  revalidatePath("/dashboard/executive");
  revalidatePath("/admin/import");
  redirect("/admin/import?ok=1&cleared=1");
}

export async function resetUserPassword(formData: FormData) {
  const { appUser } = await requireCurrentUser();
  if (!canAccessAdmin(appUser.role)) notFound();

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();
  if (!email || !password) redirect("/admin/import?error=Missing%20email%20or%20password");

  const admin = createSupabaseAdminClient();
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 500 });
  const user = list?.users?.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
  if (!user) redirect("/admin/import?error=User%20not%20found");

  const { error } = await admin.auth.admin.updateUserById(user.id, { password });
  if (error) redirect(`/admin/import?error=${encodeURIComponent(error.message)}`);

  revalidatePath("/admin/import");
  redirect("/admin/import?ok=1&passwordReset=1");
}

