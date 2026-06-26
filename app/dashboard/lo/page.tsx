import { Suspense } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireCurrentUser } from "@/lib/current-user";
import { canAccessAdmin } from "@/lib/permissions";
import { ViewAsSelector } from "@/components/dashboard/ViewAsSelector";
import { LoCommandCenter } from "@/components/dashboard/lo/LoCommandCenter";
import { buildPipelineLoans } from "@/lib/shape-views/lo-dashboard";
import {
  fetchLoDashboardLoans,
  fetchRichLoanDataByIds,
  windowStartIso,
} from "@/lib/shape-views/fetch-lo-dashboard";

export const revalidate = 60;

export default async function LoanOfficerDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ viewAs?: string }>;
}) {
  const { appUser } = await requireCurrentUser();
  const params = await searchParams;

  const isAdmin = canAccessAdmin(appUser.role);
  const effectiveViewAsId = isAdmin && params.viewAs ? params.viewAs : null;

  const adminClient = createSupabaseAdminClient();
  let loUsersForSelector: Array<{ id: string; full_name: string | null; role: string }> = [];
  let viewAsUser: { id: string; full_name: string | null; role: string } | null = null;

  if (isAdmin) {
    const { data: users } = await adminClient
      .from("users")
      .select("id,full_name,role")
      .in("role", ["loan_officer", "manager", "executive"])
      .order("full_name");
    loUsersForSelector = users ?? [];
    viewAsUser = loUsersForSelector.find((u) => u.id === effectiveViewAsId) ?? null;
  }

  const fetchClient = effectiveViewAsId ? adminClient : await createSupabaseServerClient();
  const { loans, error } = await fetchLoDashboardLoans(fetchClient, {
    windowStartIso: windowStartIso(),
    assignedLoUserId: effectiveViewAsId ?? undefined,
  });

  const pipelineIds = buildPipelineLoans(loans).map((loan) => loan.id);
  const richByLoanId = await fetchRichLoanDataByIds(fetchClient, pipelineIds);

  const loUsers = loUsersForSelector.length
    ? loUsersForSelector.map((u) => ({ id: u.id, full_name: u.full_name }))
    : appUser.full_name
      ? [{ id: appUser.id, full_name: appUser.full_name }]
      : [];

  const pageTitle =
    effectiveViewAsId && viewAsUser
      ? `Daily command center — ${viewAsUser.full_name ?? "LO"}`
      : "Daily command center";

  return (
    <div className="flex flex-col gap-4">
      {isAdmin && loUsersForSelector.length > 0 && (
        <Suspense fallback={null}>
          <ViewAsSelector users={loUsersForSelector} currentViewAs={effectiveViewAsId} />
        </Suspense>
      )}

      {error ? (
        <div className="rounded-md border border-red-600/50 bg-red-50 px-3 py-2 text-sm text-red-900 dark:bg-red-950/30 dark:text-red-200">
          Failed to load loans: {error}
        </div>
      ) : null}

      <LoCommandCenter loans={loans} richByLoanId={richByLoanId} loUsers={loUsers} pageTitle={pageTitle} />
    </div>
  );
}
