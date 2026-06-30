/**
 * Manager & Executive Monitor
 *
 * Exceptions-only command center — shows only what needs action right now.
 */
import { notFound } from "next/navigation";
import { requireCurrentUser } from "@/lib/current-user";
import { canViewManagerDashboard } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { evaluateIntradayRules } from "@/lib/sla/time-rules";
import { shapeLeadUrl } from "@/lib/shape-link";
import { EscalateButton, ResolveButton } from "@/components/monitor/EscalateButton";
import { MonitorLiveStrip } from "@/components/monitor/MonitorLiveStrip";
import { MonitorSlaPanel, type SlaListRow } from "@/components/monitor/MonitorSlaPanel";
import { MonitorLoGrid } from "@/components/monitor/MonitorLoGrid";
import { Badge } from "@/components/Badge";
import { etMidnightIso, etTodayDate } from "@/lib/date-utils";

export const revalidate = 30;

function bn(l: { borrower_first_name: string | null; borrower_last_name: string | null }) {
  return [l.borrower_first_name, l.borrower_last_name].filter(Boolean).join(" ") || "Unknown";
}

function nowET(): { hour: number; past3PM: boolean } {
  const now = new Date();
  const str = now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false });
  const hour = parseInt(str, 10);
  return { hour, past3PM: hour >= 15 };
}

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" });
}

function elapsedTimer(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}d ${m}h`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function avatarTone(breach: string): { bg: string; color: string } {
  if (breach === "unassigned_15min" || breach === "zero_touch_eod" || breach === "no_first_touch_2h") {
    return { bg: "var(--red-50, #fceeec)", color: "var(--red-700, #a33b2e)" };
  }
  return { bg: "var(--amber-50, #fcf3e3)", color: "var(--amber-700, #96631a)" };
}

function breachLabel(breach: string): string {
  if (breach === "unassigned_15min") return "Unassigned 15min+";
  if (breach === "zero_touch_eod") return "Zero touch — EOD";
  if (breach === "no_first_touch_2h") return "No first touch";
  if (breach === "no_second_touch_2pm") return "No 2nd touch by 2 PM";
  return "Approaching SLA";
}

function breachVariant(breach: string): "red" | "orange" {
  return breach === "unassigned_15min" || breach === "zero_touch_eod" || breach === "no_first_touch_2h"
    ? "red"
    : "orange";
}

function relativeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hrs = Math.round(ms / (1000 * 60 * 60));
  if (hrs < 1) return `${Math.max(1, Math.round(ms / 60000))}m ago`;
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

const AVATAR_COLORS = [
  { bg: "#FCEEEC", color: "#A33B2E" },
  { bg: "#FCF3E3", color: "#96631A" },
  { bg: "#E9F4ED", color: "#1F7A4D" },
];

export default async function MonitorPage() {
  const { appUser } = await requireCurrentUser();
  if (!canViewManagerDashboard(appUser.role)) notFound();

  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  const now = new Date();
  const todayIso = etMidnightIso(now);
  const fortyEightHoursAgoIso = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const et = nowET();

  const [
    { data: slaRows },
    { data: activityRows },
    { data: todayLoans },
    { data: openEscalations },
    { count: greenSlaCount },
  ] = await Promise.all([
    supabase
      .from("v_lead_sla_status")
      .select(
        "loan_id,shape_record_id,borrower_name,lo_name,source,status_raw,current_stage,sla_color,sla_breach_type,hours_since_last_activity,hours_since_created,touched_today,lead_created_at,assigned_loan_officer_user_id",
      )
      .in("sla_color", ["red", "yellow"])
      .order("hours_since_last_activity", { ascending: false }),

    admin.from("v_daily_activity_summary").select("lo_name,loans_touched_today,status_changes_today,notes_today,new_leads_today,last_activity_at"),

    admin
      .from("loans")
      .select(
        "id,shape_record_id,shape_lead_id,borrower_first_name,borrower_last_name,borrower_phone,source,assigned_loan_officer_user_id,assigned_loan_officer_name,lead_created_at",
      )
      .gte("lead_created_at", fortyEightHoursAgoIso)
      .order("lead_created_at", { ascending: false })
      .limit(300),

    supabase
      .from("escalations")
      .select("id,loan_id,borrower_name,lo_name,note,shape_record_id,created_at,escalated_by")
      .is("resolved_at", null)
      .order("created_at", { ascending: false })
      .limit(50),

    supabase
      .from("v_lead_sla_status")
      .select("*", { count: "exact", head: true })
      .eq("sla_color", "green"),
  ]);

  const { data: touchRows } = await admin
    .from("lead_touch_log")
    .select("loan_id,touch_count")
    .eq("touch_date", etTodayDate(now));

  const touchMap = new Map<string, number>();
  for (const t of touchRows ?? []) {
    touchMap.set(t.loan_id as string, (t.touch_count as number) ?? 0);
  }

  const todayOnlyLoans = (todayLoans ?? []).filter((l) => (l.lead_created_at as string) >= todayIso);

  type IntradayLead = {
    id: string;
    shape_record_id: number | null;
    shape_lead_id: number | null;
    borrower_name: string;
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
        source: (l.source as string | null) ?? null,
        lo_name: (l.assigned_loan_officer_name as string | null) ?? null,
        lead_created_at: l.lead_created_at as string,
        breach,
      });
    }
  }

  const eodZeroTouch = et.past3PM
    ? todayOnlyLoans.filter((l) => (touchMap.get(l.id as string) ?? 0) === 0)
    : [];

  const redLoans: SlaListRow[] = (slaRows ?? [])
    .filter((r) => r.sla_color === "red")
    .map((r) => ({
      loan_id: r.loan_id as string,
      borrower_name: (r.borrower_name as string) ?? "—",
      lo_name: (r.lo_name as string | null) ?? null,
      status_raw: (r.status_raw as string | null) ?? null,
      current_stage: (r.current_stage as string | null) ?? null,
      sla_breach_type: (r.sla_breach_type as string | null) ?? null,
      hours_since_last_activity: (r.hours_since_last_activity as number) ?? 0,
      shape_record_id: (r.shape_record_id as number | null) ?? null,
    }));

  const yellowLoans: SlaListRow[] = (slaRows ?? [])
    .filter((r) => r.sla_color === "yellow")
    .map((r) => ({
      loan_id: r.loan_id as string,
      borrower_name: (r.borrower_name as string) ?? "—",
      lo_name: (r.lo_name as string | null) ?? null,
      status_raw: (r.status_raw as string | null) ?? null,
      current_stage: (r.current_stage as string | null) ?? null,
      sla_breach_type: (r.sla_breach_type as string | null) ?? null,
      hours_since_last_activity: (r.hours_since_last_activity as number) ?? 0,
      shape_record_id: (r.shape_record_id as number | null) ?? null,
    }));

  const loNewLeads = new Map<string, number>();
  for (const l of todayOnlyLoans) {
    const name = (l.assigned_loan_officer_name as string | null) ?? "Unassigned";
    loNewLeads.set(name, (loNewLeads.get(name) ?? 0) + 1);
  }

  const loNameToUserId = new Map<string, string>();
  for (const l of todayOnlyLoans) {
    const name = (l.assigned_loan_officer_name as string | null) ?? "Unassigned";
    const uid = l.assigned_loan_officer_user_id as string | null;
    if (uid && !loNameToUserId.has(name)) loNameToUserId.set(name, uid);
  }

  const loGridRows = (activityRows ?? [])
    .map((r) => {
      const loName = (r.lo_name as string | null) ?? "Unknown";
      const newLeads = loNewLeads.get(loName) ?? 0;
      const touched = (r.loans_touched_today as number) ?? 0;
      const touchPct = newLeads > 0 ? Math.round((touched / newLeads) * 100) : 100;
      return {
        loName,
        loUserId: loNameToUserId.get(loName) ?? null,
        touchPct,
        touched,
        total: newLeads,
      };
    })
    .sort((a, b) => a.touchPct - b.touchPct);

  const totalNewToday = todayOnlyLoans.length;
  const totalUntouched = todayOnlyLoans.filter((l) => (touchMap.get(l.id as string) ?? 0) === 0).length;
  const floorStatus =
    redLoans.length > 5 || intradayAlerts.length > 3
      ? "elevated"
      : redLoans.length > 0 || intradayAlerts.length > 0
        ? "watch"
        : "normal";

  return (
    <div className="qr-dashboard-page mon-dashboard animate-fade-up">
      <MonitorLiveStrip />

      <div className="mon-page-head">
        <div>
          <div className="mon-eyebrow">
            <span className="mon-eyebrow-pulse" aria-hidden />
            Floor status: {floorStatus}
          </div>
          <h1 className="mon-page-title">Monitor</h1>
          <p className="mon-page-sub">Exceptions only — everything below needs eyes on it right now</p>
        </div>
      </div>

      <div className="mon-stat-row">
        <div className="mon-stat-card s-blue">
          <div className="mon-stat-top">
            <div className="mon-stat-icon" aria-hidden>✦</div>
            <div className="mon-stat-live"><span className="d" />LIVE</div>
          </div>
          <p className="mon-stat-label">New Leads Today</p>
          <p className="mon-stat-value">{totalNewToday}</p>
        </div>
        <div className="mon-stat-card s-amber">
          <div className="mon-stat-top">
            <div className="mon-stat-icon" aria-hidden>⏳</div>
            <div className="mon-stat-live"><span className="d" />LIVE</div>
          </div>
          <p className="mon-stat-label">Untouched Today</p>
          <p className="mon-stat-value">{totalUntouched}</p>
        </div>
        <div className={`mon-stat-card s-red${redLoans.length > 0 ? " critical" : ""}`}>
          <div className="mon-stat-top">
            <div className="mon-stat-icon" aria-hidden>🔥</div>
            <div className="mon-stat-live"><span className="d" />LIVE</div>
          </div>
          <p className="mon-stat-label">SLA Critical</p>
          <p className={`mon-stat-value${redLoans.length > 0 ? " danger" : ""}`}>{redLoans.length}</p>
        </div>
        <div className="mon-stat-card s-gold">
          <div className="mon-stat-top">
            <div className="mon-stat-icon" aria-hidden>🔔</div>
            <div className="mon-stat-live"><span className="d" />LIVE</div>
          </div>
          <p className="mon-stat-label">Intraday Alerts</p>
          <p className="mon-stat-value">{intradayAlerts.length}</p>
        </div>
      </div>

      <section className="mon-section alert-section">
        <div className="mon-section-head">
          <h2 className="mon-section-title">Intraday SLA Alerts</h2>
          <span className="mon-live-pill"><span className="d" />LIVE</span>
        </div>
        <table className="dt">
          <thead>
            <tr>
              <th>Borrower</th>
              <th>Violation</th>
              <th>Owner</th>
              <th className="r">Elapsed</th>
              <th className="r">Actions</th>
            </tr>
          </thead>
          <tbody>
            {intradayAlerts.length === 0 && (
              <tr>
                <td colSpan={5} className="lo-muted px-6 py-8 text-center text-sm">
                  No intraday SLA alerts — all new leads are on track.
                </td>
              </tr>
            )}
            {intradayAlerts.map((lead, i) => {
              const url = shapeLeadUrl(lead.shape_lead_id ?? lead.shape_record_id);
              const av = avatarTone(lead.breach);
              const critical = breachVariant(lead.breach) === "red";
              return (
                <tr key={lead.id} className={critical ? "row-critical" : undefined}>
                  <td>
                    <div className="mon-name-cell">
                      <div className="mon-avatar" style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length].bg, color: AVATAR_COLORS[i % AVATAR_COLORS.length].color }}>
                        {initials(lead.borrower_name)}
                      </div>
                      <div>
                        <div className="mon-name-main">{lead.borrower_name}</div>
                        <div className="mon-name-sub">{lead.source ?? "—"}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <Badge variant={breachVariant(lead.breach)}>{breachLabel(lead.breach)}</Badge>
                  </td>
                  <td className="lo-muted text-[12px]">{lead.lo_name ?? "—"}</td>
                  <td className={`r ${critical ? "mon-timer" : ""}`} style={!critical ? { color: "var(--amber-700)", fontFamily: "ui-monospace, monospace", fontWeight: 600 } : undefined}>
                    {elapsedTimer(lead.lead_created_at)}
                  </td>
                  <td className="r">
                    <div className="flex items-center justify-end gap-2">
                      {url && (
                        <a href={url} target="_blank" rel="noopener noreferrer" className="lo-link-chip shape text-[10px]">
                          Open ↗
                        </a>
                      )}
                      <EscalateButton loanId={lead.id} borrowerName={lead.borrower_name} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <div className="mon-grid-2">
        <MonitorSlaPanel redLoans={redLoans} yellowLoans={yellowLoans} greenCount={greenSlaCount ?? 0} />

        <div className="flex flex-col gap-5">
          {et.past3PM && (
            <section className="mon-section" style={{ marginBottom: 0 }}>
              <div className="mon-section-head">
                <h2 className="mon-section-title">EOD Zero-Touch</h2>
                <span className="mon-section-meta">After 3 PM ET</span>
              </div>
              <table className="dt">
                <thead>
                  <tr>
                    <th>Borrower</th>
                    <th>Owner</th>
                    <th className="r">Received</th>
                  </tr>
                </thead>
                <tbody>
                  {eodZeroTouch.length === 0 && (
                    <tr>
                      <td colSpan={3} className="lo-muted px-6 py-6 text-center text-sm">
                        All today&apos;s leads have been touched.
                      </td>
                    </tr>
                  )}
                  {eodZeroTouch.slice(0, 8).map((l) => (
                    <tr key={l.id as string}>
                      <td><span className="mon-name-main">{bn(l as Parameters<typeof bn>[0])}</span></td>
                      <td className="lo-muted text-[12px]">{(l.assigned_loan_officer_name as string | null) ?? "—"}</td>
                      <td className="r lo-muted" style={{ fontVariantNumeric: "tabular-nums" }}>
                        {fmtTime(l.lead_created_at as string)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <section className="mon-section" style={{ marginBottom: 0 }}>
            <div className="mon-section-head">
              <h2 className="mon-section-title">Open Escalations</h2>
              <span className="mon-section-meta">{(openEscalations ?? []).length} unresolved</span>
            </div>
            <div className="px-5 pb-4">
              {(openEscalations ?? []).length === 0 && (
                <p className="lo-muted py-6 text-center text-sm">No open escalations.</p>
              )}
              {(openEscalations ?? []).map((e) => (
                <div key={e.id as string} className="mon-escalation-row">
                  <div className="mon-esc-icon" aria-hidden>⚑</div>
                  <div className="flex-1">
                    <p className="mon-esc-title">{(e.borrower_name as string | null) ?? "—"}</p>
                    <span className="mon-esc-meta">
                      {(e.lo_name as string | null) ? `Raised for ${e.lo_name as string}` : "Unassigned"} · {relativeAgo(e.created_at as string)}
                    </span>
                    <div className="mon-esc-note">{e.note as string}</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {shapeLeadUrl(e.shape_record_id as number | null) && (
                        <a
                          href={shapeLeadUrl(e.shape_record_id as number | null)!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="lo-link-chip shape text-[10px]"
                        >
                          Shape ↗
                        </a>
                      )}
                      <ResolveButton escalationId={e.id as string} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <section className="mon-section">
        <div className="mon-section-head">
          <h2 className="mon-section-title">LO Accountability</h2>
          <span className="mon-section-meta">Contact % today</span>
        </div>
        <MonitorLoGrid rows={loGridRows} />
      </section>

      <div className="h-8" />
    </div>
  );
}
