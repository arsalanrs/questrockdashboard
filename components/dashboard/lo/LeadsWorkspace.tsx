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
import { BorrowerAvatar } from "./BorrowerAvatar";
import type { LeadViewTab } from "./types";

function fmtRelative(iso: string | null | undefined) {
  if (!iso) return null;
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return null;
  }
}

function SlaPill({ sla }: { sla: ClassifiedLead["leadSla"] }) {
  if (!sla) return <span className="text-[var(--lo-muted)] text-sm">—</span>;
  const cls =
    sla === "ALERT"
      ? "text-[#c83c31] font-bold text-[11px] tracking-wide"
      : sla === "CAUTION"
        ? "text-[#b45309] font-bold text-[11px] tracking-wide"
        : "text-[#178452] font-bold text-[11px] tracking-wide";
  return <span className={cls}>{sla === "ALERT" ? "Alert" : sla === "CAUTION" ? "Caution" : "OK"}</span>;
}

function PhaseBadge({ label }: { label: string }) {
  let cls = "bg-[var(--lo-chip-bg)] text-[var(--lo-chip-text)]";
  const l = label.toLowerCase();
  if (l === "new lead" || l.includes("hot")) cls = "bg-[#fee2e2] text-[#c83c31]";
  else if (l === "app completed" || l === "advanced") cls = "bg-[#dcfce7] text-[#15803d]";
  else if (l.includes("verification")) cls = "bg-[#dbeafe] text-[#1d4ed8]";
  else if (l.includes("underwriting") || l.includes("uw")) cls = "bg-[#fef9c3] text-[#854d0e]";
  else if (l.includes("ctc") || l.includes("close")) cls = "bg-[#d1fae5] text-[#065f46]";
  else if (l.includes("package") || l.includes("validation")) cls = "bg-[#f3e8ff] text-[#6b21a8]";

  return (
    <span className={`${cls} inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap`}>
      {label}
    </span>
  );
}

function VerifBadge({ track }: { track: string }) {
  const cls =
    track === "Verification A"
      ? "bg-[#dbeafe] text-[#1e40af]"
      : track === "Verification B"
        ? "bg-[#ede9fe] text-[#5b21b6]"
        : "bg-[var(--lo-chip-bg)] text-[var(--lo-muted)]";
  return (
    <span className={`${cls} inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium whitespace-nowrap`}>
      {track}
    </span>
  );
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
    { key: "hot", label: "Hot 🔥", count: hot.length },
    { key: "green", label: "Green ✓", count: green.length },
    { key: "uncontacted", label: "Uncontacted", count: uncontacted.length },
  ];

  const sectionHint =
    activeTab === "hot"
      ? "New leads + past-client touchpoints"
      : activeTab === "green"
        ? "Advanced / app completed"
        : activeTab === "uncontacted"
          ? "Not Contacted status only"
          : "Shape CRM leads in your workspace";

  return (
    <section className="lo-card lo-workspace-panel min-w-0 overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 flex-col gap-3 border-b border-[var(--lo-border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="lo-accent-text text-[10px] font-bold uppercase tracking-widest">Shape CRM</p>
          <h2 className="lo-heading text-lg font-bold tracking-tight">Leads</h2>
          <p className="lo-muted mt-0.5 text-[11px]">{sectionHint} · {visible.length} records</p>
        </div>
        <div className="lo-segment-track inline-flex gap-1 rounded-xl p-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onTabChange(tab.key)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-all",
                activeTab === tab.key ? "lo-segment-active shadow-sm" : "lo-muted hover:opacity-80",
              )}
            >
              {tab.label}
              <span className={cn("ml-1.5 rounded-full px-1.5 py-0.5 text-[10px]",
                activeTab === tab.key ? "bg-white/20" : "bg-[var(--lo-chip-bg)]"
              )}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {activePhase !== "all" && (
        <div className="lo-phase-chip mx-5 mt-3 shrink-0 flex items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold">
          <span>Filtered by turntime phase</span>
          <button type="button" onClick={onClearPhase} className="lo-segment-active rounded-md px-2 py-1 text-xs">
            Clear
          </button>
        </div>
      )}

      {searchQuery && (
        <p className="lo-muted mx-5 mt-2 shrink-0 text-[11px]">Search: "{searchQuery}"</p>
      )}

      {/* Table */}
      <div className="lo-table-wrap">
        <table className="min-w-[860px] w-full border-collapse">
          <thead>
            <tr className="lo-table-header-row">
              <th className="lo-th w-[70px]">SLA</th>
              <th className="lo-th">Borrower</th>
              <th className="lo-th">Phase</th>
              <th className="lo-th">Verification</th>
              <th className="lo-th text-right">Amount</th>
              <th className="lo-th">State</th>
              <th className="lo-th">Source</th>
              <th className="lo-th">Last change</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={8} className="lo-muted px-5 py-14 text-center text-sm">
                  No leads in this view.
                </td>
              </tr>
            ) : (
              visible.map((lead) => {
                const accent = isHotLead(lead)
                  ? "border-l-[3px] border-l-[#c83c31]"
                  : isGreenLead(lead)
                    ? "border-l-[3px] border-l-[#22c55e]"
                    : "border-l-[3px] border-l-transparent";

                return (
                  <tr
                    key={lead.id}
                    className={`lo-data-row cursor-pointer ${accent}`}
                    onClick={() => onSelectLead(lead)}
                  >
                    <td className="lo-td w-[70px]">
                      <SlaPill sla={lead.leadSla} />
                    </td>
                    <td className="lo-td">
                      <div className="flex items-center gap-2.5">
                        <BorrowerAvatar firstName={lead.borrower_first_name} lastName={lead.borrower_last_name} />
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <span className="lo-name-text truncate">
                            {[lead.borrower_first_name, lead.borrower_last_name].filter(Boolean).join(" ") || "—"}
                          </span>
                          {lead.hotTouchpointLabel && (
                            <span className="text-[10px] font-semibold text-[#c83c31] leading-none">
                              {lead.hotTouchpointLabel}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="lo-td">
                      <PhaseBadge label={lead.leadPhaseLabel} />
                    </td>
                    <td className="lo-td">
                      <VerifBadge track={lead.verificationTrack} />
                    </td>
                    <td className="lo-td text-right">
                      <span className="lo-amount-text">{formatMoney(lead.loan_amount_cents)}</span>
                    </td>
                    <td className="lo-td">
                      <span className="lo-muted text-[12px]">{stateForRow(lead)}</span>
                    </td>
                    <td className="lo-td">
                      <span className="lo-source-text text-[11px] font-medium">{lead.source ?? "—"}</span>
                    </td>
                    <td className="lo-td">
                      <span className="lo-muted text-[11px]">
                        {fmtRelative(lead.last_status_change_at ?? lead.shape_last_updated_at) ?? "—"}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
