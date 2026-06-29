import { notFound } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireCurrentUser } from "@/lib/current-user";
import { canAccessAdmin } from "@/lib/permissions";
import { filterLoDashboardUsers } from "@/lib/dashboard/lo-selector";
import { LoCommandCenter } from "@/components/dashboard/lo/LoCommandCenter";
import {
  fetchLoDashboardLoans,
  fetchRichLoanDataByIds,
  windowStartIso,
} from "@/lib/shape-views/fetch-lo-dashboard";
import { richLoanIdsForRows } from "@/lib/shape-views/merge-lo-dashboard-rows";
import { LoSelector } from "./LoSelector";

export const revalidate = 60;

const PIPED_STAGES = new Set([
  "verification",
  "esign_out",
  "processing",
  "underwriting",
  "approval_conditions",
  "clear_to_close",
  "closing",
]);

type UserRow = {
  id: string;
  full_name: string | null;
  role: string;
};

type LoanStatsRow = {
  assigned_loan_officer_user_id: string | null;
  current_stage: string | null;
};

function loStatsFromRows(rows: LoanStatsRow[], userId: string) {
  const mine = rows.filter((l) => l.assigned_loan_officer_user_id === userId);
  const pipeline = mine.filter((l) => l.current_stage && PIPED_STAGES.has(l.current_stage)).length;
  const prePipeline = mine.filter(
    (l) => l.current_stage !== "funded" && !(l.current_stage && PIPED_STAGES.has(l.current_stage)),
  ).length;
  return { total: mine.length, pipeline, prePipeline };
}

export default async function AdminViewPage({ searchParams }: { searchParams: Promise<{ lo?: string }> }) {
  const { appUser } = await requireCurrentUser();
  if (!canAccessAdmin(appUser.role)) notFound();

  const { lo: selectedLo = "unassigned" } = await searchParams;
  const admin = createSupabaseAdminClient();
  const windowStart = windowStartIso();

  const { data: allUsers } = await admin
    .from("users")
    .select("id,full_name,role")
    .in("role", ["loan_officer", "manager", "executive"])
    .order("full_name");

  const loUsers: UserRow[] = filterLoDashboardUsers(allUsers ?? []);

  const { data: statsRows } = await admin
    .from("loans")
    .select("assigned_loan_officer_user_id,current_stage")
    .or(`lead_created_at.gte.${windowStart},shape_last_updated_at.gte.${windowStart}`)
    .limit(5000);

  const stats = (statsRows ?? []) as LoanStatsRow[];
  const unassignedCount = stats.filter((l) => !l.assigned_loan_officer_user_id).length;

  const selectorItems = [
    {
      id: "unassigned" as const,
      full_name: "Unassigned Leads" as const,
      total: unassignedCount,
      pipeline: 0,
      prePipeline: unassignedCount,
    },
    ...loUsers.map((u) => ({ id: u.id, full_name: u.full_name, ...loStatsFromRows(stats, u.id) })),
  ];

  const selectedUser = loUsers.find((u) => u.id === selectedLo);

  let fetchResult: Awaited<ReturnType<typeof fetchLoDashboardLoans>>;
  if (selectedLo === "unassigned") {
    fetchResult = await fetchLoDashboardLoans(admin, { windowStartIso: windowStart });
    fetchResult.loans = fetchResult.loans.filter((l) => !l.assigned_loan_officer_user_id);
  } else if (selectedUser) {
    fetchResult = await fetchLoDashboardLoans(admin, {
      windowStartIso: windowStart,
      assignedLoUserId: selectedUser.id,
      assignedLoName: selectedUser.full_name,
    });
  } else {
    notFound();
  }

  const { loans, error } = fetchResult;

  const richByLoanIdRaw = await fetchRichLoanDataByIds(admin, richLoanIdsForRows(loans));
  const richByLoanId = { ...richByLoanIdRaw };
  for (const loan of loans) {
    const alt = (loan as { _richLoanId?: string })._richLoanId;
    if (alt && richByLoanId[alt] && !richByLoanId[loan.id]) {
      richByLoanId[loan.id] = richByLoanId[alt];
    }
  }

  const loUsersForCenter = loUsers.map((u) => ({ id: u.id, full_name: u.full_name }));

  const pageTitle =
    selectedLo === "unassigned"
      ? `Team view — Unassigned (${loans.length})`
      : `Team view — ${selectedUser?.full_name ?? "LO"}`;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div>
        <p className="lo-accent-text text-[11px] font-semibold uppercase tracking-[0.14em]">Admin</p>
        <h1 className="lo-heading text-xl font-semibold tracking-tight">Team View</h1>
        <p className="lo-muted mt-1 text-sm">
          Select a loan officer to open their command center. Unassigned leads need an LO in Shape.
        </p>
      </div>

      <LoSelector items={selectorItems} currentLo={selectedLo} />

      {selectedLo === "unassigned" && loans.length > 0 ? (
        <div className="lo-card border-amber-500/30 bg-amber-50/80 px-4 py-3 text-sm dark:bg-amber-950/20">
          <p className="font-medium text-amber-900 dark:text-amber-200">
            {loans.length} lead{loans.length !== 1 ? "s" : ""} not assigned to any loan officer
          </p>
          <p className="lo-muted mt-1 text-amber-800 dark:text-amber-300/90">
            Assign these in Shape so they appear on the correct LO dashboard.
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          Failed to load loans: {error}
        </div>
      ) : null}

      <LoCommandCenter
        loans={loans}
        richByLoanId={richByLoanId}
        loUsers={loUsersForCenter}
        pageTitle={pageTitle}
        lockedOwnerId={selectedLo === "unassigned" ? null : selectedLo}
        showOwnerFilter={false}
      />
    </div>
  );
}
