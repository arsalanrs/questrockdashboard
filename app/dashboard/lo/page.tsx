import { Suspense } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireCurrentUser } from "@/lib/current-user";
import { canAccessAdmin } from "@/lib/permissions";
import { ViewAsSelector } from "@/components/dashboard/ViewAsSelector";
import { ShapePipelineNav } from "@/components/dashboard/ShapePipelineNav";
import { ShapeViewTable } from "@/components/dashboard/ShapeViewTable";
import { getViewById } from "@/lib/shape-views";
import { parseShapePipelineSearchParams } from "@/lib/shape-views/parse-params";
import {
  countLoansByView,
  fetchShapeLoansWindow,
  filterLoansForView,
  windowStartIso,
} from "@/lib/shape-views/query-loans";

export const revalidate = 60;

export default async function LoanOfficerDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ viewAs?: string; category?: string; view?: string }>;
}) {
  const { appUser } = await requireCurrentUser();
  const params = await searchParams;
  const now = new Date();
  const { category, viewId } = parseShapePipelineSearchParams(params, now);
  const activeView = getViewById(viewId, now);

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

  const windowStart = windowStartIso();
  const fetchClient = effectiveViewAsId ? adminClient : await createSupabaseServerClient();

  const fetchOptions = {
    windowStartIso: windowStart,
    assignedLoUserId: effectiveViewAsId ?? undefined,
  };

  const { loans, error } = await fetchShapeLoansWindow(fetchClient, fetchOptions);

  const viewCounts = countLoansByView(loans, now);
  const viewRows = filterLoansForView(loans, viewId, now);

  const extraParams: Record<string, string | undefined> = {};
  if (effectiveViewAsId) extraParams.viewAs = effectiveViewAsId;

  const pageTitle = effectiveViewAsId && viewAsUser
    ? `Pipeline — ${viewAsUser.full_name ?? "LO"}`
    : "Shape Pipeline";

  return (
    <div className="flex flex-col gap-5 py-3 animate-fade-up">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight" style={{ letterSpacing: "-0.02em" }}>
            {pageTitle}
          </h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Nikk&apos;s Shape views · 90-day window · {loans.length} records loaded
          </p>
        </div>
        {activeView && (
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-right">
            <div className="text-2xl font-bold tabular-nums">{viewRows.length}</div>
            <div className="text-[11px] text-muted-foreground">{activeView.label}</div>
          </div>
        )}
      </div>

      {isAdmin && loUsersForSelector.length > 0 && (
        <Suspense fallback={null}>
          <ViewAsSelector users={loUsersForSelector} currentViewAs={effectiveViewAsId} />
        </Suspense>
      )}

      {error && (
        <div className="rounded-md border border-red-600/50 bg-red-50 px-3 py-2 text-sm dark:bg-red-950/30">
          Failed to load loans: {error}
        </div>
      )}

      <ShapePipelineNav
        basePath="/dashboard/lo"
        category={category}
        activeViewId={viewId}
        viewCounts={viewCounts}
        extraParams={extraParams}
      />

      <ShapeViewTable rows={viewRows} viewId={viewId} />
    </div>
  );
}
