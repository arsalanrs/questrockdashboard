"use client";

import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/cn";
import {
  formatMoney,
  isGreenLead,
  isHotLead,
  isUncontactedLead,
} from "@/lib/shape-views/lo-dashboard";
import type { ClassifiedLead } from "@/lib/shape-views/lo-dashboard";
import type { TurntimePhaseKey } from "@/lib/shape-views/turntime-milestones";
import type { LeadViewTab } from "./types";

function borrowerName(lead: ClassifiedLead) {
  return [lead.borrower_first_name, lead.borrower_last_name].filter(Boolean).join(" ") || "—";
}

function fmtRelative(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return "—";
  }
}

function slaPillClass(sla: ClassifiedLead["leadSla"]) {
  if (sla === "ALERT") return "bg-[#fde6e2] text-[#c83c31]";
  if (sla === "CAUTION") return "bg-[#fff4d7] text-[#8a5a00]";
  if (sla === "OK") return "bg-[#e2f6eb] text-[#178452]";
  return "bg-transparent text-[var(--lo-muted)]";
}

type Props = {
  leads: ClassifiedLead[];
  activeTab: LeadViewTab;
  onTabChange: (tab: LeadViewTab) => void;
  activePhase: TurntimePhaseKey | "all";
  onClearPhase: () => void;
  onSelectLead: (lead: ClassifiedLead) => void;
  searchQuery: string;
};

export function LeadsWorkspace({
  leads,
  activeTab,
  onTabChange,
  activePhase,
  onClearPhase,
  onSelectLead,
  searchQuery,
}: Props) {
  const phaseFiltered =
    activePhase === "all" ? leads : leads.filter((lead) => lead.leadPhase === activePhase);

  const hot = phaseFiltered.filter((l) => isHotLead(l));
  const green = phaseFiltered.filter((l) => isGreenLead(l));
  const uncontacted = phaseFiltered.filter((l) => isUncontactedLead(l));

  const visible =
    activeTab === "all"
      ? phaseFiltered
      : activeTab === "hot"
        ? hot
        : activeTab === "green"
          ? green
          : uncontacted;

  const tabs: Array<{ key: LeadViewTab; label: string; count: number }> = [
    { key: "all", label: "All", count: phaseFiltered.length },
    { key: "hot", label: "Hot", count: hot.length },
    { key: "green", label: "Green", count: green.length },
    { key: "uncontacted", label: "Uncontacted", count: uncontacted.length },
  ];

  const sectionTitle =
    activeTab === "all"
      ? "All Leads"
      : activeTab === "hot"
        ? "Hot Leads"
        : activeTab === "green"
          ? "Green Leads"
          : "Uncontacted Leads";

  const sectionHint =
    activeTab === "all"
      ? "Shape CRM leads in your workspace"
      : activeTab === "hot"
        ? "New leads + past-client touchpoints"
        : activeTab === "green"
          ? "Advanced / app completed — advance to verification"
          : "Not Contacted status only";

  return (
    <section className="lo-card lo-workspace-panel min-w-0 p-4">
      <div className="mb-4 flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="lo-accent-text text-xs font-bold uppercase tracking-wide">Shape CRM</p>
          <h2 className="lo-heading text-xl font-bold">LEADS</h2>
        </div>
        <div className="lo-segment-track inline-grid grid-cols-2 gap-1 rounded-lg p-1 sm:grid-cols-4">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onTabChange(tab.key)}
              className={cn(
                "rounded-md px-3 py-2 text-xs font-bold",
                activeTab === tab.key ? "lo-segment-active" : "lo-muted",
              )}
            >
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>
      </div>

      {activePhase !== "all" ? (
        <div className="lo-phase-chip mb-4 flex shrink-0 items-center justify-between rounded-lg px-3 py-2 text-sm font-bold">
          <span>Filtered by turntime phase</span>
          <button type="button" onClick={onClearPhase} className="lo-segment-active rounded-md px-2 py-1 text-xs">
            Clear
          </button>
        </div>
      ) : null}

      <div className="mb-3 flex shrink-0 items-baseline justify-between border-b border-[var(--lo-border)] pb-2">
        <h3 className="lo-heading text-[13px] font-black uppercase">{sectionTitle}</h3>
        <span className="lo-muted text-xs">
          {sectionHint} · {visible.length} leads
        </span>
      </div>

      {searchQuery ? (
        <p className="lo-muted mb-3 shrink-0 text-xs">Filtered by search: “{searchQuery}”</p>
      ) : null}

      <div className="lo-table-wrap min-w-0 rounded-lg border border-[var(--lo-border)]">
        <table className="min-w-[1040px]">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase">SLA</th>
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase">Borrower</th>
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase">Status</th>
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase">Phase</th>
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase">Amount</th>
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase">Source</th>
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase">Verification</th>
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase">Last Change</th>
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase">Trigger</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={9} className="lo-muted px-4 py-10 text-center text-sm">
                  No leads in this view.
                </td>
              </tr>
            ) : (
              visible.map((lead) => (
                <tr key={lead.id} className="cursor-pointer" onClick={() => onSelectLead(lead)}>
                  <td className="px-3">
                    {lead.leadSla ? (
                      <span
                        className={`${slaPillClass(lead.leadSla)} inline-flex min-w-[70px] justify-center rounded-full px-2 py-0.5 text-[11px] font-black`}
                      >
                        {lead.leadSla}
                      </span>
                    ) : (
                      <span className="lo-muted text-xs">—</span>
                    )}
                  </td>
                  <td className="px-3">
                    <span className="font-bold text-[#2d67b1]">{borrowerName(lead)}</span>
                  </td>
                  <td className="px-3">{lead.displayStatus}</td>
                  <td className="lo-muted px-3">{lead.leadPhaseLabel}</td>
                  <td className="px-3">{formatMoney(lead.loan_amount_cents)}</td>
                  <td className="lo-muted px-3">{lead.source ?? "—"}</td>
                  <td className="lo-muted px-3">{lead.verificationTrack}</td>
                  <td className="lo-muted px-3">
                    {fmtRelative(lead.last_status_change_at ?? lead.shape_last_updated_at)}
                  </td>
                  <td className="lo-wrap lo-muted px-3">
                    {lead.hotTouchpointLabel ?? lead.portal_status_raw ?? lead.status_raw ?? "Follow up"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
