import { differenceInHours } from "date-fns";
import { notFound } from "next/navigation";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { ProcessorQueue } from "@/components/dashboard/processor/ProcessorQueue";
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

type LoanRow = {
  id: string;
  shape_record_id: number | null;
  borrower_first_name: string | null;
  borrower_last_name: string | null;
  current_stage: string | null;
  loan_type: string | null;
  is_restructure_hold: boolean;
  assigned_loan_officer_name: string | null;
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
    case "esign_out": return "eSign";
    case "processing":
    case "submission": return "Processing";
    case "underwriting": return "Underwriting";
    case "conditions":
    case "approval_conditions": return "Conditions";
    case "clear_to_close": return "Pre-CTC";
    default: return "Processing";
  }
}

const SUMMARY_CARDS = [
  { id: "esign", label: "New from eSign", stages: ["esign_out"] },
  { id: "processing", label: "In Processing", stages: ["processing", "submission"] },
  { id: "uw", label: "In Underwriting", stages: ["underwriting"] },
  { id: "conditions", label: "Conditions Review", stages: ["conditions", "approval_conditions"] },
  { id: "prectc", label: "Pre-CTC", stages: ["clear_to_close"] },
  { id: "restructure", label: "Restructure Hold", stages: [], useRestructure: true },
];

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
        "id,shape_record_id,borrower_first_name,borrower_last_name,current_stage,loan_type,is_restructure_hold,assigned_loan_officer_name,loan_stage_events(entered_at),conditions(status)",
      )
      .in("current_stage", [...RELEVANT_STAGES])
      .limit(500),
    supabase.from("sla_thresholds").select("stage,max_hours"),
  ]);

  if (loansResult.error) {
    return (
      <div className="lo-card border-amber-500/50 bg-amber-50 p-4 text-sm dark:bg-amber-950/30">
        <p className="lo-heading font-medium">Unable to load queue</p>
        <p className="lo-muted mt-1 font-mono text-xs">{loansResult.error.message}</p>
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

  return (
    <div className="qr-dashboard-page animate-fade-up">
      <DashboardPageHeader
        eyebrow="Operations"
        title="Processor Queue"
        description={`${appUser.full_name} · Questrock File Flow`}
      />
      <ProcessorQueue loans={enriched.slice(0, 100)} summaryCards={SUMMARY_CARDS} />
    </div>
  );
}
