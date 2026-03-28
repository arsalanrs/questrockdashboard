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

export type NormalizedLpLoanListItem = {
  id: string;
  loanNumber: string | null;
  /** LendingPad loanStatus.name (LOS pipeline). */
  statusRaw: string | null;
  /** loanStatusDate from list API, ISO when parseable. */
  statusAt: string | null;
  borrowerFirstName: string | null;
  borrowerLastName: string | null;
  loanAmountCents: number | null;
  propertyState: string | null;
  loanOfficerName: string | null;
};

function numToCents(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) {
    const cents = Math.round(v * 100);
    return Number.isSafeInteger(cents) ? cents : null;
  }
  const s = String(v).trim().replace(/[$,]/g, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

function loanAmountCentsFromRow(o: Record<string, unknown>): number | null {
  const cents = numToCents(o.loanAmountCents ?? o.loan_amount_cents);
  if (cents != null) return cents;
  return numToCents(
    o.loanAmount ?? o.loan_amount ?? o.amount ?? o.baseLoanAmount ?? o.totalLoanAmount,
  );
}

function borrowerFromRow(o: Record<string, unknown>): {
  first: string | null;
  last: string | null;
} {
  const tryBorrower = (b: unknown): { first: string | null; last: string | null } => {
    if (!b || typeof b !== "object")
      return { first: null, last: null };
    const r = b as Record<string, unknown>;
    return {
      first: strField(r, "firstName", "first_name", "first") || null,
      last: strField(r, "lastName", "last_name", "last") || null,
    };
  };

  let { first, last } = tryBorrower(o.borrower);
  if (!first && !last) ({ first, last } = tryBorrower(o.primaryBorrower));
  if (!first && !last) {
    const arr = o.borrowers;
    if (Array.isArray(arr) && arr[0]) ({ first, last } = tryBorrower(arr[0]));
  }
  if (!first) first = strField(o, "borrowerFirstName", "borrower_first_name") || null;
  if (!last) last = strField(o, "borrowerLastName", "borrower_last_name") || null;
  return { first, last };
}

function loanOfficerNameFromRow(o: Record<string, unknown>): string | null {
  const a = o.assignments;
  if (a && typeof a === "object") {
    const ao = a as Record<string, unknown>;
    const lo = ao.loanOfficer ?? ao.loan_officer ?? ao.loanOfficerUser;
    if (lo && typeof lo === "object") {
      const l = lo as Record<string, unknown>;
      const name =
        strField(l, "fullName", "full_name", "name", "displayName") ||
        [strField(l, "firstName"), strField(l, "lastName")].filter(Boolean).join(" ").trim();
      if (name) return name;
      const email = strField(l, "email");
      if (email) return email;
    }
  }
  return (
    strField(o, "loanOfficerName", "loan_officer_name", "officerName", "assignedOfficerName") || null
  );
}

export function normalizeLendingPadLoanListRow(raw: unknown): NormalizedLpLoanListItem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = strField(o, "id", "loanId", "loanID", "guid");
  if (!id) return null;
  const loanNumber = strField(o, "loanNumber", "loan_number", "number", "loanNo") || null;

  let statusRaw: string | null = null;
  const loanStatusObj = o.loanStatus;
  if (loanStatusObj && typeof loanStatusObj === "object") {
    statusRaw =
      strField(loanStatusObj as Record<string, unknown>, "name", "label", "description") || null;
  }
  if (!statusRaw) {
    statusRaw =
      strField(o, "status", "loanStatus", "statusName", "pipelineStatus", "milestone") || null;
  }

  const statusDateRaw = strField(o, "loanStatusDate", "loan_status_date", "statusDate") || null;
  let statusAt: string | null = null;
  if (statusDateRaw) {
    const t = Date.parse(statusDateRaw);
    statusAt = Number.isNaN(t) ? null : new Date(t).toISOString();
  }

  const { first: borrowerFirstName, last: borrowerLastName } = borrowerFromRow(o);
  const loanAmountCents = loanAmountCentsFromRow(o);
  let propertyState =
    strField(o, "propertyState", "property_state", "subjectPropertyState", "subjectState") || null;
  const subject = o.subjectPropertyAddress ?? o.subjectProperty;
  if (!propertyState && subject && typeof subject === "object") {
    propertyState =
      strField(subject as Record<string, unknown>, "state", "stateCode") || null;
  }
  const loanOfficerName = loanOfficerNameFromRow(o);

  return {
    id,
    loanNumber,
    statusRaw,
    statusAt,
    borrowerFirstName,
    borrowerLastName,
    loanAmountCents,
    propertyState: propertyState || null,
    loanOfficerName,
  };
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
