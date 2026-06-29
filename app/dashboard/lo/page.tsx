import { Suspense } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireCurrentUser } from "@/lib/current-user";
import { canViewAsLoanOfficer } from "@/lib/permissions";
import { filterLoDashboardUsers } from "@/lib/dashboard/lo-selector";
import { ViewAsSelector } from "@/components/dashboard/ViewAsSelector";
import { LoCommandCenter } from "@/components/dashboard/lo/LoCommandCenter";
import {
  fetchLoDashboardLoans,
  fetchRichLoanDataByIds,
  windowStartIso,
} from "@/lib/shape-views/fetch-lo-dashboard";
import { richLoanIdsForRows } from "@/lib/shape-views/merge-lo-dashboard-rows";

export const revalidate = 60;

export default async function LoanOfficerDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ viewAs?: string }>;
}) {
  const { appUser } = await requireCurrentUser();
  const params = await searchParams;

  const canViewAs = canViewAsLoanOfficer(appUser.role);
  const isLoanOfficer = appUser.role === "loan_officer";
  const effectiveViewAsId = canViewAs && params.viewAs ? params.viewAs : null;

  const adminClient = createSupabaseAdminClient();
  let loUsersForSelector: Array<{ id: string; full_name: string | null; role: string }> = [];
  let viewAsUser: { id: string; full_name: string | null; role: string } | null = null;

  if (canViewAs) {
    const { data: users } = await adminClient
      .from("users")
      .select("id,full_name,role")
      .in("role", ["loan_officer", "manager", "executive"])
      .order("full_name");
    loUsersForSelector = filterLoDashboardUsers(users ?? []);
    viewAsUser = loUsersForSelector.find((u) => u.id === effectiveViewAsId) ?? null;
  }

  const windowStart = windowStartIso();
  const fetchOptions = { windowStartIso: windowStart };

  let fetchClient = await createSupabaseServerClient();
  let lockedOwnerId: string | null = null;

  if (isLoanOfficer) {
    fetchClient = adminClient;
    lockedOwnerId = appUser.id;
    Object.assign(fetchOptions, {
      assignedLoUserId: appUser.id,
      assignedLoName: appUser.full_name,
    });
  } else if (canViewAs && effectiveViewAsId) {
    fetchClient = adminClient;
    Object.assign(fetchOptions, {
      assignedLoUserId: effectiveViewAsId,
      assignedLoName: viewAsUser?.full_name ?? null,
    });
  } else if (canViewAs) {
    fetchClient = adminClient;
  }

  const { loans, error } = await fetchLoDashboardLoans(fetchClient, fetchOptions);

  const richByLoanIdRaw = await fetchRichLoanDataByIds(fetchClient, richLoanIdsForRows(loans));
  const richByLoanId = { ...richByLoanIdRaw };
  for (const loan of loans) {
    const alt = (loan as { _richLoanId?: string })._richLoanId;
    if (alt && richByLoanId[alt] && !richByLoanId[loan.id]) {
      richByLoanId[loan.id] = richByLoanId[alt];
    }
  }

  const loUsers = loUsersForSelector.length
    ? loUsersForSelector.map((u) => ({ id: u.id, full_name: u.full_name }))
    : appUser.full_name
      ? [{ id: appUser.id, full_name: appUser.full_name }]
      : [];

  const pageTitle =
    effectiveViewAsId && viewAsUser
      ? `Daily command center — ${viewAsUser.full_name ?? "LO"}`
      : isLoanOfficer
        ? `Daily command center — ${appUser.full_name ?? "My book"}`
        : "Daily command center";

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {canViewAs && loUsersForSelector.length > 0 && (
        <Suspense fallback={null}>
          <ViewAsSelector users={loUsersForSelector} currentViewAs={effectiveViewAsId} />
        </Suspense>
      )}

      {error ? (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          Failed to load loans: {error}
        </div>
      ) : null}

      <LoCommandCenter
        loans={loans}
        richByLoanId={richByLoanId}
        loUsers={loUsers}
        pageTitle={pageTitle}
        lockedOwnerId={lockedOwnerId}
        showOwnerFilter={canViewAs && !isLoanOfficer}
      />
    </div>
  );
}
