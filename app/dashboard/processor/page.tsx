import { differenceInHours } from "date-fns";
import { notFound } from "next/navigation";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { Badge } from "@/components/Badge";
import { cn } from "@/lib/cn";
import { requireCurrentUser } from "@/lib/current-user";
import { canViewProcessorDashboard } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const RELEVANT_STAGES = [
  "verification",
  "esign_out",
  "processing",
  "submission",
  "underwriting",
  "conditions",
  "approval_conditions",
  "clear_to_close",
] as const;

type Queue =
  | "eSign"
  | "Processing"
  | "Underwriting"
  | "Conditions"
  | "Pre-CTC"
  | "Restructure Hold";

const STAGE_LABEL: Record<string, string> = {
  verification: "Verification",
  esign_out: "eSign Out",
  processing: "Processing",
  submission: "Submission",
  underwriting: "Underwriting",
  conditions: "Conditions",
  approval_conditions: "Approval Conditions",
  clear_to_close: "Clear to Close",
};

type SummaryCard = {
  label: string;
  stages: string[];
  useRestructure?: boolean;
};

const SUMMARY_CARDS: SummaryCard[] = [
  { label: "New from eSign", stages: ["esign_out"] },
  { label: "In Processing", stages: ["processing", "submission"] },
  { label: "In Underwriting", stages: ["underwriting"] },
  { label: "Conditions Review", stages: ["conditions", "approval_conditions"] },
  { label: "Pre-CTC", stages: ["clear_to_close"] },
  { label: "Restructure Hold", stages: [], useRestructure: true },
];

type LoanRow = {
  id: string;
  shape_record_id: number | null;
  borrower_first_name: string | null;
  borrower_last_name: string | null;
  current_stage: string | null;
  loan_type: string | null;
  is_restructure_hold: boolean;
  current_owner_role: string | null;
  assigned_loan_officer_name: string | null;
  esign_returned_at: string | null;
  loan_stage_events: Array<{ entered_at: string }> | null;
  conditions: Array<{ status: string }> | null;
};

type SlaRow = { stage: string; max_hours: number | null };

type SlaStatus = "On Track" | "At Risk" | "Exceeded";

function hoursInStage(events: Array<{ entered_at: string }> | null | undefined): number | null {
  const latest = (events ?? [])
    .map((e) => new Date(e.entered_at))
    .filter((d) => !Number.isNaN(d.getTime()))
    .sort((a, b) => b.getTime() - a.getTime())[0];
  if (!latest) return null;
  return differenceInHours(new Date(), latest);
}

function computeSlaStatus(hours: number | null, maxHours: number | null): SlaStatus {
  if (hours === null || maxHours === null || maxHours <= 0) return "On Track";
  if (hours >= maxHours) return "Exceeded";
  if (hours >= maxHours * 0.8) return "At Risk";
  return "On Track";
}

function resolveQueue(loan: LoanRow): Queue {
  if (loan.is_restructure_hold) return "Restructure Hold";
  switch (loan.current_stage) {
    case "esign_out":
      return "eSign";
    case "processing":
    case "submission":
      return "Processing";
    case "underwriting":
      return "Underwriting";
    case "conditions":
    case "approval_conditions":
      return "Conditions";
    case "clear_to_close":
      return "Pre-CTC";
    default:
      return "Processing";
  }
}

const SLA_BADGE_VARIANT: Record<SlaStatus, "green" | "yellow" | "red"> = {
  "On Track": "green",
  "At Risk": "yellow",
  Exceeded: "red",
};

const SLA_SORT_WEIGHT: Record<SlaStatus, number> = {
  Exceeded: 0,
  "At Risk": 1,
  "On Track": 2,
};

export default async function ProcessorDashboardPage() {
  const { appUser } = await requireCurrentUser();
  if (!canViewProcessorDashboard(appUser.role)) notFound();

  const supabase = await createSupabaseServerClient();

  const [loansResult, slaResult] = await Promise.all([
    supabase
      .from("loans")
      .select(
        "id,shape_record_id,borrower_first_name,borrower_last_name,current_stage,loan_type,is_restructure_hold,current_owner_role,assigned_loan_officer_name,esign_returned_at,loan_stage_events(entered_at),conditions(status)",
      )
      .in("current_stage", [...RELEVANT_STAGES])
      .limit(500),
    supabase.from("sla_thresholds").select("stage,max_hours"),
  ]);

  if (loansResult.error) {
    return (
      <div className="rounded-lg border border-amber-500/50 bg-amber-50 p-4 text-sm dark:bg-amber-950/30">
        <p className="font-medium">Unable to load queue</p>
        <p className="mt-1 font-mono text-xs">{loansResult.error.message}</p>
      </div>
    );
  }

  const slaMap = new Map<string, number>();
  ((slaResult.data ?? []) as SlaRow[]).forEach((r) => {
    if (r.max_hours !== null) slaMap.set(r.stage, r.max_hours);
  });

  const loans = (loansResult.data ?? []) as unknown as LoanRow[];

  const enriched = loans.map((l) => {
    const hours = hoursInStage(l.loan_stage_events);
    const maxHours = l.current_stage ? slaMap.get(l.current_stage) ?? null : null;
    const slaStatus = computeSlaStatus(hours, maxHours);
    const queue = resolveQueue(l);
    const openConditions = (l.conditions ?? []).filter((c) => c.status === "open").length;
    return { ...l, hours, slaStatus, queue, openConditions };
  });

  enriched.sort((a, b) => {
    const rA = a.is_restructure_hold ? 0 : 1;
    const rB = b.is_restructure_hold ? 0 : 1;
    if (rA !== rB) return rA - rB;

    const sA = SLA_SORT_WEIGHT[a.slaStatus];
    const sB = SLA_SORT_WEIGHT[b.slaStatus];
    if (sA !== sB) return sA - sB;

    return (b.hours ?? 0) - (a.hours ?? 0);
  });

  const display = enriched.slice(0, 100);

  function cardCount(card: SummaryCard): number {
    if (card.useRestructure) return enriched.filter((l) => l.is_restructure_hold).length;
    return enriched.filter((l) => !l.is_restructure_hold && card.stages.includes(l.current_stage ?? "")).length;
  }

  function cardHasExceeded(card: SummaryCard): boolean {
    const subset = card.useRestructure
      ? enriched.filter((l) => l.is_restructure_hold)
      : enriched.filter((l) => !l.is_restructure_hold && card.stages.includes(l.current_stage ?? ""));
    return subset.some((l) => l.slaStatus === "Exceeded");
  }

  return (
    <div className="qr-dashboard-page animate-fade-up">
      <DashboardPageHeader
        eyebrow="Operations"
        title="Processor Queue"
        description={`${appUser.full_name} · Questrock File Flow`}
      />

      <section className="space-y-2">
        <div className="lo-accent-text text-[11px] font-semibold uppercase tracking-[0.14em]">Pipeline Overview</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {SUMMARY_CARDS.map((card) => {
            const count = cardCount(card);
            const exceeded = cardHasExceeded(card);
            return (
              <div key={card.label} className="lo-mini-stat">
                <span
                  className={cn(
                    "inline-block h-2.5 w-2.5 shrink-0 rounded-full",
                    exceeded ? "bg-red-500" : "bg-emerald-500",
                  )}
                />
                <div className="min-w-0">
                  <div className="lo-mini-stat-label truncate">{card.label}</div>
                  <div className="lo-mini-stat-value">{count}</div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        <div className="lo-accent-text text-[11px] font-semibold uppercase tracking-[0.14em]">Work Queue</div>
        <div className="lo-card lo-table-wrap">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="lo-th">Queue</th>
                <th className="lo-th">Loan #</th>
                <th className="lo-th">Borrower</th>
                <th className="lo-th">Loan Type</th>
                <th className="lo-th">Stage</th>
                <th className="lo-th">Hours in Stage</th>
                <th className="lo-th">Open Conditions</th>
                <th className="lo-th">Assigned LO</th>
                <th className="lo-th">SLA Status</th>
              </tr>
            </thead>
            <tbody>
              {display.map((l) => (
                <tr
                  key={l.id}
                  className={cn(
                    "lo-data-row",
                    l.is_restructure_hold && "bg-amber-50/80 dark:bg-amber-950/20",
                  )}
                >
                  <td className="lo-td font-medium">{l.queue}</td>
                  <td className="lo-td font-mono text-xs">{l.shape_record_id ?? "—"}</td>
                  <td className="lo-td">
                    {l.borrower_first_name ?? ""} {l.borrower_last_name ?? ""}
                  </td>
                  <td className="lo-td">{l.loan_type ?? "—"}</td>
                  <td className="lo-td">{STAGE_LABEL[l.current_stage ?? ""] ?? l.current_stage ?? "—"}</td>
                  <td className="lo-td tabular-nums">{l.hours !== null ? l.hours : "—"}</td>
                  <td className="lo-td tabular-nums">{l.openConditions}</td>
                  <td className="lo-td">{l.assigned_loan_officer_name ?? "—"}</td>
                  <td className="lo-td">
                    <Badge variant={SLA_BADGE_VARIANT[l.slaStatus]}>{l.slaStatus}</Badge>
                  </td>
                </tr>
              ))}
              {display.length === 0 && (
                <tr>
                  <td className="lo-muted lo-td px-3 py-6 text-center text-sm" colSpan={9}>
                    No files in processing queue.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="lo-card p-5">
        <h2 className="lo-heading text-sm font-semibold">Game Plan</h2>
        <p className="lo-muted mt-2 text-sm">
          Select a loan above to view its game plan and checklist.
        </p>
      </section>
    </div>
  );
}
