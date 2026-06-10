import { differenceInCalendarDays, format, startOfDay } from "date-fns";
import { notFound } from "next/navigation";
import { Badge } from "@/components/Badge";
import { StatCard } from "@/components/StatCard";
import { requireCurrentUser } from "@/lib/current-user";
import { canViewManagerDashboard } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatCurrency, monthStart, sum } from "@/lib/metrics";

type LoanRow = {
  id: string;
  shape_record_id: number | null;
  borrower_first_name: string | null;
  borrower_last_name: string | null;
  current_stage: string | null;
  closing_date: string | null;
  closed_at: string | null;
  funded_at: string | null;
  loan_amount_cents: number | null;
  assigned_loan_officer_user_id: string | null;
  assigned_loan_officer_name: string | null;
  lendingpad_loan_uuid: string | null;
  loan_stage_events: Array<{ entered_at: string }> | null;
  conditions: Array<{ status: "open" | "cleared" }> | null;
};

function daysInStage(events: Array<{ entered_at: string }> | null | undefined): number | null {
  const latest = (events ?? [])
    .map((e) => new Date(e.entered_at))
    .filter((d) => !Number.isNaN(d.getTime()))
    .sort((a, b) => b.getTime() - a.getTime())[0];
  if (!latest) return null;
  return differenceInCalendarDays(new Date(), latest);
}

function borrowerName(l: { borrower_first_name: string | null; borrower_last_name: string | null }) {
  return [l.borrower_first_name, l.borrower_last_name].filter(Boolean).join(" ") || "—";
}

function stageLabel(s: string | null) {
  if (!s) return "—";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatClosingDate(d: string) {
  try {
    return format(new Date(d), "MMM d");
  } catch {
    return d;
  }
}

// ─── Small inline components ────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[13px] font-semibold uppercase tracking-widest text-mutedForeground">
        {children}
      </span>
      <div className="h-px flex-1" style={{ background: "rgba(255,255,255,0.06)" }} />
    </div>
  );
}

function EmptyRow({ cols, message }: { cols: number; message: string }) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-6 text-center text-sm text-mutedForeground">
        {message}
      </td>
    </tr>
  );
}

function ConditionPill({ count }: { count: number }) {
  if (count === 0) return <span className="text-mutedForeground">—</span>;
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ background: "rgba(239,68,68,0.15)", color: "#f87171" }}
    >
      {count} open
    </span>
  );
}

function DaysOverBadge({ days, sla }: { days: number; sla: number }) {
  const over = days - sla;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums"
      style={{ background: "rgba(239,68,68,0.15)", color: "#f87171" }}
    >
      {days}d
      <span style={{ color: "rgba(248,113,113,0.6)" }}>+{over}</span>
    </span>
  );
}

function DaysWarningBadge({ days }: { days: number }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums"
      style={{ background: "rgba(245,158,11,0.15)", color: "#fbbf24" }}
    >
      {days}d left
    </span>
  );
}

function OverdueBadge({ daysLate }: { daysLate: number }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums"
      style={{ background: "rgba(239,68,68,0.18)", color: "#f87171" }}
    >
      {daysLate}d late
    </span>
  );
}

function TableWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{
        border: "1px solid rgba(255,255,255,0.07)",
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-mutedForeground ${right ? "text-right" : "text-left"}`}
      style={{ background: "rgba(255,255,255,0.03)" }}
    >
      {children}
    </th>
  );
}

function Td({ children, right, mono }: { children: React.ReactNode; right?: boolean; mono?: boolean }) {
  return (
    <td
      className={`px-4 py-3 ${right ? "text-right" : ""} ${mono ? "font-mono text-xs" : ""}`}
      style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
    >
      {children}
    </td>
  );
}

// ─── LO card (Who Has What grid) ────────────────────────────────────────────

function LoCard({
  name,
  active,
  stuck,
  closingThisWeek,
  mtdLoans,
  mtdVolumeCents,
}: {
  name: string;
  active: number;
  stuck: number;
  closingThisWeek: number;
  mtdLoans: number;
  mtdVolumeCents: number;
}) {
  const hasIssues = stuck > 0;
  return (
    <div
      className="relative overflow-hidden rounded-xl p-4 transition-all duration-150"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: hasIssues
          ? "1px solid rgba(239,68,68,0.25)"
          : "1px solid rgba(255,255,255,0.07)",
        boxShadow: hasIssues ? "0 0 0 1px rgba(239,68,68,0.10) inset" : undefined,
      }}
    >
      {/* Status dot */}
      <div
        className="absolute right-3 top-3 h-2 w-2 rounded-full"
        style={{ background: hasIssues ? "#ef4444" : "#22c55e" }}
      />

      {/* Name */}
      <div className="mb-3 pr-4 text-sm font-semibold text-foreground">{name}</div>

      {/* Mini stats row */}
      <div className="mb-3 grid grid-cols-3 gap-2">
        <div className="text-center">
          <div className="text-lg font-bold tabular-nums text-foreground">{active}</div>
          <div className="text-[10px] text-mutedForeground">Active</div>
        </div>
        <div className="text-center">
          <div
            className="text-lg font-bold tabular-nums"
            style={{ color: stuck > 0 ? "#f87171" : "var(--foreground)" }}
          >
            {stuck}
          </div>
          <div className="text-[10px] text-mutedForeground">Stuck</div>
        </div>
        <div className="text-center">
          <div
            className="text-lg font-bold tabular-nums"
            style={{ color: closingThisWeek > 0 ? "#E8FF00" : "var(--foreground)" }}
          >
            {closingThisWeek}
          </div>
          <div className="text-[10px] text-mutedForeground">Closing</div>
        </div>
      </div>

      {/* MTD footer */}
      <div
        className="rounded-lg px-2.5 py-1.5 text-xs"
        style={{ background: "rgba(255,255,255,0.04)" }}
      >
        <span className="text-mutedForeground">MTD </span>
        <span className="font-medium text-foreground">{mtdLoans} loans</span>
        <span className="mx-1.5 text-mutedForeground">/</span>
        <span className="font-medium text-foreground">{formatCurrency(mtdVolumeCents)}</span>
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function ManagerDashboardPage() {
  const { appUser } = await requireCurrentUser();
  if (!canViewManagerDashboard(appUser.role)) notFound();

  const supabase = await createSupabaseServerClient();

  const [{ data: slaRows, error: slaError }, { data: teamRows, error: teamErr }, { data: loans, error: loansErr }, { data: activeLoUsers }] =
    await Promise.all([
      supabase.from("sla_thresholds").select("stage,max_days"),
      supabase.from("teams").select("id,name,manager_user_id"),
      supabase
        .from("loans")
        .select(
          "id,shape_record_id,borrower_first_name,borrower_last_name,current_stage,closing_date,closed_at,funded_at,loan_amount_cents,assigned_loan_officer_user_id,assigned_loan_officer_name,lendingpad_loan_uuid,loan_stage_events(entered_at),conditions(status)"
        )
        .limit(1000),
      // Only LOs and managers who are active — used to filter the "Who Has What" grid.
      // Executives (Bill, Ray, Nikk) are excluded; they don't work the pipeline as LOs.
      supabase
        .from("users")
        .select("id,full_name")
        .in("role", ["loan_officer", "manager"])
        .eq("is_active", true),
    ]);

  if (slaError) throw slaError;
  if (teamErr) throw teamErr;
  if (loansErr) throw loansErr;

  const teams = (teamRows ?? []).filter((t) => t.manager_user_id === appUser.id);
  if (!teams.length && appUser.role === "manager") {
    return (
      <div className="space-y-2 p-6">
        <h1 className="text-xl font-semibold">Manager</h1>
        <p className="text-sm text-mutedForeground">No team has been assigned to you yet.</p>
      </div>
    );
  }

  const slaByStage = new Map<string, number>();
  (slaRows ?? []).forEach((r) => slaByStage.set(r.stage, r.max_days));

  const today = startOfDay(new Date());
  const mStart = monthStart();
  const sevenDaysOut = new Date(today);
  sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);

  const loanRows = (loans ?? []) as unknown as LoanRow[];
  const activeLoans = loanRows.filter(
    (l) => l.current_stage && !["funded", "closed", "withdrawn", "denied"].includes(l.current_stage)
  );

  // Annotate every active loan with SLA info
  type AnnotatedLoan = LoanRow & {
    daysInCurrentStage: number | null;
    slaMax: number | null;
    slaExceeded: boolean;
    daysOverSla: number;
    openConditions: number;
  };

  const annotated: AnnotatedLoan[] = activeLoans.map((l) => {
    const d = daysInStage(l.loan_stage_events);
    const slaMax = l.current_stage ? (slaByStage.get(l.current_stage) ?? null) : null;
    const exceeded = d != null && slaMax != null && d > slaMax;
    const openConditions = (l.conditions ?? []).filter((c) => c.status === "open").length;
    return {
      ...l,
      daysInCurrentStage: d,
      slaMax,
      slaExceeded: exceeded,
      daysOverSla: exceeded && d != null && slaMax != null ? d - slaMax : 0,
      openConditions,
    };
  });

  // ── Section 1: What's Not Moving (SLA exceeded) ──────────────────────────
  const stuckLoans = annotated
    .filter((l) => l.slaExceeded)
    .sort((a, b) => (b.daysOverSla ?? 0) - (a.daysOverSla ?? 0))
    .slice(0, 30);

  // ── Section 2a: What's Late — overdue closings ────────────────────────────
  const overdueClosings = activeLoans
    .filter((l) => l.closing_date && new Date(l.closing_date) < today && !l.closed_at)
    .map((l) => ({
      ...l,
      daysLate: differenceInCalendarDays(today, new Date(l.closing_date!)),
      openConditions: (l.conditions ?? []).filter((c) => c.status === "open").length,
    }))
    .sort((a, b) => b.daysLate - a.daysLate)
    .slice(0, 20);

  // ── Section 2b: What's Late — at-risk (closing within 7 days, open conds) ─
  const atRiskClosings = activeLoans
    .filter((l) => {
      if (!l.closing_date) return false;
      const cd = new Date(l.closing_date);
      return cd >= today && cd <= sevenDaysOut;
    })
    .map((l) => ({
      ...l,
      daysLeft: differenceInCalendarDays(new Date(l.closing_date!), today),
      openConditions: (l.conditions ?? []).filter((c) => c.status === "open").length,
    }))
    .filter((l) => l.openConditions > 0)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 20);

  // ── Section 3: Who Has What — per-LO stats ───────────────────────────────
  // Build an allowlist of active LO/manager user IDs and names.
  // This filters out executives (Bill, Ray, Nikk), deactivated users
  // (Jessica Sherard etc.), and unknown legacy names.
  const allowedUserIds = new Set((activeLoUsers ?? []).map((u) => u.id as string));
  const allowedNamesNorm = new Set(
    (activeLoUsers ?? []).map((u) => (u.full_name as string ?? "").trim().toLowerCase())
  );

  const perLo = new Map<
    string,
    {
      name: string;
      active: number;
      stuck: number;
      closingThisWeek: number;
      mtdLoans: number;
      mtdVolumeCents: number;
    }
  >();

  for (const l of loanRows) {
    // Skip loans not assigned to an active LO/manager
    const loId = l.assigned_loan_officer_user_id;
    const loNameRaw = (l.assigned_loan_officer_name ?? "").trim();
    const loNameNorm = loNameRaw.toLowerCase();

    if (loId && !allowedUserIds.has(loId)) continue;
    if (!loId && (!loNameNorm || !allowedNamesNorm.has(loNameNorm))) continue;

    const key = loId ?? loNameRaw;
    const name = loNameRaw || "Unassigned";
    const row = perLo.get(key) ?? {
      name,
      active: 0,
      stuck: 0,
      closingThisWeek: 0,
      mtdLoans: 0,
      mtdVolumeCents: 0,
    };

    const isActive = l.current_stage && !["funded", "closed", "withdrawn", "denied"].includes(l.current_stage);
    if (isActive) row.active += 1;

    // Count stuck (we'll cross-reference annotated)
    const endAt = l.closed_at ?? l.funded_at;
    if (endAt && new Date(endAt) >= mStart) {
      row.mtdLoans += 1;
      row.mtdVolumeCents += l.loan_amount_cents ?? 0;
    }

    if (l.closing_date) {
      const cd = new Date(l.closing_date);
      if (cd >= today && cd <= sevenDaysOut) row.closingThisWeek += 1;
    }

    perLo.set(key, row);
  }

  // Add stuck count from the annotated list
  for (const l of stuckLoans) {
    const key = l.assigned_loan_officer_user_id ?? (l.assigned_loan_officer_name ?? "").trim();
    const row = perLo.get(key);
    if (row) row.stuck += 1;
  }

  // perLo only contains allowed users (allowlist above already filtered it)
  const loCards = [...perLo.values()]
    .sort((a, b) => b.active - a.active || b.mtdVolumeCents - a.mtdVolumeCents);

  // ── Top-level stats ───────────────────────────────────────────────────────
  const fundedMtd = loanRows.filter((l) => {
    const end = l.closed_at ?? l.funded_at;
    return end && new Date(end) >= mStart;
  });
  const mtdVolumeCents = sum(fundedMtd.map((l) => l.loan_amount_cents ?? null));
  const closingThisWeek = activeLoans.filter((l) => {
    if (!l.closing_date) return false;
    const cd = new Date(l.closing_date);
    return cd >= today && cd <= sevenDaysOut;
  }).length;
  const lpSyncedCount = activeLoans.filter((l) => !!l.lendingpad_loan_uuid).length;

  const teamLabel = teams.map((t) => t.name).join(", ") || "All teams";

  return (
    <div className="space-y-10 px-1 py-2">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Pipeline</h1>
        <p className="text-sm text-mutedForeground">{teamLabel}</p>
      </div>

      {/* ── Stat cards ────────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Active Loans" value={activeLoans.length} subtext={`${lpSyncedCount} in LP`} />
        <StatCard
          label="Stuck (SLA)"
          value={stuckLoans.length}
          accent={stuckLoans.length > 0}
        />
        <StatCard
          label="Overdue Closings"
          value={overdueClosings.length}
          accent={overdueClosings.length > 0}
        />
        <StatCard
          label="Closing This Week"
          value={closingThisWeek}
          subtext={atRiskClosings.length > 0 ? `${atRiskClosings.length} at risk` : undefined}
        />
        <StatCard label="MTD Volume" value={formatCurrency(mtdVolumeCents)} subtext={`${fundedMtd.length} loans`} />
      </div>

      {/* ── Section 1: What's Not Moving ──────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeading>What&apos;s Not Moving</SectionHeading>
        <TableWrapper>
          <thead>
            <tr>
              <Th>Borrower</Th>
              <Th>Stage</Th>
              <Th right>Days in Stage</Th>
              <Th right>Open Cond.</Th>
              <Th>Owner</Th>
              <Th right>Loan #</Th>
            </tr>
          </thead>
          <tbody>
            {stuckLoans.map((l) => (
              <tr key={l.id} className="transition-colors hover:bg-white/[0.02]">
                <Td>
                  <span className="font-medium text-foreground">{borrowerName(l)}</span>
                </Td>
                <Td>
                  <Badge variant="red">{stageLabel(l.current_stage)}</Badge>
                </Td>
                <Td right>
                  <DaysOverBadge days={l.daysInCurrentStage!} sla={l.slaMax!} />
                </Td>
                <Td right>
                  <ConditionPill count={l.openConditions} />
                </Td>
                <Td>
                  <span className="text-mutedForeground">{l.assigned_loan_officer_name ?? "—"}</span>
                </Td>
                <Td right mono>
                  {l.shape_record_id ?? "—"}
                </Td>
              </tr>
            ))}
            {stuckLoans.length === 0 && (
              <EmptyRow cols={6} message="No loans are past their SLA threshold." />
            )}
          </tbody>
        </TableWrapper>
      </section>

      {/* ── Section 2: What's Late ─────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeading>What&apos;s Late</SectionHeading>

        {/* 2a — Overdue closings */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-mutedForeground">
            Past closing date — not yet closed
          </p>
          <TableWrapper>
            <thead>
              <tr>
                <Th>Borrower</Th>
                <Th>Closing Date</Th>
                <Th right>How Late</Th>
                <Th right>Open Cond.</Th>
                <Th>Stage</Th>
                <Th>Owner</Th>
              </tr>
            </thead>
            <tbody>
              {overdueClosings.map((l) => (
                <tr key={l.id} className="transition-colors hover:bg-white/[0.02]">
                  <Td>
                    <span className="font-medium text-foreground">{borrowerName(l)}</span>
                  </Td>
                  <Td>
                    <span style={{ color: "#f87171" }}>{formatClosingDate(l.closing_date!)}</span>
                  </Td>
                  <Td right>
                    <OverdueBadge daysLate={l.daysLate} />
                  </Td>
                  <Td right>
                    <ConditionPill count={l.openConditions} />
                  </Td>
                  <Td>
                    <span className="text-mutedForeground">{stageLabel(l.current_stage)}</span>
                  </Td>
                  <Td>
                    <span className="text-mutedForeground">{l.assigned_loan_officer_name ?? "—"}</span>
                  </Td>
                </tr>
              ))}
              {overdueClosings.length === 0 && (
                <EmptyRow cols={6} message="No overdue closings." />
              )}
            </tbody>
          </TableWrapper>
        </div>

        {/* 2b — At-risk (closing this week with open conditions) */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-mutedForeground">
            Closing within 7 days — open conditions outstanding
          </p>
          <TableWrapper>
            <thead>
              <tr>
                <Th>Borrower</Th>
                <Th>Closing Date</Th>
                <Th right>Days Left</Th>
                <Th right>Open Cond.</Th>
                <Th>Stage</Th>
                <Th>Owner</Th>
              </tr>
            </thead>
            <tbody>
              {atRiskClosings.map((l) => (
                <tr key={l.id} className="transition-colors hover:bg-white/[0.02]">
                  <Td>
                    <span className="font-medium text-foreground">{borrowerName(l)}</span>
                  </Td>
                  <Td>
                    <span style={{ color: "#fbbf24" }}>{formatClosingDate(l.closing_date!)}</span>
                  </Td>
                  <Td right>
                    <DaysWarningBadge days={l.daysLeft} />
                  </Td>
                  <Td right>
                    <ConditionPill count={l.openConditions} />
                  </Td>
                  <Td>
                    <span className="text-mutedForeground">{stageLabel(l.current_stage)}</span>
                  </Td>
                  <Td>
                    <span className="text-mutedForeground">{l.assigned_loan_officer_name ?? "—"}</span>
                  </Td>
                </tr>
              ))}
              {atRiskClosings.length === 0 && (
                <EmptyRow cols={6} message="No at-risk closings this week." />
              )}
            </tbody>
          </TableWrapper>
        </div>
      </section>

      {/* ── Section 3: Who Has What ────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeading>Who Has What</SectionHeading>
        {loCards.length === 0 ? (
          <p className="text-sm text-mutedForeground">No active loan officers found.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {loCards.map((r) => (
              <LoCard key={r.name} {...r} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
