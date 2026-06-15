import {
  differenceInCalendarDays,
  startOfDay,
  differenceInHours,
} from "date-fns";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireCurrentUser } from "@/lib/current-user";
import { canAccessAdmin } from "@/lib/permissions";
import { shapeLeadUrl } from "@/lib/shape-link";
import { SLA_BREACH_LABELS } from "@/lib/sla/compute";
import { StatCard } from "@/components/StatCard";
import { KpiCard } from "@/components/KpiCard";
import { Badge } from "@/components/Badge";
import { PrePipelineDashboard } from "@/components/dashboard/PrePipelineDashboard";
import { PitchQueue } from "@/components/dashboard/PitchQueue";
import { MacroTracker } from "@/components/dashboard/MacroTracker";
import { MicroPipeline, type MicroLoan } from "@/components/dashboard/MicroPipeline";
import { AppraisalTracker } from "@/components/dashboard/AppraisalTracker";
import { Leaderboard } from "@/components/dashboard/Leaderboard";
import { ViewAsSelector } from "@/components/dashboard/ViewAsSelector";
import { avg, formatCurrency, monthStart, yearStart, sum } from "@/lib/metrics";
import {
  isCommandCenterPipelineStatus,
  isTerminalRetailStatus,
  PITCH_QUEUE_SET,
  getPipelineMicroStage,
  MICRO_STAGES,
  MACRO_STAGES,
  isExcludedFromLeaderboard,
  type MicroStageKey,
} from "@/lib/loan-status-groups";
import { cn } from "@/lib/cn";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STAGE_LABELS: Record<string, string> = {
  lead: "Lead",
  application: "Application",
  verification: "Verification",
  esign_out: "eSign Out",
  registered: "Registered",
  processing: "Processing",
  submission: "Submission",
  underwriting: "Underwriting",
  conditions: "Conditions",
  approval_conditions: "Approval",
  clear_to_close: "CTC",
  closing: "Closing",
  funded: "Funded",
};

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type LoanRow = {
  id: string;
  shape_record_id: number | null;
  record_type: string | null;
  status_raw: string | null;
  borrower_first_name: string | null;
  borrower_last_name: string | null;
  current_stage: string | null;
  closing_date: string | null;
  closed_at: string | null;
  funded_at: string | null;
  loan_amount_cents: number | null;
  lead_created_at: string | null;
  application_completed_at: string | null;
  credit_report_requested_at: string | null;
  appraisal_ordered_at: string | null;
  appraisal_received_at: string | null;
  loan_type: string | null;
  loan_purpose: string | null;
  track: string | null;
  is_brokered: boolean;
  is_restructure_hold: boolean;
  current_owner_role: string | null;
  esign_returned_at: string | null;
  lock_expiration_date: string | null;
  finance_contingency_date: string | null;
  appraisal_contingency_date: string | null;
  lendingpad_loan_uuid: string | null;
  lendingpad_status_raw: string | null;
  loan_stage_events: Array<{ stage: string; entered_at: string }> | null;
  conditions: Array<{ status: "open" | "cleared" }> | null;
};

type SlaRow = {
  stage: string;
  max_hours: number | null;
  owner_role: string | null;
  sub_steps: unknown;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function stageLabel(stage: string | null) {
  if (!stage) return "—";
  return STAGE_LABELS[stage] ?? stage;
}

function latestStageEntry(events: LoanRow["loan_stage_events"], stage: string | null) {
  if (!stage) return null;
  const hit = (events ?? [])
    .filter((e) => e.stage === stage)
    .map((e) => new Date(e.entered_at))
    .filter((d) => !Number.isNaN(d.getTime()))
    .sort((a, b) => b.getTime() - a.getTime())[0];
  return hit ?? null;
}

function fmtHoursLeft(hrs: number): string {
  if (hrs < 0) return `Overdue ${Math.abs(Math.round(hrs))}h`;
  if (hrs < 1) return "< 1 hr";
  if (hrs < 24) return `${Math.round(hrs)}h`;
  const d = Math.floor(hrs / 24);
  const h = Math.round(hrs % 24);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

function fmtDaysLeft(days: number): string {
  if (days < 0) return `Overdue ${Math.abs(days)}d`;
  if (days === 0) return "Today";
  return `${days}d`;
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default async function LoanOfficerDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ viewAs?: string }>;
}) {
  const { appUser } = await requireCurrentUser();
  const now = new Date();
  const today = startOfDay(now);
  const isPast3PM = now.getHours() >= 15;

  /* ---------- viewAs (admin/executive only) ---------- */

  const isAdmin = canAccessAdmin(appUser.role);
  const { viewAs: viewAsId } = await searchParams;
  const effectiveViewAsId = isAdmin && viewAsId ? viewAsId : null;

  /* ---------- fetch all LO users for the selector (admin only) ---------- */

  let loUsersForSelector: Array<{ id: string; full_name: string | null; role: string }> = [];
  let viewAsUser: { id: string; full_name: string | null; role: string } | null = null;

  const adminClient = createSupabaseAdminClient();

  if (isAdmin) {
    const { data: users } = await adminClient
      .from("users")
      .select("id,full_name,role")
      .in("role", ["loan_officer", "manager", "executive"])
      .order("full_name");
    loUsersForSelector = users ?? [];
    viewAsUser = loUsersForSelector.find((u) => u.id === effectiveViewAsId) ?? null;
  }

  /* ---------- data fetch ---------- */

  const LOAN_SELECT =
    "id,shape_record_id,record_type,status_raw,borrower_first_name,borrower_last_name,current_stage,closing_date,closed_at,funded_at,loan_amount_cents,lead_created_at,application_completed_at,credit_report_requested_at,appraisal_ordered_at,appraisal_received_at,loan_type,loan_purpose,track,is_brokered,is_restructure_hold,current_owner_role,esign_returned_at,lock_expiration_date,finance_contingency_date,appraisal_contingency_date,lendingpad_loan_uuid,lendingpad_status_raw,loan_stage_events(stage,entered_at),conditions(status)";

  let loans: LoanRow[] | null = null;
  let loansError: { message: string } | null = null;
  let slaRows: SlaRow[] | null = null;
  let slaError: { message: string } | null = null;

  if (effectiveViewAsId) {
    const [slaRes, loansRes] = await Promise.all([
      adminClient.from("sla_thresholds").select("stage,max_hours,owner_role,sub_steps"),
      adminClient
        .from("loans")
        .select(LOAN_SELECT)
        .eq("assigned_loan_officer_user_id", effectiveViewAsId)
        .order("lead_created_at", { ascending: false, nullsFirst: true })
        .limit(2000),
    ]);
    slaRows = slaRes.data as SlaRow[] | null;
    slaError = slaRes.error;
    loans = loansRes.data as LoanRow[] | null;
    loansError = loansRes.error;
  } else {
    const supabase = await createSupabaseServerClient();
    const [slaRes, loansRes] = await Promise.all([
      supabase.from("sla_thresholds").select("stage,max_hours,owner_role,sub_steps"),
      supabase
        .from("loans")
        .select(LOAN_SELECT)
        .order("lead_created_at", { ascending: false, nullsFirst: true })
        .limit(2000),
    ]);
    slaRows = slaRes.data as SlaRow[] | null;
    slaError = slaRes.error;
    loans = loansRes.data as LoanRow[] | null;
    loansError = loansRes.error;
  }

  const dataError = slaError || loansError;
  if (dataError) console.error("Dashboard data error:", dataError.message);

  const slaByStage = new Map<string, number>();
  ((slaRows as SlaRow[] | null) ?? []).forEach((r) => {
    if (r.max_hours != null) slaByStage.set(r.stage, r.max_hours);
  });

  const rows = (loans ?? []) as unknown as LoanRow[];

  // ── LP-synced vs Shape-only split ─────────────────────────────────────────
  // Pipeline sections (Command Center, Action Queue, etc.) only show loans
  // that are confirmed in LendingPad. Shape-only leads appear in their own
  // section so the LO knows what's missing from LP.
  const lpSyncedRows = rows.filter((l) => !!l.lendingpad_loan_uuid);
  const shapeOnlyRows = rows.filter((l) => !l.lendingpad_loan_uuid);

  const fundedOrClosedAt = (l: Pick<LoanRow, "closed_at" | "funded_at">) =>
    l.closed_at ?? l.funded_at ?? null;

  /* ---------- computed loan data (LP-synced only) ---------- */

  const loanWithComputed = lpSyncedRows.map((l) => {
    const openConditions = (l.conditions ?? []).filter((c) => c.status === "open").length;
    const stageEntered = latestStageEntry(l.loan_stage_events, l.current_stage);
    const hoursInStage = stageEntered ? differenceInHours(now, stageEntered) : null;
    const daysInStage = stageEntered ? differenceInCalendarDays(now, stageEntered) : null;
    const slaMaxHours = l.current_stage ? (slaByStage.get(l.current_stage) ?? null) : null;
    const slaExceeded = hoursInStage != null && slaMaxHours != null && slaMaxHours > 0 && hoursInStage > slaMaxHours;
    const closingDate = l.closing_date ? new Date(l.closing_date) : null;
    const daysToClose = closingDate ? differenceInCalendarDays(closingDate, today) : null;
    const closingSoon = daysToClose != null && daysToClose >= 0 && daysToClose <= 5 && l.current_stage !== "funded";
    const daysToLock = l.lock_expiration_date ? differenceInCalendarDays(new Date(l.lock_expiration_date), today) : null;
    const lockApproaching = daysToLock != null && daysToLock >= 0 && daysToLock <= 7;
    const daysToFinCont = l.finance_contingency_date ? differenceInCalendarDays(new Date(l.finance_contingency_date), today) : null;
    const finContApproaching = daysToFinCont != null && daysToFinCont >= 0 && daysToFinCont <= 7;
    const daysToApprCont = l.appraisal_contingency_date ? differenceInCalendarDays(new Date(l.appraisal_contingency_date), today) : null;
    const apprContApproaching = daysToApprCont != null && daysToApprCont >= 0 && daysToApprCont <= 7;
    const esignHrs = l.esign_returned_at ? differenceInHours(now, new Date(l.esign_returned_at)) : null;
    const restructureRisk = l.is_restructure_hold || (esignHrs != null && esignHrs >= 40);
    const flag: "red" | "orange" | "yellow" | "green" | "none" = slaExceeded
      ? "red"
      : restructureRisk ? "green"
      : closingSoon ? "orange"
      : openConditions > 0 ? "yellow"
      : "none";

    return {
      ...l, openConditions, hoursInStage, daysInStage, slaMaxHours, slaExceeded,
      closingDate, daysToClose, closingSoon, lockApproaching, daysToLock,
      finContApproaching, daysToFinCont, apprContApproaching, daysToApprCont,
      restructureRisk, esignHrs, flag,
    };
  });

  /* ---------- categorize loans using status_raw ---------- */

  const commandCenterLoans = loanWithComputed.filter((l) =>
    isCommandCenterPipelineStatus(l.status_raw, l.current_stage),
  );
  const prePipelineLoans = loanWithComputed.filter(
    (l) =>
      !isCommandCenterPipelineStatus(l.status_raw, l.current_stage) &&
      !isTerminalRetailStatus(l.status_raw, l.current_stage),
  );
  const pitchQueueLoans = loanWithComputed.filter((l) => PITCH_QUEUE_SET.has(l.status_raw ?? ""));

  /* ---------- micro stage grouping ---------- */

  const loansByMicro = new Map<MicroStageKey, MicroLoan[]>();
  for (const l of commandCenterLoans) {
    const micro = getPipelineMicroStage(l.status_raw, l.current_stage);
    if (!micro) continue;
    if (!loansByMicro.has(micro)) loansByMicro.set(micro, []);
    loansByMicro.get(micro)!.push({
      id: l.id,
      shape_record_id: l.shape_record_id,
      borrower_first_name: l.borrower_first_name,
      borrower_last_name: l.borrower_last_name,
      status_raw: l.status_raw,
      loan_type: l.loan_type,
      loan_amount_cents: l.loan_amount_cents,
      lead_created_at: l.lead_created_at,
      closing_date: l.closing_date,
    });
  }

  /* ---------- macro stage data ---------- */

  const macroData = MACRO_STAGES.map((m) => {
    let count = 0;
    let volume = 0;
    for (const mk of m.microKeys) {
      const staged = loansByMicro.get(mk) ?? [];
      count += staged.length;
      volume += staged.reduce((acc, l) => acc + (l.loan_amount_cents ?? 0), 0);
    }
    return { label: m.label, count, volume };
  });

  /* ---------- appraisals pending ---------- */

  const appraisalsPending = loanWithComputed.filter(
    (l) => l.appraisal_ordered_at && !l.appraisal_received_at,
  );

  /* ---------- Goal Banner ---------- */

  const avgDaysToClose = avg(
    loanWithComputed.map((l) => {
      const end = fundedOrClosedAt(l);
      if (!l.lead_created_at || !end) return null;
      return differenceInCalendarDays(new Date(end), new Date(l.lead_created_at));
    }),
  );

  /* ---------- Action Queue ---------- */

  type UrgencyItem = {
    loan: (typeof loanWithComputed)[number];
    priority: number;
    urgencyLabel: string;
    timeRemaining: string;
    actionNeeded: string;
    rowColor: "red" | "orange" | "yellow" | "none";
  };

  const urgencyItems: UrgencyItem[] = [];
  for (const l of commandCenterLoans) {
    if (l.restructureRisk) {
      const hrsLeft = l.esignHrs != null ? 48 - l.esignHrs : null;
      urgencyItems.push({
        loan: l, priority: 1, urgencyLabel: "Restructure Risk",
        timeRemaining: hrsLeft != null ? fmtHoursLeft(hrsLeft) : "—",
        actionNeeded: "Submit to processing or restructure",
        rowColor: hrsLeft != null && hrsLeft < 0 ? "red" : hrsLeft != null && hrsLeft < 8 ? "orange" : "yellow",
      });
      continue;
    }
    if (l.slaExceeded) {
      const over = l.hoursInStage != null && l.slaMaxHours != null ? l.hoursInStage - l.slaMaxHours : 0;
      urgencyItems.push({ loan: l, priority: 2, urgencyLabel: "SLA Exceeded", timeRemaining: `Overdue ${Math.round(over)}h`, actionNeeded: "Move loan forward", rowColor: "red" });
      continue;
    }
    if (l.lockApproaching) {
      urgencyItems.push({ loan: l, priority: 3, urgencyLabel: "Lock Expiring", timeRemaining: fmtDaysLeft(l.daysToLock!), actionNeeded: "Verify lock status", rowColor: l.daysToLock! <= 0 ? "red" : l.daysToLock! <= 2 ? "orange" : "yellow" });
      continue;
    }
    if (l.finContApproaching || l.apprContApproaching) {
      const minDays = Math.min(l.daysToFinCont ?? 999, l.daysToApprCont ?? 999);
      const label = l.finContApproaching && l.apprContApproaching ? "Dual Contingency" : l.finContApproaching ? "Finance Contingency" : "Appraisal Contingency";
      urgencyItems.push({ loan: l, priority: 4, urgencyLabel: label, timeRemaining: fmtDaysLeft(minDays), actionNeeded: "Clear contingency", rowColor: minDays <= 0 ? "red" : minDays <= 2 ? "orange" : "yellow" });
      continue;
    }
    if (l.openConditions > 0) {
      urgencyItems.push({ loan: l, priority: 5, urgencyLabel: "Open Conditions", timeRemaining: `${l.openConditions} open`, actionNeeded: "Clear conditions", rowColor: "yellow" });
      continue;
    }
    if (l.closingSoon) {
      urgencyItems.push({ loan: l, priority: 6, urgencyLabel: "Closing Soon", timeRemaining: fmtDaysLeft(l.daysToClose!), actionNeeded: "Prepare for closing", rowColor: l.daysToClose! <= 0 ? "red" : l.daysToClose! <= 1 ? "orange" : "yellow" });
    }
  }
  urgencyItems.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const colorRank = (c: string) => (c === "red" ? 0 : c === "orange" ? 1 : c === "yellow" ? 2 : 3);
    return colorRank(a.rowColor) - colorRank(b.rowColor);
  });
  const actionQueue = urgencyItems.slice(0, 15);

  /* ---------- Production Scoreboard ---------- */

  const mStart = monthStart();
  const yStart = yearStart();

  const fundedMtd = loanWithComputed.filter((l) => {
    const end = fundedOrClosedAt(l);
    return end && new Date(end) >= mStart && new Date(end) <= now;
  });
  const fundedYtd = loanWithComputed.filter((l) => {
    const end = fundedOrClosedAt(l);
    return end && new Date(end) >= yStart && new Date(end) <= now;
  });

  const mtdVolumeCents = sum(fundedMtd.map((l) => l.loan_amount_cents ?? null));
  const ytdVolumeCents = sum(fundedYtd.map((l) => l.loan_amount_cents ?? null));
  const mtdLoansClosed = fundedMtd.length;
  const mtdAvgLoanSize = mtdLoansClosed ? Math.round(mtdVolumeCents / mtdLoansClosed) : null;
  const upcomingClosingsCount = commandCenterLoans.filter((l) => l.closingDate && l.closingDate >= today).length;

  /* ---------- Speed Metrics ---------- */

  const leadToCredit = avg(
    loanWithComputed.map((l) => {
      if (!l.lead_created_at || !l.credit_report_requested_at) return null;
      return differenceInCalendarDays(new Date(l.credit_report_requested_at), new Date(l.lead_created_at));
    }),
  );
  const creditToPiped = avg(
    loanWithComputed.map((l) => {
      if (!l.credit_report_requested_at || !l.appraisal_ordered_at) return null;
      return differenceInCalendarDays(new Date(l.appraisal_ordered_at), new Date(l.credit_report_requested_at));
    }),
  );
  const pipedToClosed = avg(
    loanWithComputed.map((l) => {
      const end = fundedOrClosedAt(l);
      if (!l.appraisal_ordered_at || !end) return null;
      return differenceInCalendarDays(new Date(end), new Date(l.appraisal_ordered_at));
    }),
  );
  const totalDaysToClose = avg(
    loanWithComputed.map((l) => {
      const end = fundedOrClosedAt(l);
      if (!l.lead_created_at || !end) return null;
      return differenceInCalendarDays(new Date(end), new Date(l.lead_created_at));
    }),
  );

  /* ---------- Leaderboard (all LOs via admin client) ---------- */

  type LeaderboardEntry = { name: string; creditPulls: number; appraisalsOrdered: number; closedLoans: number; fundedVolumeCents: number };
  let leaderboardData: LeaderboardEntry[] = [];

  try {
    const { data: allUsers } = await adminClient
      .from("users")
      .select("id,full_name,role")
      .in("role", ["loan_officer"]);

    const eligibleUsers = (allUsers ?? []).filter((u) => !isExcludedFromLeaderboard(u.full_name));

    if (eligibleUsers.length > 0) {
      const { data: allLoans } = await adminClient
        .from("loans")
        .select("assigned_loan_officer_user_id,credit_report_requested_at,appraisal_ordered_at,closed_at,funded_at,loan_amount_cents")
        .in("assigned_loan_officer_user_id", eligibleUsers.map((u) => u.id))
        .limit(5000);

      const userMap = new Map(eligibleUsers.map((u) => [u.id, u.full_name ?? "Unknown"]));
      const stats = new Map<string, LeaderboardEntry>();
      for (const u of eligibleUsers) {
        stats.set(u.id, { name: u.full_name ?? "Unknown", creditPulls: 0, appraisalsOrdered: 0, closedLoans: 0, fundedVolumeCents: 0 });
      }
      for (const loan of allLoans ?? []) {
        const uid = loan.assigned_loan_officer_user_id;
        if (!uid || !stats.has(uid)) continue;
        const s = stats.get(uid)!;
        if (loan.credit_report_requested_at) s.creditPulls++;
        if (loan.appraisal_ordered_at) s.appraisalsOrdered++;
        const endAt = loan.closed_at ?? loan.funded_at;
        if (endAt) {
          s.closedLoans++;
          s.fundedVolumeCents += loan.loan_amount_cents ?? 0;
        }
      }
      leaderboardData = Array.from(stats.values());
    }
  } catch {
    // leaderboard is best-effort
  }

  /* ---------- SLA data from activity log ------------------------------------ */

  type SlaViewRow = {
    loan_id: string;
    shape_record_id: number | null;
    borrower_name: string | null;
    borrower_phone?: string | null;
    source?: string | null;
    status_raw: string | null;
    current_stage: string | null;
    sla_color: "green" | "yellow" | "red";
    sla_breach_type: string | null;
    hours_since_last_activity: number | null;
    lead_created_at: string | null;
  };

  let slaViewRows: SlaViewRow[] = [];
  let newLeadsToday: SlaViewRow[] = [];

  try {
    const slaClient = effectiveViewAsId ? adminClient : await createSupabaseServerClient();
    let slaQuery = slaClient
      .from("v_lead_sla_status")
      .select(
        "loan_id,shape_record_id,borrower_name,status_raw,current_stage,sla_color,sla_breach_type,hours_since_last_activity,lead_created_at",
      )
      .in("sla_color", ["red", "yellow"])
      .order("sla_color", { ascending: true })
      .order("hours_since_last_activity", { ascending: false })
      .limit(50);

    if (effectiveViewAsId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      slaQuery = (slaQuery as any).eq("assigned_loan_officer_user_id", effectiveViewAsId);
    }

    const { data: slaData } = await slaQuery;
    slaViewRows = (slaData ?? []) as SlaViewRow[];

    // New leads created today (all colors)
    const todayIso = today.toISOString().slice(0, 10);
    let newLeadsQuery = slaClient
      .from("v_lead_sla_status")
      .select(
        "loan_id,shape_record_id,borrower_name,source,status_raw,current_stage,sla_color,sla_breach_type,hours_since_last_activity,lead_created_at",
      )
      .gte("lead_created_at", `${todayIso}T00:00:00`)
      .order("lead_created_at", { ascending: false })
      .limit(20);

    if (effectiveViewAsId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      newLeadsQuery = (newLeadsQuery as any).eq("assigned_loan_officer_user_id", effectiveViewAsId);
    }

    const { data: newLeadsData } = await newLeadsQuery;
    newLeadsToday = (newLeadsData ?? []) as SlaViewRow[];
  } catch {
    // SLA view not yet deployed — gracefully degrade
  }

  const slaRedCount = slaViewRows.filter((r) => r.sla_color === "red").length;
  const slaYellowCount = slaViewRows.filter((r) => r.sla_color === "yellow").length;

  /* ---------- What's Next — per-loan actionable guidance -------------------- */

  type NextActionItem = {
    loanId: string;
    borrowerName: string;
    statusRaw: string | null;
    stage: string | null;
    nextAction: string;
    priority: number; // lower = more urgent
    shapeRecordId: number | null;
  };

  function deriveNextAction(statusRaw: string | null, stage: string | null): { action: string; priority: number } | null {
    const s = statusRaw?.trim() ?? "";
    switch (s) {
      case "New Lead":
      case "Not Contacted":
      case "Attempting Contact":
        return { action: "Make initial contact — call + text + email", priority: 1 };
      case "Contacted":
        return { action: "Schedule verification appointment", priority: 2 };
      case "Verification":
        return { action: "Verify docs, pull credit report, price loan", priority: 2 };
      case "App Started":
        return { action: "Follow up — push borrower to complete application", priority: 2 };
      case "App Completed":
        return { action: "Review application, schedule pitch appointment", priority: 2 };
      case "Pitch Appt":
        return { action: "Confirm appointment is on calendar — prepare proposal", priority: 1 };
      case "Pitched Advance":
        return { action: "Send pre-pipe docs / intent letter", priority: 2 };
      case "Pitched and Waiting":
        return { action: "Follow up — confirm borrower decision", priority: 1 };
      case "Pitched Not Advance":
        return { action: "Nurture — re-engage in 30 days", priority: 4 };
      case "Pre-Pipe":
        return { action: "Send Package Out / intent letter to borrower", priority: 2 };
      case "Package Out":
        return { action: "Chase signed package + collect appraisal payment", priority: 1 };
      case "Signed Not Piped":
        return { action: "Collect appraisal payment — then pipe to processing", priority: 1 };
      case "Piped":
        return { action: "Submit to processing — ensure all docs uploaded", priority: 2 };
      case "Registered":
        return { action: "Confirm registration, await processing checklist", priority: 3 };
      case "Processing":
        return { action: "Monitor conditions — respond to processor requests", priority: 2 };
      case "Submitted":
        return { action: "Awaiting UW decision — watch for conditions", priority: 3 };
      case "Underwriting":
        return { action: "Respond to UW requests within 24h", priority: 2 };
      case "Conditions Out":
        return { action: "Collect and submit all outstanding conditions", priority: 1 };
      case "Approval Conditions":
        return { action: "Clear final approval conditions immediately", priority: 1 };
      case "Clear to Close":
        return { action: "Confirm closing date + wiring instructions with title", priority: 1 };
      case "Closing":
        return { action: "Confirm closing is on schedule — check for last-minute issues", priority: 1 };
      default:
        if (stage === "lead" || stage === "application") {
          return { action: "Make contact — move to next stage", priority: 2 };
        }
        if (stage === "underwriting" || stage === "conditions") {
          return { action: "Clear conditions — respond to UW", priority: 2 };
        }
        return null;
    }
  }

  const whatsNextItems: NextActionItem[] = [];
  for (const l of rows) {
    if (!l.status_raw) continue;
    const result = deriveNextAction(l.status_raw, l.current_stage);
    if (!result) continue;
    // Skip terminal statuses
    if (["Funded", "Duplicate", "Bad Lead", "Do Not Contact", "Long Term Nurture", "Withdrawn", "Denied"].includes(l.status_raw)) continue;
    whatsNextItems.push({
      loanId: l.id,
      borrowerName: [l.borrower_first_name, l.borrower_last_name].filter(Boolean).join(" ") || "Unknown",
      statusRaw: l.status_raw,
      stage: l.current_stage,
      nextAction: result.action,
      priority: result.priority,
      shapeRecordId: l.shape_record_id,
    });
  }
  // Sort by priority then by lead_created_at desc (most recent first)
  whatsNextItems.sort((a, b) => a.priority - b.priority);
  // Group by priority bucket
  const criticalNextItems = whatsNextItems.filter((i) => i.priority === 1).slice(0, 20);
  const importantNextItems = whatsNextItems.filter((i) => i.priority === 2).slice(0, 15);

  /* ---------- Six-Month Reminders ------------------------------------------- */

  type ReminderLoan = {
    id: string;
    borrower_first_name: string | null;
    borrower_last_name: string | null;
    funded_at: string | null;
    closed_at: string | null;
    loan_amount_cents: number | null;
    loan_type: string | null;
    shape_record_id: number | null;
  };

  let sixMonthReminders: ReminderLoan[] = [];
  try {
    const reminderClient = effectiveViewAsId ? adminClient : await createSupabaseServerClient();
    const fiveMonthsAgo = new Date();
    fiveMonthsAgo.setMonth(fiveMonthsAgo.getMonth() - 7);
    const sevenMonthsAgo = new Date();
    sevenMonthsAgo.setMonth(sevenMonthsAgo.getMonth() - 5);

    let reminderQuery = reminderClient
      .from("loans")
      .select("id,borrower_first_name,borrower_last_name,funded_at,closed_at,loan_amount_cents,loan_type,shape_record_id")
      .or(`funded_at.gte.${fiveMonthsAgo.toISOString()},closed_at.gte.${fiveMonthsAgo.toISOString()}`)
      .lt("funded_at", sevenMonthsAgo.toISOString())
      .order("funded_at", { ascending: false })
      .limit(20);

    if (effectiveViewAsId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      reminderQuery = (reminderQuery as any).eq("assigned_loan_officer_user_id", effectiveViewAsId);
    }

    const { data: reminderData } = await reminderQuery;
    sixMonthReminders = (reminderData ?? []) as ReminderLoan[];
  } catch {
    // best-effort
  }

  /* ---------- Pipeline summary counts --------------------------------------- */

  const PIPELINE_GROUPS: Array<{ label: string; statuses: Set<string> }> = [
    { label: "Verification / App", statuses: new Set(["Verification", "App Started", "App Completed", "Contacted"]) },
    { label: "Pitch Appt / Pitched", statuses: new Set(["Pitch Appt", "Pitched Advance", "Pitched and Waiting"]) },
    { label: "Pre-Pipe / Package", statuses: new Set(["Pre-Pipe", "Package Out", "Signed Not Piped"]) },
    { label: "Processing / UW", statuses: new Set(["Piped", "Registered", "Processing", "Submitted", "Underwriting"]) },
    { label: "Conditions / CTC", statuses: new Set(["Conditions Out", "Approval Conditions", "Clear to Close"]) },
    { label: "Closing", statuses: new Set(["Closing"]) },
  ];

  const pipelineCounts = PIPELINE_GROUPS.map((g) => ({
    label: g.label,
    count: rows.filter((l) => l.status_raw && g.statuses.has(l.status_raw)).length,
  }));

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div className="flex flex-col gap-5 animate-fade-up">
      {dataError ? (
        <div className="rounded-lg border border-amber-500/50 bg-amber-950/30 p-4 text-sm">
          <p className="font-medium">Database setup required</p>
          <p className="mt-1 text-mutedForeground">
            Run the SQL in <code className="rounded bg-muted px-1">supabase/migrations/</code> in your Supabase project. Then refresh.
          </p>
          <p className="mt-2 font-mono text-xs">{dataError.message}</p>
        </div>
      ) : null}

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          {isAdmin && <ViewAsSelector users={loUsersForSelector} currentViewAs={effectiveViewAsId} />}
          <h1 className="text-xl font-semibold tracking-tight" style={{ letterSpacing: "-0.02em" }}>
            Loan Officer Dashboard
          </h1>
          <p className="mt-0.5 text-[13px] text-mutedForeground">
            {viewAsUser ? (
              <>
                <span className="mr-1 text-[11px] uppercase tracking-wide opacity-60">Viewing as</span>
                {viewAsUser.full_name}
              </>
            ) : (
              appUser.full_name
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 pt-0.5">
          {slaRedCount > 0 && (
            <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold"
              style={{ background: "rgba(255,75,75,0.15)", color: "#FF4B4B" }}>
              <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
              {slaRedCount} critical
            </span>
          )}
          {slaYellowCount > 0 && (
            <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold"
              style={{ background: "rgba(245,158,11,0.12)", color: "#F59E0B" }}>
              {slaYellowCount} at risk
            </span>
          )}
          {slaRedCount === 0 && slaYellowCount === 0 && (
            <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium"
              style={{ background: "rgba(34,197,94,0.10)", color: "#22C55E" }}>
              <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
              All on track
            </span>
          )}
        </div>
      </div>

      {/* ── KPI strip ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 anim-d1">
        <KpiCard
          label="Active Pipeline"
          value={commandCenterLoans.length}
          sub={`${lpSyncedRows.length} in LendingPad`}
          color="yellow"
        />
        <KpiCard
          label="Funded MTD"
          value={mtdLoansClosed}
          sub={formatCurrency(mtdVolumeCents)}
          color="green"
          subColor="up"
        />
        <KpiCard
          label="Closing Soon"
          value={commandCenterLoans.filter((l) => l.closingSoon).length}
          sub="within 5 days"
          color={commandCenterLoans.filter((l) => l.closingSoon).length > 0 ? "amber" : "muted"}
        />
        <KpiCard
          label="Past Turn Time"
          value={commandCenterLoans.filter((l) => l.slaExceeded).length}
          sub="SLA exceeded"
          color={commandCenterLoans.filter((l) => l.slaExceeded).length > 0 ? "red" : "green"}
          subColor={commandCenterLoans.filter((l) => l.slaExceeded).length > 0 ? "down" : "up"}
        />
        <KpiCard
          label="Shape Only"
          value={shapeOnlyRows.length}
          sub="not in LendingPad"
          color={shapeOnlyRows.length > 0 ? "blue" : "muted"}
        />
      </div>

      {/* ================================================================ */}
      {/*  New Leads Today                                                 */}
      {/* ================================================================ */}

      {newLeadsToday.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold tracking-tight">New Leads Today</div>
            <span className="rounded-full px-2.5 py-0.5 text-[11px] font-medium"
              style={{ background: "rgba(34,197,94,0.1)", color: "#4ade80" }}>
              {newLeadsToday.length} new
            </span>
          </div>
          <div className="overflow-hidden rounded-xl"
            style={{ border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)" }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-widest text-mutedForeground"
                  style={{ background: "rgba(255,255,255,0.04)" }}>
                  <th className="px-4 py-2.5">Borrower</th>
                  <th className="px-4 py-2.5">Phone</th>
                  <th className="px-4 py-2.5">Source</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Created</th>
                  <th className="px-4 py-2.5">SLA</th>
                </tr>
              </thead>
              <tbody>
                {newLeadsToday.map((lead) => {
                  const shapeUrl = shapeLeadUrl(lead.shape_record_id);
                  return (
                  <tr key={lead.loan_id}
                    style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
                    className={cn(
                      lead.sla_color === "red" && "bg-red-950/20",
                      lead.sla_color === "yellow" && "bg-yellow-950/10",
                    )}>
                    <td className="px-4 py-3 font-medium">
                      {shapeUrl ? (
                        <a href={shapeUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                          {lead.borrower_name || "—"}
                        </a>
                      ) : (lead.borrower_name || "—")}
                    </td>
                    <td className="px-4 py-3 text-xs text-mutedForeground">—</td>
                    <td className="px-4 py-3 text-xs text-mutedForeground">{lead.source || "—"}</td>
                    <td className="px-4 py-3 text-xs text-mutedForeground">{lead.status_raw || "—"}</td>
                    <td className="px-4 py-3 text-xs font-mono text-mutedForeground">
                      {lead.lead_created_at
                        ? new Date(lead.lead_created_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {lead.sla_color === "red" ? (
                        <Badge variant="red">
                          {lead.sla_breach_type ? SLA_BREACH_LABELS[lead.sla_breach_type as keyof typeof SLA_BREACH_LABELS] ?? lead.sla_breach_type : "Critical"}
                        </Badge>
                      ) : lead.sla_color === "yellow" ? (
                        <Badge variant="yellow">
                          {lead.sla_breach_type ? SLA_BREACH_LABELS[lead.sla_breach_type as keyof typeof SLA_BREACH_LABELS] ?? lead.sla_breach_type : "At risk"}
                        </Badge>
                      ) : (
                        <Badge variant="green">On track</Badge>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ================================================================ */}
      {/*  SLA Violations Queue (from activity log)                        */}
      {/* ================================================================ */}

      {slaViewRows.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold tracking-tight">SLA Violations — Needs Attention</div>
            <span className="rounded-full px-2.5 py-0.5 text-[11px] font-medium"
              style={{ background: "rgba(239,68,68,0.1)", color: "#f87171" }}>
              {slaViewRows.length} loan{slaViewRows.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="overflow-hidden rounded-xl"
            style={{ border: "1px solid rgba(239,68,68,0.2)", background: "rgba(255,255,255,0.02)" }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-widest text-mutedForeground"
                  style={{ background: "rgba(255,255,255,0.04)" }}>
                  <th className="px-4 py-2.5">Borrower</th>
                  <th className="px-4 py-2.5">Stage</th>
                  <th className="px-4 py-2.5">Hours Without Activity</th>
                  <th className="px-4 py-2.5">Violation</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {slaViewRows.map((row) => {
                  const shapeUrl = shapeLeadUrl(row.shape_record_id);
                  return (
                  <tr key={row.loan_id}
                    style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
                    className={cn(
                      row.sla_color === "red" && "bg-red-950/20",
                      row.sla_color === "yellow" && "bg-yellow-950/10",
                    )}>
                    <td className="px-4 py-3 font-medium">{row.borrower_name || "—"}</td>
                    <td className="px-4 py-3 text-xs text-mutedForeground">
                      {row.current_stage?.replace(/_/g, " ") ?? "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {row.hours_since_last_activity != null ? `${row.hours_since_last_activity}h` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {row.sla_color === "red" ? (
                        <Badge variant="red">
                          {row.sla_breach_type ? SLA_BREACH_LABELS[row.sla_breach_type as keyof typeof SLA_BREACH_LABELS] ?? row.sla_breach_type : "Critical"}
                        </Badge>
                      ) : (
                        <Badge variant="yellow">
                          {row.sla_breach_type ? SLA_BREACH_LABELS[row.sla_breach_type as keyof typeof SLA_BREACH_LABELS] ?? row.sla_breach_type : "At risk"}
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {shapeUrl && (
                        <a href={shapeUrl} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium hover:opacity-80"
                          style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8" }}>
                          Shape ↗
                        </a>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ================================================================ */}
      {/*  Goal Banner                                                     */}
      {/* ================================================================ */}

      <section
        className="rounded-xl p-4"
        style={{
          background: "rgba(255,255,255,0.03)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          border: "1px solid rgba(255,255,255,0.07)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-foreground">Goal: 14–21 Days to Close</span>
            <span
              className="rounded-full px-3 py-1 text-sm font-semibold"
              style={
                avgDaysToClose != null && avgDaysToClose <= 21
                  ? { background: "rgba(232,255,0,0.12)", color: "#E8FF00" }
                  : { background: "hsl(220 10% 18%)", color: "hsl(215 14% 52%)" }
              }
            >
              Your avg: {avgDaysToClose != null ? `${avgDaysToClose.toFixed(1)} days` : "—"}
            </span>
          </div>
          {isPast3PM ? (
            <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-400">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              Submissions after 3 PM will be processed next business day
            </div>
          ) : null}
        </div>
      </section>

      {/* ================================================================ */}
      {/*  Today's Action Queue                                            */}
      {/* ================================================================ */}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold tracking-tight">Today&apos;s Action Queue</div>
          <div className="rounded-full px-2.5 py-0.5 text-[11px] font-medium"
            style={{ background: "rgba(232,255,0,0.1)", color: "#E8FF00" }}>
            {actionQueue.length} urgent item{actionQueue.length !== 1 ? "s" : ""}
          </div>
        </div>
        <div
          className="overflow-hidden rounded-xl"
          style={{
            background: "rgba(255,255,255,0.02)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: "1px solid rgba(255,255,255,0.07)",
          }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest text-mutedForeground"
                style={{ background: "rgba(255,255,255,0.04)" }}>
                <th className="px-3 py-2.5">Borrower</th>
                <th className="px-3 py-2.5">Loan Type</th>
                <th className="px-3 py-2.5">Stage</th>
                <th className="px-3 py-2.5">Urgency</th>
                <th className="px-3 py-2.5">Time Remaining</th>
                <th className="px-3 py-2.5">Action Needed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {actionQueue.map((item) => (
                <tr key={item.loan.id} className={cn(
                  "transition-colors",
                  item.rowColor === "red" && "bg-red-950/20",
                  item.rowColor === "orange" && "bg-orange-950/20",
                  item.rowColor === "yellow" && "bg-yellow-950/10",
                )}>
                  <td className="px-3 py-2.5">{item.loan.borrower_first_name ?? ""} {item.loan.borrower_last_name ?? ""}</td>
                  <td className="px-3 py-2.5 text-xs text-mutedForeground">{item.loan.loan_type ?? "—"}</td>
                  <td className="px-3 py-2.5">{stageLabel(item.loan.current_stage)}</td>
                  <td className="px-3 py-2.5"><Badge variant={item.rowColor === "red" ? "red" : item.rowColor === "orange" ? "orange" : item.rowColor === "yellow" ? "yellow" : "muted"}>{item.urgencyLabel}</Badge></td>
                  <td className="px-3 py-2.5 font-mono text-xs">{item.timeRemaining}</td>
                  <td className="px-3 py-2.5 text-xs text-mutedForeground">{item.actionNeeded}</td>
                </tr>
              ))}
              {actionQueue.length === 0 ? (
                <tr><td className="px-3 py-6 text-center text-sm text-mutedForeground" colSpan={6}>No urgent items — all loans on track.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {/* ================================================================ */}
      {/*  Pre-Pipeline                                                    */}
      {/* ================================================================ */}

      {prePipelineLoans.length > 0 ? (
        <PrePipelineDashboard
          loans={prePipelineLoans.map((l) => ({
            id: l.id, shape_record_id: l.shape_record_id, borrower_first_name: l.borrower_first_name,
            borrower_last_name: l.borrower_last_name, status_raw: l.status_raw, loan_type: l.loan_type,
            record_type: l.record_type, loan_amount_cents: l.loan_amount_cents, lead_created_at: l.lead_created_at,
          }))}
        />
      ) : null}

      {/* ================================================================ */}
      {/*  Pitch Queue                                                     */}
      {/* ================================================================ */}

      <PitchQueue
        loans={pitchQueueLoans.map((l) => ({
          id: l.id, shape_record_id: l.shape_record_id, borrower_first_name: l.borrower_first_name,
          borrower_last_name: l.borrower_last_name, status_raw: l.status_raw, loan_type: l.loan_type,
          loan_amount_cents: l.loan_amount_cents, lead_created_at: l.lead_created_at,
        }))}
      />

      {/* ================================================================ */}
      {/*  Command Center                                                  */}
      {/* ================================================================ */}

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="h-1 w-4 rounded-full" style={{ background: "#E8FF00" }} />
          <div className="text-sm font-semibold tracking-tight">Command Center &mdash; Questrock File Flow</div>
        </div>

        {/* 4-step macro tracker */}
        <MacroTracker steps={macroData} />

        {/* micro pipeline */}
        <MicroPipeline loansByMicro={loansByMicro} />

        {/* compact KPI row — detailed breakdowns below the top KPI strip */}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Active Loans" value={commandCenterLoans.length} />
          <StatCard
            label="Conditions Outstanding"
            value={commandCenterLoans.filter((l) => l.openConditions > 0).length}
            accent={commandCenterLoans.filter((l) => l.openConditions > 0).length > 0}
          />
          <StatCard label="Closing Soon" value={commandCenterLoans.filter((l) => l.closingSoon).length} subtext="Within 5 days" />
          <StatCard
            label="Past Turn Time"
            value={commandCenterLoans.filter((l) => l.slaExceeded).length}
            accent={commandCenterLoans.filter((l) => l.slaExceeded).length > 0}
            subtext="SLA exceeded"
          />
        </div>
      </section>

      {/* ================================================================ */}
      {/*  Appraisal Tracker                                               */}
      {/* ================================================================ */}

      <AppraisalTracker
        loans={appraisalsPending.map((l) => ({
          id: l.id, shape_record_id: l.shape_record_id, borrower_first_name: l.borrower_first_name,
          borrower_last_name: l.borrower_last_name, loan_type: l.loan_type,
          loan_amount_cents: l.loan_amount_cents, appraisal_ordered_at: l.appraisal_ordered_at,
        }))}
      />

      {/* ================================================================ */}
      {/*  Production Scoreboard                                           */}
      {/* ================================================================ */}

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-1 w-4 rounded-full" style={{ background: "#E8FF00" }} />
          <div className="text-sm font-semibold tracking-tight">Production Scoreboard</div>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <StatCard label="Month to Date Volume" value={formatCurrency(mtdVolumeCents)} />
          <StatCard label="Year to Date Volume" value={formatCurrency(ytdVolumeCents)} />
          <StatCard label="Loans Closed (MTD)" value={mtdLoansClosed} />
          <StatCard label="Average Loan Size" value={formatCurrency(mtdAvgLoanSize)} />
        </div>
      </section>

      {/* ================================================================ */}
      {/*  LO Leaderboard                                                  */}
      {/* ================================================================ */}

      {leaderboardData.length > 0 && <Leaderboard data={leaderboardData} />}

      {/* ================================================================ */}
      {/*  Speed Metrics                                                   */}
      {/* ================================================================ */}

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-1 w-4 rounded-full" style={{ background: "#E8FF00" }} />
          <div className="text-sm font-semibold tracking-tight">Speed Metrics (avg days)</div>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <StatCard label="Lead → Credit" value={leadToCredit?.toFixed(1) ?? "—"} />
          <StatCard label="Credit → Piped" value={creditToPiped?.toFixed(1) ?? "—"} />
          <StatCard label="Piped → Closed" value={pipedToClosed?.toFixed(1) ?? "—"} />
          <StatCard label="Total Days to Close" value={totalDaysToClose?.toFixed(1) ?? "—"} />
        </div>
      </section>

      {/* ================================================================ */}
      {/*  Pipeline Summary Counts                                         */}
      {/* ================================================================ */}

      <section className="space-y-3">
        <div className="text-sm font-semibold tracking-tight">Pipeline at a Glance</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {pipelineCounts.map((g) => (
            <div
              key={g.label}
              className="rounded-xl p-3 text-center"
              style={{
                border: g.count > 0 ? "1px solid rgba(232,255,0,0.15)" : "1px solid rgba(255,255,255,0.06)",
                background: g.count > 0 ? "rgba(232,255,0,0.04)" : "rgba(255,255,255,0.02)",
              }}
            >
              <div
                className="text-2xl font-bold tabular-nums"
                style={{ color: g.count > 0 ? "#E8FF00" : "hsl(215 14% 42%)" }}
              >
                {g.count}
              </div>
              <div className="mt-1 text-[10px] leading-tight text-mutedForeground">{g.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ================================================================ */}
      {/*  What's Next — Actionable guidance per loan                      */}
      {/* ================================================================ */}

      {(criticalNextItems.length > 0 || importantNextItems.length > 0) && (
        <section className="space-y-4">
          <div className="text-sm font-semibold tracking-tight">What&apos;s Next</div>

          {criticalNextItems.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-widest text-red-400">
                Needs action now ({criticalNextItems.length})
              </p>
              <div
                className="overflow-hidden rounded-xl"
                style={{ border: "1px solid rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.03)" }}
              >
                <table className="w-full text-sm">
                  <thead>
                    <tr
                      className="text-left text-[11px] uppercase tracking-widest text-mutedForeground"
                      style={{ background: "rgba(255,255,255,0.03)" }}
                    >
                      <th className="px-4 py-2.5">Borrower</th>
                      <th className="px-4 py-2.5">Current Status</th>
                      <th className="px-4 py-2.5">Next Action</th>
                      <th className="px-4 py-2.5 text-right">Shape #</th>
                    </tr>
                  </thead>
                  <tbody>
                    {criticalNextItems.map((item) => (
                      <tr
                        key={item.loanId}
                        style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
                        className="transition-colors hover:bg-white/[0.02]"
                      >
                        <td className="px-4 py-3 font-medium">{item.borrowerName}</td>
                        <td className="px-4 py-3">
                          <span
                            className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold"
                            style={{ background: "rgba(239,68,68,0.12)", color: "#f87171" }}
                          >
                            {item.statusRaw}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-mutedForeground">{item.nextAction}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-mutedForeground">
                          {item.shapeRecordId ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {importantNextItems.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-widest text-amber-400">
                Up next ({importantNextItems.length})
              </p>
              <div
                className="overflow-hidden rounded-xl"
                style={{ border: "1px solid rgba(245,158,11,0.15)", background: "rgba(245,158,11,0.03)" }}
              >
                <table className="w-full text-sm">
                  <thead>
                    <tr
                      className="text-left text-[11px] uppercase tracking-widest text-mutedForeground"
                      style={{ background: "rgba(255,255,255,0.03)" }}
                    >
                      <th className="px-4 py-2.5">Borrower</th>
                      <th className="px-4 py-2.5">Current Status</th>
                      <th className="px-4 py-2.5">Next Action</th>
                      <th className="px-4 py-2.5 text-right">Shape #</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importantNextItems.map((item) => (
                      <tr
                        key={item.loanId}
                        style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
                        className="transition-colors hover:bg-white/[0.02]"
                      >
                        <td className="px-4 py-3 font-medium">{item.borrowerName}</td>
                        <td className="px-4 py-3">
                          <span
                            className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold"
                            style={{ background: "rgba(245,158,11,0.1)", color: "#fbbf24" }}
                          >
                            {item.statusRaw}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-mutedForeground">{item.nextAction}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-mutedForeground">
                          {item.shapeRecordId ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ================================================================ */}
      {/*  Six-Month Repeat Client Reminders                               */}
      {/* ================================================================ */}

      {sixMonthReminders.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="h-1 w-4 rounded-full" style={{ background: "#a78bfa" }} />
            <div className="text-sm font-semibold tracking-tight">Repeat Client Reminders</div>
            <span
              className="rounded-full px-2.5 py-0.5 text-[11px] font-medium"
              style={{ background: "rgba(139,92,246,0.12)", color: "#a78bfa" }}
            >
              6-month window
            </span>
          </div>
          <p className="text-xs text-mutedForeground">
            These clients funded 5–7 months ago. Now is the time to reconnect — check-in call, ask for referrals, discuss rate improvement opportunities.
          </p>
          <div
            className="overflow-hidden rounded-xl"
            style={{ border: "1px solid rgba(139,92,246,0.2)", background: "rgba(139,92,246,0.03)" }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="text-left text-[11px] uppercase tracking-widest text-mutedForeground"
                  style={{ background: "rgba(255,255,255,0.03)" }}
                >
                  <th className="px-4 py-2.5">Borrower</th>
                  <th className="px-4 py-2.5">Loan Type</th>
                  <th className="px-4 py-2.5 text-right">Loan Amount</th>
                  <th className="px-4 py-2.5">Funded</th>
                  <th className="px-4 py-2.5">Action</th>
                </tr>
              </thead>
              <tbody>
                {sixMonthReminders.map((l) => {
                  const fundedDate = l.funded_at ?? l.closed_at;
                  const monthsAgo = fundedDate
                    ? Math.round(
                        (now.getTime() - new Date(fundedDate).getTime()) / (1000 * 60 * 60 * 24 * 30),
                      )
                    : null;
                  return (
                    <tr
                      key={l.id}
                      style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
                      className="transition-colors hover:bg-white/[0.02]"
                    >
                      <td className="px-4 py-3 font-medium">
                        {[l.borrower_first_name, l.borrower_last_name].filter(Boolean).join(" ") || "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-mutedForeground">
                        {l.loan_type ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-xs">
                        {l.loan_amount_cents ? formatCurrency(l.loan_amount_cents) : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-mutedForeground">
                        {fundedDate
                          ? new Date(fundedDate).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })
                          : "—"}
                        {monthsAgo != null ? (
                          <span className="ml-1.5 text-mutedForeground/60">({monthsAgo}mo ago)</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                          style={{ background: "rgba(139,92,246,0.15)", color: "#a78bfa" }}
                        >
                          Call to reconnect
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ================================================================ */}
      {/*  In Shape, Not in LendingPad                                     */}
      {/* ================================================================ */}

      {shapeOnlyRows.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="h-1 w-4 rounded-full" style={{ background: "rgba(245,158,11,0.8)" }} />
            <div className="text-sm font-semibold tracking-tight">
              In Shape, Not in LendingPad
            </div>
            <span
              className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
              style={{ background: "rgba(245,158,11,0.12)", color: "#fbbf24" }}
            >
              {shapeOnlyRows.length}
            </span>
          </div>
          <p className="text-xs text-mutedForeground">
            These leads exist in Shape but have no linked LendingPad loan. They do not appear in the pipeline above.
          </p>
          <div
            className="overflow-hidden rounded-xl"
            style={{
              border: "1px solid rgba(245,158,11,0.18)",
              background: "rgba(245,158,11,0.03)",
            }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="text-left text-[11px] uppercase tracking-widest text-mutedForeground"
                  style={{ background: "rgba(255,255,255,0.03)" }}
                >
                  <th className="px-4 py-2.5">Borrower</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Loan Type</th>
                  <th className="px-4 py-2.5 text-right">Amount</th>
                  <th className="px-4 py-2.5">Lead Created</th>
                  <th className="px-4 py-2.5 text-right">Shape #</th>
                </tr>
              </thead>
              <tbody>
                {shapeOnlyRows
                  .filter(
                    (l) =>
                      !isTerminalRetailStatus(l.status_raw, l.current_stage)
                  )
                  .sort((a, b) => {
                    const da = a.lead_created_at ? new Date(a.lead_created_at).getTime() : 0;
                    const db = b.lead_created_at ? new Date(b.lead_created_at).getTime() : 0;
                    return db - da;
                  })
                  .slice(0, 50)
                  .map((l) => (
                    <tr
                      key={l.id}
                      className="transition-colors hover:bg-white/[0.02]"
                      style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
                    >
                      <td className="px-4 py-3 font-medium text-foreground">
                        {[l.borrower_first_name, l.borrower_last_name].filter(Boolean).join(" ") || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
                          style={{ background: "rgba(245,158,11,0.12)", color: "#fbbf24" }}
                        >
                          {l.status_raw ?? l.current_stage ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-mutedForeground">
                        {l.loan_type ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-mutedForeground">
                        {l.loan_amount_cents
                          ? formatCurrency(l.loan_amount_cents)
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-mutedForeground">
                        {l.lead_created_at
                          ? new Date(l.lead_created_at).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-mutedForeground">
                        {l.shape_record_id ?? "—"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
