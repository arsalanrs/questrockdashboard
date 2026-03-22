import { createHash } from "node:crypto";

export function buildBasicAuthHeader(username: string, password: string): string {
  const token = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

export function extractJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    for (const k of ["data", "items", "results", "conditions", "documents", "loans", "value", "rows"]) {
      const v = o[k];
      if (Array.isArray(v)) return v;
    }
    for (const v of Object.values(o)) {
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

function hashTitle(title: string): string {
  return createHash("sha256").update(title, "utf8").digest("hex").slice(0, 32);
}

function normalizeConditionStatus(raw: string): "open" | "cleared" {
  const s = raw.toLowerCase();
  if (
    s.includes("clear") ||
    s.includes("waiv") ||
    s.includes("satisf") ||
    s.includes("complete") ||
    s.includes("resolved") ||
    s.includes("approved")
  ) {
    return "cleared";
  }
  return "open";
}

export type NormalizedLpCondition = {
  externalId: string;
  title: string;
  status: "open" | "cleared";
  clearedAt: string | null;
};

function strField(o: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}

export function normalizeLendingPadConditionRow(raw: unknown): NormalizedLpCondition | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const title = strField(o, "title", "name", "description", "text", "conditionName", "condition", "summary");
  if (!title) return null;

  const idRaw = o.id ?? o.conditionId ?? o.guid ?? o.key ?? o.conditionID;
  const externalId =
    idRaw != null && String(idRaw).trim() ? String(idRaw).trim() : `h:${hashTitle(title)}`;

  const statusRaw = strField(o, "status", "state", "conditionStatus", "statusName") || "open";
  const status = normalizeConditionStatus(statusRaw);

  const clearedRaw =
    strField(o, "clearedDate", "clearedAt", "dateCleared", "resolvedDate", "completedDate") || null;
  let clearedAt: string | null = null;
  if (clearedRaw) {
    const t = Date.parse(clearedRaw);
    clearedAt = Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  if (status === "cleared" && !clearedAt) clearedAt = new Date().toISOString();

  return { externalId, title, status, clearedAt };
}

export function parseLendingPadConditionsResponse(json: unknown): NormalizedLpCondition[] {
  const arr = extractJsonArray(json);
  const out: NormalizedLpCondition[] = [];
  for (const row of arr) {
    const n = normalizeLendingPadConditionRow(row);
    if (n) out.push(n);
  }
  return out;
}

export type NormalizedLpLoanListItem = { id: string; loanNumber: string | null };

export function normalizeLendingPadLoanListRow(raw: unknown): NormalizedLpLoanListItem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = strField(o, "id", "loanId", "loanID", "guid");
  if (!id) return null;
  const loanNumber = strField(o, "loanNumber", "loan_number", "number", "loanNo") || null;
  return { id, loanNumber };
}

export function parseLendingPadListLoansResponse(json: unknown): NormalizedLpLoanListItem[] {
  const arr = extractJsonArray(json);
  const out: NormalizedLpLoanListItem[] = [];
  for (const row of arr) {
    const n = normalizeLendingPadLoanListRow(row);
    if (n) out.push(n);
  }
  return out;
}

export type NormalizedLpDocument = {
  id: string;
  name: string;
  category: string | null;
  uploadedAt: string | null;
};

export function normalizeLendingPadDocumentRow(raw: unknown): NormalizedLpDocument | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = strField(o, "id", "documentId", "guid", "documentID");
  const name = strField(o, "name", "title", "fileName", "file_name", "documentName");
  if (!id || !name) return null;
  const category = strField(o, "category", "type", "folder") || null;
  const uploadedRaw = strField(o, "uploadedAt", "createdDate", "creationDate", "dateCreated") || null;
  let uploadedAt: string | null = null;
  if (uploadedRaw) {
    const t = Date.parse(uploadedRaw);
    uploadedAt = Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  return { id, name, category, uploadedAt };
}

export function parseLendingPadDocumentsResponse(json: unknown): NormalizedLpDocument[] {
  const arr = extractJsonArray(json);
  const out: NormalizedLpDocument[] = [];
  for (const row of arr) {
    const n = normalizeLendingPadDocumentRow(row);
    if (n) out.push(n);
  }
  return out;
}

export function normalizeLendingPadLoanUuid(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRe.test(s) ? s : null;
}
