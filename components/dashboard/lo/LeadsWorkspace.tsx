"use client";

import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/cn";
import {
  formatMoney,
  isGreenLead,
  isHotLead,
  isUncontactedLead,
  stateForRow,
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

function phasePillClass(phase: string) {
  if (phase.toLowerCase().includes("hot") || phase === "New Lead") return "bg-[#fde6e2] text-[#c83c31]";
  if (phase.toLowerCase().includes("green") || phase === "Advanced" || phase === "App Completed") return "bg-[#e2f6eb] text-[#178452]";
  if (phase.toLowerCase().includes("verification")) return "bg-[#e8f0fd] text-[#2d67b1]";
  if (phase.toLowerCase().includes("underwriting") || phase.toLowerCase().includes("uw")) return "bg-[#fff4d7] text-[#8a5a00]";
  if (phase.toLowerCase().includes("ctc") || phase.toLowerCase().includes("close")) return "bg-[#e2f6eb] text-[#0a5c3a]";
  return "bg-[var(--lo-chip-bg)] text-[var(--lo-chip-text)]";
}

function verificationPillClass(track: string) {
  if (track === "Verification A") return "bg-[#e8f0fd] text-[#2d67b1]";
  if (track === "Verification B") return "bg-[#f0e8fd] text-[#6b2db1]";
  return "bg-[var(--lo-chip-bg)] text-[var(--lo-muted)]";
}

function leadTypeAccent(lead: ClassifiedLead) {
  if (isHotLead(lead)) return "border-l-[3px] border-l-[#c83c31]";
  if (isGreenLead(lead)) return "border-l-[3px] border-l-[#22c55e]";
  if (isUncontactedLead(lead)) return "border-l-[3px] border-l-[var(--lo-border)]";
  return "border-l-[3px] border-l-transparent";
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
        <table className="min-w-[900px]">
          <thead>
            <tr>
              <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider">SLA</th>
              <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider">Last Change</th>
              <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider">Borrower</th>
              <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider">Phase</th>
              <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider">Verification</th>
              <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider">Amount</th>
              <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider">State</th>
              <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider">Source</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={8} className="lo-muted px-4 py-10 text-center text-sm">
                  No leads in this view.
                </td>
              </tr>
            ) : (
              visible.map((lead) => (
                <tr
                  key={lead.id}
                  className={`cursor-pointer ${leadTypeAccent(lead)}`}
                  onClick={() => onSelectLead(lead)}
                >
                  <td className="px-3 py-3">
                    {lead.leadSla ? (
                      <span
                        className={`${slaPillClass(lead.leadSla)} inline-flex min-w-[58px] justify-center rounded-md px-2 py-0.5 text-[10px] font-black tracking-wide`}
                      >
                        {lead.leadSla}
                      </span>
                    ) : (
                      <span className="lo-muted text-xs">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <span className="lo-muted text-[11px]">
                      {fmtRelative(lead.last_status_change_at ?? lead.shape_last_updated_at)}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[13px] font-bold text-[#2d67b1]">{borrowerName(lead)}</span>
                      {lead.hotTouchpointLabel && (
                        <span className="text-[10px] font-semibold text-[#c83c31]">{lead.hotTouchpointLabel}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`${phasePillClass(lead.leadPhaseLabel)} inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold`}>
                      {lead.leadPhaseLabel}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`${verificationPillClass(lead.verificationTrack)} inline-flex rounded-md px-2 py-0.5 text-[10px] font-semibold`}>
                      {lead.verificationTrack}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <span className="text-[12px] font-semibold">{formatMoney(lead.loan_amount_cents)}</span>
                  </td>
                  <td className="px-3 py-3">
                    <span className="lo-muted text-[12px]">{stateForRow(lead)}</span>
                  </td>
                  <td className="px-3 py-3">
                    <span className="lo-source-text text-[11px] font-semibold">{lead.source ?? "—"}</span>
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
