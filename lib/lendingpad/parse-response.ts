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
  loanType: string | null;
  loanPurpose: string | null;
  creditScoreMid: number | null;
  propertyValueCents: number | null;
  ltvBps: number | null;
  fundedAt: string | null;
  /** borrowers[].latestCreditReportIdentifier.date when present. */
  creditReportRequestedAt: string | null;
  /** estimatedClosingDate from list API (ISO date). */
  estimatedClosingDate: string | null;
  lockDate: string | null;
  lockExpirationDate: string | null;
  lockStatusName: string | null;
  /** loanDates blob from list API (status history / lastModified). */
  loanDatesJson: Record<string, unknown> | null;
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
    o.totalLoanAmount ??
      o.loanAmount ??
      o.loan_amount ??
      o.amount ??
      o.baseLoanAmount,
  );
}

function parseIsoTimestamp(value: unknown): string | null {
  if (value == null || value === "") return null;
  const t = Date.parse(String(value));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function parseIsoDateOnly(value: unknown): string | null {
  const iso = parseIsoTimestamp(value);
  return iso ? iso.slice(0, 10) : null;
}

function creditReportDateFromRow(o: Record<string, unknown>): string | null {
  const borrowers = o.borrowers;
  if (!Array.isArray(borrowers)) return null;
  for (const b of borrowers) {
    if (!b || typeof b !== "object") continue;
    const ident = (b as Record<string, unknown>).latestCreditReportIdentifier;
    if (ident && typeof ident === "object") {
      const date = (ident as Record<string, unknown>).date;
      const parsed = parseIsoTimestamp(date);
      if (parsed) return parsed;
    }
  }
  return null;
}

function lockFieldsFromRow(o: Record<string, unknown>): {
  lockDate: string | null;
  lockExpirationDate: string | null;
  lockStatusName: string | null;
} {
  const secondary = o.secondary;
  if (!secondary || typeof secondary !== "object") {
    return { lockDate: null, lockExpirationDate: null, lockStatusName: null };
  }
  const buy = (secondary as Record<string, unknown>).buy;
  if (!buy || typeof buy !== "object") {
    return { lockDate: null, lockExpirationDate: null, lockStatusName: null };
  }
  const bo = buy as Record<string, unknown>;
  const lockStatus = bo.lockStatus;
  const lockStatusName =
    lockStatus && typeof lockStatus === "object"
      ? strField(lockStatus as Record<string, unknown>, "name", "label")
      : null;
  return {
    lockDate: parseIsoDateOnly(bo.lockDate),
    lockExpirationDate: parseIsoDateOnly(bo.lockExpirationDate),
    lockStatusName: lockStatusName || null,
  };
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

function objectNameField(v: unknown): string | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  return strField(o, "name", "label", "description") || null;
}

function pctToBps(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[%,\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  return n < 2 ? Math.round(n * 10000) : Math.round(n * 100);
}

function timestampFromStatus(statusRaw: string | null, statusAt: string | null): string | null {
  if (!statusRaw || !statusAt) return null;
  const s = statusRaw.toLowerCase();
  if (s.includes("fund")) return statusAt;
  if (s.includes("closed")) return statusAt;
  return null;
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
  const loanType =
    objectNameField(o.loanType) ??
    (strField(o, "loanType", "loan_type", "productName", "product") || null);
  const loanPurpose =
    objectNameField(o.purpose) ??
    objectNameField(o.loanPurpose) ??
    (strField(o, "purpose", "loanPurpose", "loan_purpose") || null);
  const creditScoreRaw = o.creditScore ?? o.ficoScore ?? o.midFico;
  const creditScoreMid =
    creditScoreRaw == null || creditScoreRaw === ""
      ? null
      : Number.isFinite(Number(creditScoreRaw))
        ? Math.round(Number(creditScoreRaw))
        : null;
  const propertyValueCents = numToCents(o.appraisalValue ?? o.propertyValue ?? o.appraisedValue);
  let ltvBps: number | null = pctToBps(o.ltv ?? o.loanToValue ?? o.LTV);
  if (ltvBps == null && loanAmountCents != null && propertyValueCents != null && propertyValueCents > 0) {
    ltvBps = Math.round((loanAmountCents / propertyValueCents) * 10000);
  }
  const fundedAt = timestampFromStatus(statusRaw, statusAt);
  const creditReportRequestedAt = creditReportDateFromRow(o);
  const estimatedClosingDate = parseIsoDateOnly(o.estimatedClosingDate);
  const { lockDate, lockExpirationDate, lockStatusName } = lockFieldsFromRow(o);
  const loanDatesJson =
    o.loanDates && typeof o.loanDates === "object"
      ? (o.loanDates as Record<string, unknown>)
      : null;

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
    loanType,
    loanPurpose,
    creditScoreMid,
    propertyValueCents,
    ltvBps,
    fundedAt,
    creditReportRequestedAt,
    estimatedClosingDate,
    lockDate,
    lockExpirationDate,
    lockStatusName,
    loanDatesJson,
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

/**
 * Underwriting detail extracted from the LendingPad loan-detail endpoint.
 * LendingPad field shapes vary by account + integration tier, so every
 * mapping uses the defensive `strField` helper with multiple fallbacks.
 */
export type NormalizedLpLoanDetail = {
  id: string;
  noteRateBps: number | null;
  originalRateBps: number | null;
  propertyValueCents: number | null;
  currentLoanBalanceCents: number | null;
  ltvBps: number | null;
  cltvBps: number | null;
  creditScoreMid: number | null;
  dtiBps: number | null;
  isVeteran: boolean | null;
  armFirstResetDate: string | null;
  armIndex: string | null;
  armMarginBps: number | null;
  loanType: string | null;
  loanPurpose: string | null;
  fundedAt: string | null;
  firstPaymentDate: string | null;
  noteDate: string | null;
};

function pickNumber(o: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = o[k];
    if (v == null || v === "") continue;
    const n = Number(String(v).replace(/[%,\s$]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function pickRateBps(o: Record<string, unknown>, keys: string[]): number | null {
  const n = pickNumber(o, keys);
  if (n == null) return null;
  return n < 20 ? Math.round(n * 100) : Math.round(n);
}

function pickPctBps(o: Record<string, unknown>, keys: string[]): number | null {
  const n = pickNumber(o, keys);
  if (n == null) return null;
  return n < 2 ? Math.round(n * 10000) : Math.round(n * 100);
}

function pickCents(o: Record<string, unknown>, keys: string[]): number | null {
  const n = pickNumber(o, keys);
  if (n == null) return null;
  return Math.round(n * 100);
}

function pickDate(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (v == null || v === "") continue;
    const d = new Date(String(v));
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
}

function pickTimestamp(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (v == null || v === "") continue;
    const t = Date.parse(String(v));
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return null;
}

function pickBool(o: Record<string, unknown>, keys: string[]): boolean | null {
  for (const k of keys) {
    const v = o[k];
    if (v == null) continue;
    if (typeof v === "boolean") return v;
    const s = String(v).trim().toLowerCase();
    if (["true", "yes", "y", "1"].includes(s)) return true;
    if (["false", "no", "n", "0"].includes(s)) return false;
  }
  return null;
}

export function normalizeLendingPadLoanDetailRow(
  raw: unknown,
): NormalizedLpLoanDetail | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = strField(o, "id", "loanId", "loanID", "guid");
  if (!id) return null;

  // Rates
  const noteRateBps = pickRateBps(o, [
    "noteRate",
    "note_rate",
    "interestRate",
    "interest_rate",
    "currentNoteRate",
    "rate",
  ]);
  const originalRateBps = pickRateBps(o, ["originalRate", "original_rate", "initialRate"]);

  // Value / balance / LTV
  const propertyValueCents = pickCents(o, ["propertyValue", "appraisedValue", "estimatedValue"]);
  const currentLoanBalanceCents = pickCents(o, [
    "currentLoanBalance",
    "loanBalance",
    "outstandingBalance",
    "upb",
  ]);
  const ltvBps = pickPctBps(o, ["ltv", "loanToValue", "LTV"]);
  const cltvBps = pickPctBps(o, ["cltv", "combinedLoanToValue", "CLTV"]);

  // Credit + DTI
  const creditScoreMid = pickNumber(o, ["creditScore", "ficoScore", "midFico", "representativeFico"]);
  const dtiBps = pickPctBps(o, ["dti", "debtToIncome", "totalDti"]);

  // Veteran
  const isVeteran = pickBool(o, ["isVeteran", "veteran", "vaEligible"]);

  // ARM
  const armFirstResetDate = pickDate(o, [
    "armFirstResetDate",
    "firstRateAdjustmentDate",
    "firstResetDate",
  ]);
  const armIndex = strField(o, "armIndex", "index") || null;
  const armMarginBps = pickRateBps(o, ["armMargin", "margin"]);

  // Loan meta
  const loanType =
    strField(o, "loanType", "loan_type", "productName", "product") || null;
  const loanPurpose =
    strField(o, "loanPurpose", "loan_purpose", "purpose") || null;
  const fundedAt = pickTimestamp(o, ["fundedDate", "fundDate", "fundedAt", "disbursementDate"]);
  const firstPaymentDate = pickDate(o, [
    "firstPaymentDate",
    "first_payment_date",
    "scheduledFirstPaymentDate",
    "firstPaymentDueDate",
    "paymentDueDate",
  ]);
  const noteDate = pickDate(o, ["noteDate", "note_date", "noteSignedDate", "signingDate"]);

  return {
    id,
    noteRateBps,
    originalRateBps,
    propertyValueCents,
    currentLoanBalanceCents,
    ltvBps,
    cltvBps,
    creditScoreMid: creditScoreMid != null ? Math.round(creditScoreMid) : null,
    dtiBps,
    isVeteran,
    armFirstResetDate,
    armIndex,
    armMarginBps,
    loanType,
    loanPurpose,
    fundedAt,
    firstPaymentDate,
    noteDate,
  };
}

export function parseLendingPadLoanDetailResponse(json: unknown): NormalizedLpLoanDetail | null {
  if (Array.isArray(json)) {
    return json.length > 0 ? normalizeLendingPadLoanDetailRow(json[0]) : null;
  }
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    if ("loan" in o) return normalizeLendingPadLoanDetailRow(o.loan);
    if ("data" in o) return normalizeLendingPadLoanDetailRow(o.data);
    return normalizeLendingPadLoanDetailRow(o);
  }
  return null;
}

export function normalizeLendingPadLoanUuid(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRe.test(s) ? s : null;
}
