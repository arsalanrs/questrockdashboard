/**
 * Manager & Executive Monitor
 *
 * Exceptions-only command center — shows only what needs action right now.
 * Accessible to manager, executive, and admin roles.
 *
 * Five sections:
 *   1. Intraday SLA Alerts  — unassigned leads + no-first-touch violations
 *   2. EOD Zero-Touch       — visible after 3 PM ET — today's leads with zero touches
 *   3. SLA Red List         — all red loans sorted by staleness
 *   4. LO Accountability Grid — contact rate per LO today
 *   5. Open Escalations     — unresolved escalation notes
 */
import { notFound } from "next/navigation";
import { requireCurrentUser } from "@/lib/current-user";
import { canViewManagerDashboard } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SLA_BREACH_LABELS } from "@/lib/sla/compute";
import { evaluateIntradayRules } from "@/lib/sla/time-rules";
import { shapeLeadUrl } from "@/lib/shape-link";
import { EscalateButton, ResolveButton } from "@/components/monitor/EscalateButton";
import { Badge } from "@/components/Badge";
import { StatCard } from "@/components/StatCard";
import { etMidnightIso, etTodayDate } from "@/lib/date-utils";

export const revalidate = 30;

// ─── Helpers ────────────────────────────────────────────────────────────────

function bn(l: { borrower_first_name: string | null; borrower_last_name: string | null }) {
  return [l.borrower_first_name, l.borrower_last_name].filter(Boolean).join(" ") || "Unknown";
}

function nowET(): { hour: number; past3PM: boolean; past4PM: boolean } {
  const now = new Date();
  const str = now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false });
  const hour = parseInt(str, 10);
  return { hour, past3PM: hour >= 15, past4PM: hour >= 16 };
}

function hoursAgo(iso: string | null): number {
  if (!iso) return 0;
  return Math.round((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60));
}

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" });
}

function contactRateColor(pct: number): string {
  if (pct >= 75) return "#4ade80";
  if (pct >= 40) return "#fbbf24";
  return "#f87171";
}

// ─── Small UI atoms ──────────────────────────────────────────────────────────

function SectionHeading({ children, count, critical }: { children: React.ReactNode; count?: number; critical?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[13px] font-semibold uppercase tracking-widest text-mutedForeground">
        {children}
      </span>
      {count !== undefined && (
        <span
          className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold tabular-nums"
          style={{
            background: critical ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.08)",
            color: critical ? "#f87171" : "var(--muted-foreground)",
          }}
        >
          {count}
        </span>
      )}
      <div className="h-px flex-1" style={{ background: "rgba(255,255,255,0.06)" }} />
    </div>
  );
}

function TableWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl" style={{ border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)" }}>
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-mutedForeground" style={{ background: "rgba(255,255,255,0.03)" }}>
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`px-4 py-3 ${className ?? ""}`} style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
      {children}
    </td>
  );
}

function EmptyRow({ cols, msg }: { cols: number; msg: string }) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-6 text-center text-sm text-mutedForeground">{msg}</td>
    </tr>
  );
}

function ShapeLink({ shapeLeadId }: { shapeLeadId: number | null }) {
  const url = shapeLeadUrl(shapeLeadId);
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium transition-colors hover:opacity-80"
      style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8" }}
    >
      Shape ↗
    </a>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function MonitorPage() {
  const { appUser } = await requireCurrentUser();
  if (!canViewManagerDashboard(appUser.role)) notFound();

  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  const now = new Date();
  // ET midnight — correct "today" boundary for the business timezone
  const todayIso = etMidnightIso(now);
  // 48-hour lookback — catches unassigned leads from yesterday that are still unassigned today
  const fortyEightHoursAgoIso = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const et = nowET();

  // ── Parallel data fetches ──────────────────────────────────────────────────

  const [
    { data: slaRows },
    { data: activityRows },
    { data: todayLoans },
    { data: openEscalations },
  ] = await Promise.all([
    // SLA view — all non-green loans for this user's scope
    supabase
      .from("v_lead_sla_status")
      .select(
        "loan_id,shape_record_id,borrower_name,lo_name,source,status_raw,current_stage,sla_color,sla_breach_type,hours_since_last_activity,hours_since_created,touched_today,lead_created_at,assigned_loan_officer_user_id",
      )
      .in("sla_color", ["red", "yellow"])
      .order("hours_since_last_activity", { ascending: false }),

    // Daily activity summary for LO accountability grid
    admin.from("v_daily_activity_summary").select("lo_name,loans_touched_today,status_changes_today,notes_today,new_leads_today,last_activity_at"),

    // Intraday SLA scan window — last 48h so Rule 1 (unassigned_15min) catches
    // yesterday's new leads that are still unassigned today; Rules 2-4 are
    // self-gated to same-ET-day by evaluateIntradayRules()
    admin
      .from("loans")
      .select(
        "id,shape_record_id,shape_lead_id,borrower_first_name,borrower_last_name,borrower_phone,source,assigned_loan_officer_user_id,assigned_loan_officer_name,lead_created_at",
      )
      .gte("lead_created_at", fortyEightHoursAgoIso)
      .order("lead_created_at", { ascending: false })
      .limit(300),

    // Open escalations
    supabase
      .from("escalations")
      .select("id,loan_id,borrower_name,lo_name,note,shape_record_id,created_at,escalated_by")
      .is("resolved_at", null)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  // ── Today's touch counts (loan_id → touch_count) ──────────────────────────
  const { data: touchRows } = await admin
    .from("lead_touch_log")
    .select("loan_id,touch_count")
    .eq("touch_date", etTodayDate(now)); // YYYY-MM-DD in ET

  const touchMap = new Map<string, number>();
  for (const t of touchRows ?? []) {
    touchMap.set(t.loan_id as string, (t.touch_count as number) ?? 0);
  }

  // "New Leads Today" = only ET-today leads (todayIso boundary), not the 48h window
  const todayOnlyLoans = (todayLoans ?? []).filter((l) => (l.lead_created_at as string) >= todayIso);

  // ── Intraday SLA evaluation ───────────────────────────────────────────────
  type IntradayLead = {
    id: string;
    shape_record_id: number | null;
    shape_lead_id: number | null;
    borrower_name: string;
    borrower_phone: string | null;
    source: string | null;
    lo_name: string | null;
    lead_created_at: string;
    breach: import("@/lib/sla/time-rules").IntradayBreachType;
  };

  const intradayAlerts: IntradayLead[] = [];
  for (const l of todayLoans ?? []) {
    const breach = evaluateIntradayRules(
      {
        loan_id: l.id as string,
        borrower_name: bn(l as Parameters<typeof bn>[0]),
        lo_name: (l.assigned_loan_officer_name as string | null) ?? null,
        lead_created_at: l.lead_created_at as string | null,
        assigned_loan_officer_user_id: (l.assigned_loan_officer_user_id as string | null) ?? null,
        touches_today: touchMap.get(l.id as string) ?? 0,
      },
      now,
    );
    if (breach) {
      intradayAlerts.push({
        id: l.id as string,
        shape_record_id: (l.shape_record_id as number | null) ?? null,
        shape_lead_id: (l.shape_lead_id as number | null) ?? null,
        borrower_name: bn(l as Parameters<typeof bn>[0]),
        borrower_phone: (l.borrower_phone as string | null) ?? null,
        source: (l.source as string | null) ?? null,
        lo_name: (l.assigned_loan_officer_name as string | null) ?? null,
        lead_created_at: l.lead_created_at as string,
        breach,
      });
    }
  }

  // ── EOD Zero-Touch (visible after 3 PM ET) ────────────────────────────────
  const eodZeroTouch = et.past3PM
    ? todayOnlyLoans.filter((l) => (touchMap.get(l.id as string) ?? 0) === 0)
    : [];

  // ── SLA Red/Yellow split ──────────────────────────────────────────────────
  const redLoans = (slaRows ?? []).filter((r) => r.sla_color === "red");
  const yellowLoans = (slaRows ?? []).filter((r) => r.sla_color === "yellow");

  // ── LO Accountability Grid ────────────────────────────────────────────────
  type LoRow = {
    loName: string;
    newLeads: number;
    touched: number;
    statusChanges: number;
    notes: number;
    lastActivityAt: string | null;
    touchPct: number;
  };

  // Build a set of LO names who have new leads today for denominator (ET-today only)
  const loNewLeads = new Map<string, number>();
  for (const l of todayOnlyLoans) {
    const name = (l.assigned_loan_officer_name as string | null) ?? "Unassigned";
    loNewLeads.set(name, (loNewLeads.get(name) ?? 0) + 1);
  }

  const loRows: LoRow[] = (activityRows ?? []).map((r) => {
    const loName = (r.lo_name as string | null) ?? "Unknown";
    const newLeads = loNewLeads.get(loName) ?? 0;
    const touched = (r.loans_touched_today as number) ?? 0;
    const touchPct = newLeads > 0 ? Math.round((touched / newLeads) * 100) : 100;
    return {
      loName,
      newLeads,
      touched,
      statusChanges: (r.status_changes_today as number) ?? 0,
      notes: (r.notes_today as number) ?? 0,
      lastActivityAt: (r.last_activity_at as string | null) ?? null,
      touchPct,
    };
  });
  loRows.sort((a, b) => a.touchPct - b.touchPct); // lowest contact rate first

  // ── Summary counts ────────────────────────────────────────────────────────
  const totalNewToday = todayOnlyLoans.length;
  const totalUntouched = todayOnlyLoans.filter((l) => (touchMap.get(l.id as string) ?? 0) === 0).length;

  return (
    <div className="space-y-8">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Monitor</h1>
          <p className="mt-0.5 text-sm text-mutedForeground">
            Exceptions only — leads that need immediate attention
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-mutedForeground">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: "#4ade80", boxShadow: "0 0 6px #4ade80" }}
          />
          Live · refreshes every 30s
          <span className="ml-1" style={{ color: "rgba(255,255,255,0.3)" }}>
            {now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" })} ET
          </span>
        </div>
      </div>

      {/* ── Stat bar ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="New Leads Today"
          value={totalNewToday}
          subtext="received since midnight"
        />
        <StatCard
          label="Untouched Today"
          value={totalUntouched}
          subtext={`${totalNewToday > 0 ? Math.round((totalUntouched / totalNewToday) * 100) : 0}% of today's leads`}
          accent={totalUntouched > 0}
        />
        <StatCard
          label="SLA Critical"
          value={redLoans.length}
          subtext="red violations"
          accent={redLoans.length > 0}
        />
        <StatCard
          label="Intraday Alerts"
          value={intradayAlerts.length}
          subtext="time-of-day rule breaches"
          accent={intradayAlerts.length > 0}
        />
      </div>

      {/* ── Section 1: Intraday SLA Alerts ────────────────────────────────── */}
      <div className="space-y-3">
        <SectionHeading count={intradayAlerts.length} critical={intradayAlerts.length > 0}>
          Intraday SLA Alerts
        </SectionHeading>
        <TableWrapper>
          <thead>
            <tr>
              <Th>Borrower</Th>
              <Th>Phone</Th>
              <Th>Source</Th>
              <Th>LO</Th>
              <Th>Alert</Th>
              <Th>Created</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {intradayAlerts.length === 0 && (
              <EmptyRow cols={7} msg="No intraday SLA alerts — all new leads are on track." />
            )}
            {intradayAlerts.map((lead) => (
              <tr key={lead.id} className="hover:bg-white/[0.02] transition-colors">
                <Td>
                  <span className="font-medium text-foreground">{lead.borrower_name}</span>
                </Td>
                <Td>
                  {lead.borrower_phone ? (
                    <a href={`tel:${lead.borrower_phone}`} className="text-mutedForeground hover:text-foreground transition-colors">
                      {lead.borrower_phone}
                    </a>
                  ) : (
                    <span className="text-mutedForeground">—</span>
                  )}
                </Td>
                <Td><span className="text-mutedForeground">{lead.source ?? "—"}</span></Td>
                <Td>
                  <span className={lead.lo_name ? "text-foreground" : "text-mutedForeground italic"}>
                    {lead.lo_name ?? "Unassigned"}
                  </span>
                </Td>
                <Td>
                  <Badge variant={lead.breach === "unassigned_15min" || lead.breach === "zero_touch_eod" ? "red" : "orange"}>
                    {lead.breach === "unassigned_15min" && "Unassigned >15min"}
                    {lead.breach === "zero_touch_eod" && "Zero touch — EOD"}
                    {lead.breach === "no_first_touch_2h" && "No 1st touch in 2h"}
                    {lead.breach === "no_second_touch_2pm" && "No 2nd touch by 2 PM"}
                  </Badge>
                </Td>
                <Td>
                  <span className="text-mutedForeground text-xs">
                    {fmtTime(lead.lead_created_at)} ET
                  </span>
                </Td>
                <Td>
                  <div className="flex items-center gap-2 flex-wrap">
                    <ShapeLink shapeLeadId={lead.shape_lead_id ?? lead.shape_record_id} />
                    <EscalateButton loanId={lead.id} borrowerName={lead.borrower_name} />
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrapper>
      </div>

      {/* ── Section 2: EOD Zero-Touch ─────────────────────────────────────── */}
      {et.past3PM && (
        <div className="space-y-3">
          <SectionHeading count={eodZeroTouch.length} critical={eodZeroTouch.length > 0}>
            EOD Zero-Touch{" "}
            <span className="ml-1 text-[11px] normal-case font-normal opacity-60">
              — leads created today with zero activity
            </span>
          </SectionHeading>
          <TableWrapper>
            <thead>
              <tr>
                <Th>Borrower</Th>
                <Th>Phone</Th>
                <Th>Source</Th>
                <Th>Assigned LO</Th>
                <Th>Lead Created</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {eodZeroTouch.length === 0 && (
                <EmptyRow cols={6} msg="All today's leads have been touched." />
              )}
              {eodZeroTouch.map((l) => (
                <tr key={l.id as string} className="hover:bg-white/[0.02] transition-colors">
                  <Td>
                    <span className="font-medium text-foreground">{bn(l as Parameters<typeof bn>[0])}</span>
                  </Td>
                  <Td>
                    {(l.borrower_phone as string | null) ? (
                      <a href={`tel:${l.borrower_phone}`} className="text-mutedForeground hover:text-foreground">
                        {l.borrower_phone as string}
                      </a>
                    ) : <span className="text-mutedForeground">—</span>}
                  </Td>
                  <Td><span className="text-mutedForeground">{(l.source as string | null) ?? "—"}</span></Td>
                  <Td>
                    <span className={(l.assigned_loan_officer_name as string | null) ? "text-foreground" : "text-mutedForeground italic"}>
                      {(l.assigned_loan_officer_name as string | null) ?? "Unassigned"}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-xs text-mutedForeground">
                      {fmtTime(l.lead_created_at as string)} ET
                    </span>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2 flex-wrap">
                      <ShapeLink shapeLeadId={(l.shape_lead_id as number | null) ?? (l.shape_record_id as number | null)} />
                      <EscalateButton loanId={l.id as string} borrowerName={bn(l as Parameters<typeof bn>[0])} />
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrapper>
        </div>
      )}

      {/* ── Section 3: SLA Red List ────────────────────────────────────────── */}
      <div className="space-y-3">
        <SectionHeading count={redLoans.length} critical={redLoans.length > 0}>
          SLA Red List
        </SectionHeading>
        <TableWrapper>
          <thead>
            <tr>
              <Th>Borrower</Th>
              <Th>LO</Th>
              <Th>Status</Th>
              <Th>Breach</Th>
              <Th>Stale</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {redLoans.length === 0 && (
              <EmptyRow cols={6} msg="No red SLA violations right now." />
            )}
            {redLoans.map((r) => (
              <tr key={r.loan_id as string} className="hover:bg-white/[0.02] transition-colors">
                <Td>
                  <span className="font-medium text-foreground">{r.borrower_name as string}</span>
                </Td>
                <Td><span className="text-mutedForeground">{(r.lo_name as string | null) ?? "Unassigned"}</span></Td>
                <Td><span className="text-xs text-mutedForeground">{(r.status_raw as string | null) ?? "—"}</span></Td>
                <Td>
                  <Badge variant="red">
                    {(r.sla_breach_type as string | null)
                      ? SLA_BREACH_LABELS[r.sla_breach_type as Exclude<import("@/lib/sla/compute").SlaBreachType, null>] ?? r.sla_breach_type
                      : "SLA violation"}
                  </Badge>
                </Td>
                <Td>
                  <span className="tabular-nums text-sm font-semibold" style={{ color: "#f87171" }}>
                    {r.hours_since_last_activity as number}h
                  </span>
                </Td>
                <Td>
                  <div className="flex items-center gap-2 flex-wrap">
                    <ShapeLink shapeLeadId={r.shape_record_id as number | null} />
                    <EscalateButton loanId={r.loan_id as string} borrowerName={r.borrower_name as string} />
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrapper>
        {yellowLoans.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer list-none">
              <div className="flex items-center gap-2 text-xs text-mutedForeground hover:text-foreground transition-colors">
                <svg className="h-3.5 w-3.5 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
                {yellowLoans.length} yellow (at-risk) loans — click to expand
              </div>
            </summary>
            <div className="mt-2">
              <TableWrapper>
                <thead>
                  <tr>
                    <Th>Borrower</Th>
                    <Th>LO</Th>
                    <Th>Status</Th>
                    <Th>Breach</Th>
                    <Th>Stale</Th>
                    <Th>Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {yellowLoans.map((r) => (
                    <tr key={r.loan_id as string} className="hover:bg-white/[0.02] transition-colors">
                      <Td><span className="font-medium text-foreground">{r.borrower_name as string}</span></Td>
                      <Td><span className="text-mutedForeground">{(r.lo_name as string | null) ?? "Unassigned"}</span></Td>
                      <Td><span className="text-xs text-mutedForeground">{(r.status_raw as string | null) ?? "—"}</span></Td>
                      <Td>
                        <Badge variant="yellow">
                          {(r.sla_breach_type as string | null)
                            ? SLA_BREACH_LABELS[r.sla_breach_type as Exclude<import("@/lib/sla/compute").SlaBreachType, null>] ?? r.sla_breach_type
                            : "At risk"}
                        </Badge>
                      </Td>
                      <Td>
                        <span className="tabular-nums text-sm font-semibold" style={{ color: "#fbbf24" }}>
                          {r.hours_since_last_activity as number}h
                        </span>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-2 flex-wrap">
                          <ShapeLink shapeLeadId={r.shape_record_id as number | null} />
                          <EscalateButton loanId={r.loan_id as string} borrowerName={r.borrower_name as string} />
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrapper>
            </div>
          </details>
        )}
      </div>

      {/* ── Section 4: LO Accountability Grid ─────────────────────────────── */}
      <div className="space-y-3">
        <SectionHeading>LO Accountability — Today</SectionHeading>
        {loRows.length === 0 ? (
          <div className="rounded-xl p-6 text-center text-sm text-mutedForeground" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
            No activity recorded today yet.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {loRows.map((lo) => (
              <div
                key={lo.loName}
                className="rounded-xl p-4"
                style={{
                  background: "rgba(255,255,255,0.02)",
                  border: `1px solid ${lo.touchPct < 40 ? "rgba(239,68,68,0.25)" : lo.touchPct < 75 ? "rgba(245,158,11,0.2)" : "rgba(34,197,94,0.15)"}`,
                }}
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="text-sm font-semibold text-foreground leading-tight">{lo.loName}</div>
                  <div
                    className="text-lg font-bold tabular-nums"
                    style={{ color: contactRateColor(lo.touchPct) }}
                  >
                    {lo.touchPct}%
                  </div>
                </div>

                {/* Contact rate bar */}
                <div className="mb-3 h-1.5 w-full rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${Math.min(lo.touchPct, 100)}%`, background: contactRateColor(lo.touchPct) }}
                  />
                </div>

                <div className="grid grid-cols-3 gap-1 text-center">
                  <div>
                    <div className="text-sm font-bold tabular-nums text-foreground">{lo.newLeads}</div>
                    <div className="text-[10px] text-mutedForeground">New</div>
                  </div>
                  <div>
                    <div className="text-sm font-bold tabular-nums text-foreground">{lo.touched}</div>
                    <div className="text-[10px] text-mutedForeground">Touched</div>
                  </div>
                  <div>
                    <div className="text-sm font-bold tabular-nums text-foreground">{lo.notes}</div>
                    <div className="text-[10px] text-mutedForeground">Notes</div>
                  </div>
                </div>

                {lo.lastActivityAt && (
                  <div className="mt-2 text-[10px] text-mutedForeground">
                    Last active: {fmtTime(lo.lastActivityAt)} ET
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Section 5: Open Escalations ───────────────────────────────────── */}
      <div className="space-y-3">
        <SectionHeading count={(openEscalations ?? []).length} critical={(openEscalations ?? []).length > 0}>
          Open Escalations
        </SectionHeading>
        <TableWrapper>
          <thead>
            <tr>
              <Th>Borrower</Th>
              <Th>LO</Th>
              <Th>Note</Th>
              <Th>Logged</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {(openEscalations ?? []).length === 0 && (
              <EmptyRow cols={5} msg="No open escalations." />
            )}
            {(openEscalations ?? []).map((e) => (
              <tr key={e.id as string} className="hover:bg-white/[0.02] transition-colors">
                <Td>
                  <span className="font-medium text-foreground">{(e.borrower_name as string | null) ?? "—"}</span>
                </Td>
                <Td><span className="text-mutedForeground">{(e.lo_name as string | null) ?? "—"}</span></Td>
                <Td>
                  <span className="text-sm text-foreground">{e.note as string}</span>
                </Td>
                <Td>
                  <span className="text-xs text-mutedForeground">
                    {new Date(e.created_at as string).toLocaleString("en-US", {
                      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                      timeZone: "America/New_York",
                    })} ET
                  </span>
                </Td>
                <Td>
                  <div className="flex items-center gap-2 flex-wrap">
                    <ShapeLink shapeLeadId={e.shape_record_id as number | null} />
                    <ResolveButton escalationId={e.id as string} />
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrapper>
      </div>

      {/* ── Bottom padding ────────────────────────────────────────────────── */}
      <div className="h-8" />
    </div>
  );
}
