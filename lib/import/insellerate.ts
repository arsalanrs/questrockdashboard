import { createHash } from "node:crypto";

import * as XLSX from "xlsx";

/**
 * Must match the `public.loan_pipeline_stage` Postgres enum exactly.
 * See supabase/migrations/20260302190000_init.sql + 20260311000000_dashboard_full_build.sql.
 * Keep this union in sync if the enum ever grows.
 */
type LoanStage =
  | "lead"
  | "registered"
  | "application"
  | "verification"
  | "esign_out"
  | "processing"
  | "submission"
  | "underwriting"
  | "conditions"
  | "approval_conditions"
  | "clear_to_close"
  | "closing"
  | "funded";

export type InsellerateRawRow = Record<string, string>;

export type NormalizedInsellerateRow = {
  externalRefId: string;
  rawStatus: string | null;
  stage: LoanStage | null;
  isActive: boolean;

  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;

  campaign: string | null;
  loanOfficerName: string | null;
  loanOfficerNmlsid: string | null;

  propertyState: string | null;
  mailingState: string | null;

  loanAmountCents: number | null;
  loanType: string | null;
  loanPurpose: string | null;

  noteRateBps: number | null;
  originalRateBps: number | null;
  propertyValueCents: number | null;
  currentLoanBalanceCents: number | null;
  ltvBps: number | null;
  creditScoreMid: number | null;
  dtiBps: number | null;
  isVeteran: boolean | null;
  selfEmployed: boolean | null;
  doNotContact: boolean;

  createdAtSource: string | null;
  lastActivityAtSource: string | null;
  fundedAtSource: string | null;

  notes: string | null;
  row: Record<string, string>;
};

/**
 * Insellerate StatusName → public.loan_pipeline_stage enum value.
 * Anything not here is "not active" and stays only in historical_leads.
 *
 * Mapping choices (mirror Shape CRM's stage_mapping seeds):
 *   - "Piped"    → submission        (in-pipeline, past app, before UW)
 *   - "Approved" → approval_conditions (per 20260311000200_seed_questrock_config.sql)
 *   - "Clear to Close" → clear_to_close
 *   - "Funded"/"Closed" → funded
 */
const STATUS_TO_STAGE: Record<string, LoanStage> = {
  Application: "application",
  Piped: "submission",
  Processing: "processing",
  Underwriting: "underwriting",
  Approved: "approval_conditions",
  "Clear to Close": "clear_to_close",
  "Clear To Close": "clear_to_close",
  Funded: "funded",
  Closed: "funded",
};

const DO_NOT_CONTACT_STATUS = "Do Not Contact";

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function nullable(v: unknown): string | null {
  const s = str(v);
  return s.length ? s : null;
}

function parseMoneyCents(v: unknown): number | null {
  const s = str(v).replace(/[$,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function parseRateBps(v: unknown): number | null {
  const s = str(v).replace(/[%,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n < 20 ? Math.round(n * 100) : Math.round(n);
}

function parsePctBps(v: unknown): number | null {
  const s = str(v).replace(/[%,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n < 2 ? Math.round(n * 10000) : Math.round(n * 100);
}

function parseInt0(v: unknown): number | null {
  const s = str(v).replace(/[,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function parseBool(v: unknown): boolean | null {
  const s = str(v).toLowerCase();
  if (!s) return null;
  if (["true", "yes", "y", "1"].includes(s)) return true;
  if (["false", "no", "n", "0"].includes(s)) return false;
  return null;
}

/** Insellerate dates arrive as "5/27/22 12:41" or "5/27/2022". Returns ISO or null. */
function parseMaybeTimestamp(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  // fallback for 2-digit year "5/27/22 12:41"
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (!m) return null;
  const [, mm, dd, yyRaw, hh, mi] = m;
  const yy = yyRaw.length === 2 ? 2000 + Number(yyRaw) : Number(yyRaw);
  const dt = new Date(Date.UTC(yy, Number(mm) - 1, Number(dd), Number(hh ?? 0), Number(mi ?? 0)));
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

/**
 * Stable dedupe key. Insellerate export has no natural ID, so hash the fields
 * least likely to change across re-exports: email, AppCreateDate, last name,
 * property state. Prefix with "ins:" so the key is unambiguous.
 */
function buildExternalRefId(row: InsellerateRawRow): string {
  const parts = [
    str(row["Email"]).toLowerCase(),
    str(row["AppCreateDate"]),
    str(row["LastName"]).toLowerCase(),
    str(row["PropertyState"]).toUpperCase(),
    str(row["FirstName"]).toLowerCase(),
  ];
  const h = createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
  return `ins:${h}`;
}

export function normalizeInsellerateRow(row: InsellerateRawRow): NormalizedInsellerateRow {
  const rawStatus = nullable(row["StatusName"]);
  const stage = rawStatus ? STATUS_TO_STAGE[rawStatus] ?? null : null;
  const isActive = stage != null && stage !== "funded";
  const doNotContact = rawStatus === DO_NOT_CONTACT_STATUS;

  const loanAmountCents =
    parseMoneyCents(row["ProposedInitialLoanAmount"]) ?? parseMoneyCents(row["PurchaseAmount"]);

  const loanType =
    nullable(row["ProposedLoanTypeName-First"]) ?? nullable(row["LoanTypeName-First"]);
  const loanPurpose =
    nullable(row["ProposedLoanPurposeTypeName-First"]) ?? nullable(row["LoanPurposeTypeName-First"]);

  // Insellerate "PrimaryAgentFirstName" holds the full agent name (e.g. "Bill Medley").
  const loanOfficerName = nullable(row["PrimaryAgentFirstName"]);

  return {
    externalRefId: buildExternalRefId(row),
    rawStatus,
    stage,
    isActive,
    firstName: nullable(row["FirstName"]),
    lastName: nullable(row["LastName"]),
    email: nullable(row["Email"]),
    phone: nullable(row["MobilePhone"]) ?? nullable(row["HomePhone"]) ?? nullable(row["WorkPhone"]),
    campaign: nullable(row["Campaign"]),
    loanOfficerName,
    loanOfficerNmlsid: nullable(row["PrimaryAgentNmlsid"]),
    propertyState: nullable(row["PropertyState"]),
    mailingState: nullable(row["MailingState"]),
    loanAmountCents,
    loanType,
    loanPurpose,
    noteRateBps: parseRateBps(row["ProposedLoanRate"]),
    originalRateBps: null,
    propertyValueCents: parseMoneyCents(row["EstimatedValue"]),
    currentLoanBalanceCents: parseMoneyCents(row["CurrentLoanBalance-First"]),
    ltvBps: parsePctBps(row["CurrentLTV"]),
    creditScoreMid: parseInt0(row["CreditScore"]),
    dtiBps: parsePctBps(row["DTI"]),
    isVeteran: parseBool(row["Veteran"]),
    selfEmployed: parseBool(row["SelfEmployed"]),
    doNotContact,
    createdAtSource: parseMaybeTimestamp(row["AppCreateDate"]) ?? parseMaybeTimestamp(row["PostDate"]),
    lastActivityAtSource:
      parseMaybeTimestamp(row["CurrentActivityDate"]) ?? parseMaybeTimestamp(row["CurrentStatusDate"]),
    fundedAtSource: rawStatus === "Funded" ? parseMaybeTimestamp(row["CurrentStatusDate"]) : null,
    notes: nullable(row["Notes"]),
    row,
  };
}

/** Reads all rows from an .xlsx buffer and normalizes them. */
export function parseInsellerateXlsx(buffer: Buffer | ArrayBuffer): NormalizedInsellerateRow[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("Workbook has no sheets.");
  const ws = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json<InsellerateRawRow>(ws, { defval: "", raw: false });
  return raw.map(normalizeInsellerateRow);
}
