import { differenceInCalendarDays, startOfDay } from "date-fns";
import { notFound } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireCurrentUser } from "@/lib/current-user";
import { canAccessAdmin } from "@/lib/permissions";
import { cn } from "@/lib/cn";
import { LoSelector } from "./LoSelector";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SHAPE_LEAD_BASE_URL = process.env.NEXT_PUBLIC_SHAPE_LEAD_BASE_URL?.trim() || null;

const PIPED_STAGES = new Set([
  "verification",
  "esign_out",
  "processing",
  "underwriting",
  "approval_conditions",
  "clear_to_close",
  "closing",
]);

const STAGE_LABELS: Record<string, string> = {
  verification: "Verification",
  esign_out: "eSign Out",
  processing: "Processing",
  underwriting: "Underwriting",
  approval_conditions: "Approval",
  clear_to_close: "CTC",
  closing: "Closing",
  registered: "Registered",
  submission: "Submission",
  conditions: "Conditions",
  funded: "Funded",
  lead: "Lead",
  application: "Application",
};

type LoanRow = {
  id: string;
  shape_record_id: number | null;
  record_type: string | null;
  status_raw: string | null;
  borrower_first_name: string | null;
  borrower_last_name: string | null;
  current_stage: string | null;
  closing_date: string | null;
  loan_amount_cents: number | null;
  lead_created_at: string | null;
  loan_type: string | null;
  loan_purpose: string | null;
  appraisal_ordered_at: string | null;
  assigned_loan_officer_user_id: string | null;
  assigned_loan_officer_name: string | null;
  loan_stage_events: Array<{ stage: string; entered_at: string }> | null;
};

type UserRow = {
  id: string;
  full_name: string | null;
  role: string;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function stageLabel(s: string | null) {
  if (!s) return "No stage";
  return STAGE_LABELS[s] ?? s;
}

function daysInStage(events: LoanRow["loan_stage_events"], stage: string | null) {
  if (!stage) return null;
  const latest = (events ?? [])
    .filter((e) => e.stage === stage)
    .map((e) => new Date(e.entered_at))
    .filter((d) => !isNaN(d.getTime()))
    .sort((a, b) => b.getTime() - a.getTime())[0];
  if (!latest) return null;
  return differenceInCalendarDays(new Date(), latest);
}

function borrowerName(l: LoanRow) {
  const name = [l.borrower_first_name, l.borrower_last_name].filter(Boolean).join(" ");
  return name || "—";
}

function fmt$(cents: number | null) {
  if (!cents) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    cents / 100,
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default async function AdminViewPage({ searchParams }: { searchParams: Promise<{ lo?: string }> }) {
  const { appUser } = await requireCurrentUser();
  if (!canAccessAdmin(appUser.role)) notFound();

  const { lo: selectedLo = "unassigned" } = await searchParams;

  const admin = createSupabaseAdminClient();

  /* --- load all loan officers --- */
  const { data: allUsers } = await admin
    .from("users")
    .select("id,full_name,role")
    .in("role", ["loan_officer", "manager", "executive"])
    .order("full_name");

  const loUsers: UserRow[] = allUsers ?? [];

  /* --- load all loans with admin client (bypasses RLS) --- */
  const { data: allLoans } = await admin
    .from("loans")
    .select(
      "id,shape_record_id,record_type,status_raw,borrower_first_name,borrower_last_name,current_stage,closing_date,loan_amount_cents,lead_created_at,loan_type,loan_purpose,appraisal_ordered_at,assigned_loan_officer_user_id,assigned_loan_officer_name,loan_stage_events(stage,entered_at)",
    )
    .limit(2000);

  const loans: LoanRow[] = (allLoans ?? []) as LoanRow[];

  /* --- compute per-LO counts for the selector --- */
  function loStats(userId: string) {
    const mine = loans.filter((l) => l.assigned_loan_officer_user_id === userId);
    const pipeline = mine.filter(
      (l) => l.current_stage && PIPED_STAGES.has(l.current_stage),
    ).length;
    const prePipeline = mine.filter(
      (l) =>
        l.current_stage !== "funded" &&
        !(l.current_stage && PIPED_STAGES.has(l.current_stage)),
    ).length;
    return { total: mine.length, pipeline, prePipeline };
  }

  const unassigned = loans.filter((l) => !l.assigned_loan_officer_user_id);

  const selectorItems = [
    {
      id: "unassigned" as const,
      full_name: "Unassigned Leads" as const,
      total: unassigned.length,
      pipeline: 0,
      prePipeline: unassigned.length,
    },
    ...loUsers.map((u) => ({ id: u.id, full_name: u.full_name, ...loStats(u.id) })),
  ];

  /* --- pick the loans to show --- */
  const viewLoans =
    selectedLo === "unassigned"
      ? unassigned
      : loans.filter((l) => l.assigned_loan_officer_user_id === selectedLo);

  const selectedUser = loUsers.find((u) => u.id === selectedLo);

  const commandCenterLoans = viewLoans.filter(
    (l) => l.current_stage && PIPED_STAGES.has(l.current_stage),
  );

  const prePipelineLoans = viewLoans.filter(
    (l) =>
      l.current_stage !== "funded" &&
      !(l.current_stage && PIPED_STAGES.has(l.current_stage)),
  );

  const today = startOfDay(new Date());

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div className="space-y-6">
      {/* ---- header ---- */}
      <div>
        <h1 className="text-xl font-semibold">Team View</h1>
        <p className="text-sm text-mutedForeground">
          Select a loan officer to view their full dashboard. Unassigned leads need to be assigned in Shape.
        </p>
      </div>

      {/* ---- LO selector ---- */}
      <LoSelector items={selectorItems} currentLo={selectedLo} />

      {/* ---- view label ---- */}
      <div className="flex items-center gap-3">
        <h2 className="text-base font-semibold">
          {selectedLo === "unassigned"
            ? `Unassigned Leads (${unassigned.length})`
            : `${selectedUser?.full_name ?? "Unknown"} — ${viewLoans.length} loan${viewLoans.length !== 1 ? "s" : ""}`}
        </h2>
        {selectedLo === "unassigned" && unassigned.length > 0 && (
          <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
            Assign these in Shape so LOs can see them
          </span>
        )}
      </div>

      {/* ================================================================ */}
      {/*  Unassigned view                                                 */}
      {/* ================================================================ */}
      {selectedLo === "unassigned" ? (
        <UnassignedTable loans={unassigned} />
      ) : (
        <>
          {/* ================================================================ */}
          {/*  Command Center (pipeline loans)                                 */}
          {/* ================================================================ */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Command Center</h3>
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-mutedForeground">
                {commandCenterLoans.length}
              </span>
              <span className="text-xs text-mutedForeground">— appraisal ordered + in pipeline stage</span>
            </div>

            {commandCenterLoans.length === 0 ? (
              <div className="rounded-lg border border-border bg-card px-4 py-8 text-center text-sm text-mutedForeground">
                No loans in Command Center
                {viewLoans.length > 0 ? " — loans exist but none have appraisal ordered + a pipeline stage" : ""}
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr className="text-left text-xs text-mutedForeground">
                      <th className="px-3 py-2">Borrower</th>
                      <th className="px-3 py-2">Stage</th>
                      <th className="px-3 py-2">Days in Stage</th>
                      <th className="px-3 py-2">Loan Type</th>
                      <th className="px-3 py-2">Amount</th>
                      <th className="px-3 py-2">Closing</th>
                      {SHAPE_LEAD_BASE_URL ? <th className="px-3 py-2">Shape</th> : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {commandCenterLoans.map((l) => {
                      const days = daysInStage(l.loan_stage_events, l.current_stage);
                      const closingDate = l.closing_date ? new Date(l.closing_date) : null;
                      const daysToClose = closingDate ? differenceInCalendarDays(closingDate, today) : null;
                      return (
                        <tr key={l.id} className="hover:bg-muted/40">
                          <td className="px-3 py-2 font-medium">{borrowerName(l)}</td>
                          <td className="px-3 py-2">
                            <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{stageLabel(l.current_stage)}</span>
                          </td>
                          <td className="px-3 py-2 tabular-nums">{days != null ? `${days}d` : "—"}</td>
                          <td className="px-3 py-2 text-mutedForeground">{l.loan_type ?? "—"}</td>
                          <td className="px-3 py-2 tabular-nums">{fmt$(l.loan_amount_cents)}</td>
                          <td className="px-3 py-2 tabular-nums">
                            {daysToClose != null ? (
                              <span
                                className={cn(
                                  daysToClose < 0 ? "text-red-600 dark:text-red-400" : daysToClose <= 3 ? "text-amber-600 dark:text-amber-400" : "",
                                )}
                              >
                                {daysToClose < 0 ? `${Math.abs(daysToClose)}d ago` : daysToClose === 0 ? "Today" : `${daysToClose}d`}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          {SHAPE_LEAD_BASE_URL ? (
                            <td className="px-3 py-2">
                              {l.shape_record_id ? (
                                <a
                                  href={`${SHAPE_LEAD_BASE_URL}${l.shape_record_id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                                >
                                  #{l.shape_record_id}
                                </a>
                              ) : (
                                "—"
                              )}
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ================================================================ */}
          {/*  Pre-Pipeline                                                    */}
          {/* ================================================================ */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Pre-Pipeline</h3>
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-mutedForeground">
                {prePipelineLoans.length}
              </span>
              <span className="text-xs text-mutedForeground">— all other active loans</span>
            </div>

            {prePipelineLoans.length === 0 ? (
              <div className="rounded-lg border border-border bg-card px-4 py-8 text-center text-sm text-mutedForeground">
                No pre-pipeline loans
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr className="text-left text-xs text-mutedForeground">
                      <th className="px-3 py-2">Borrower</th>
                      <th className="px-3 py-2">Stage</th>
                      <th className="px-3 py-2">Shape Status</th>
                      <th className="px-3 py-2">Record Type</th>
                      <th className="px-3 py-2">Loan Type</th>
                      <th className="px-3 py-2">Amount</th>
                      <th className="px-3 py-2">Lead Date</th>
                      {SHAPE_LEAD_BASE_URL ? <th className="px-3 py-2">Shape</th> : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {prePipelineLoans.map((l) => {
                      const leadDate = l.lead_created_at
                        ? differenceInCalendarDays(new Date(), new Date(l.lead_created_at))
                        : null;
                      return (
                        <tr key={l.id} className="hover:bg-muted/40">
                          <td className="px-3 py-2 font-medium">{borrowerName(l)}</td>
                          <td className="px-3 py-2">
                            <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{stageLabel(l.current_stage)}</span>
                          </td>
                          <td className="px-3 py-2 text-xs text-mutedForeground">{l.status_raw ?? "—"}</td>
                          <td className="px-3 py-2 text-xs text-mutedForeground">{l.record_type ?? "—"}</td>
                          <td className="px-3 py-2 text-mutedForeground">{l.loan_type ?? "—"}</td>
                          <td className="px-3 py-2 tabular-nums">{fmt$(l.loan_amount_cents)}</td>
                          <td className="px-3 py-2 tabular-nums text-mutedForeground">
                            {leadDate != null ? `${leadDate}d ago` : "—"}
                          </td>
                          {SHAPE_LEAD_BASE_URL ? (
                            <td className="px-3 py-2">
                              {l.shape_record_id ? (
                                <a
                                  href={`${SHAPE_LEAD_BASE_URL}${l.shape_record_id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                                >
                                  #{l.shape_record_id}
                                </a>
                              ) : (
                                "—"
                              )}
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Unassigned table component                                         */
/* ------------------------------------------------------------------ */

function UnassignedTable({ loans }: { loans: LoanRow[] }) {
  if (loans.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-4 py-12 text-center text-sm text-mutedForeground">
        All loans are assigned to a loan officer.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-amber-500/30 bg-amber-50/50 p-3 text-sm dark:bg-amber-950/20">
        <p className="font-medium text-amber-800 dark:text-amber-300">
          {loans.length} lead{loans.length !== 1 ? "s" : ""} not assigned to any loan officer
        </p>
        <p className="mt-1 text-amber-700 dark:text-amber-400">
          Open each lead in Shape and assign a Loan Officer so they appear in the correct LO&apos;s dashboard.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr className="text-left text-xs text-mutedForeground">
              <th className="px-3 py-2">Borrower</th>
              <th className="px-3 py-2">Stage</th>
              <th className="px-3 py-2">Shape Status</th>
              <th className="px-3 py-2">Record Type</th>
              <th className="px-3 py-2">Loan Type</th>
              <th className="px-3 py-2">Amount</th>
              <th className="px-3 py-2">Lead Date</th>
              {SHAPE_LEAD_BASE_URL ? <th className="px-3 py-2">Shape</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loans.map((l) => {
              const today = startOfDay(new Date());
              const leadDate = l.lead_created_at
                ? differenceInCalendarDays(new Date(), new Date(l.lead_created_at))
                : null;
              return (
                <tr key={l.id} className="hover:bg-muted/40">
                  <td className="px-3 py-2 font-medium">
                    {[l.borrower_first_name, l.borrower_last_name].filter(Boolean).join(" ") || "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{stageLabel(l.current_stage)}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-mutedForeground">{l.status_raw ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-mutedForeground">{l.record_type ?? "—"}</td>
                  <td className="px-3 py-2 text-mutedForeground">{l.loan_type ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {l.loan_amount_cents
                      ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(l.loan_amount_cents / 100)
                      : "—"}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-mutedForeground">
                    {leadDate != null ? `${leadDate}d ago` : "—"}
                  </td>
                  {SHAPE_LEAD_BASE_URL ? (
                    <td className="px-3 py-2">
                      {l.shape_record_id ? (
                        <a
                          href={`${SHAPE_LEAD_BASE_URL}${l.shape_record_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                        >
                          #{l.shape_record_id}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
