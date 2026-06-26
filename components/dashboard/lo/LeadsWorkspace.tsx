"use client";

import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/cn";
import {
  formatMoney,
  isGreenLead,
  isHotLead,
  isUncontactedLead,
  phaseLabel,
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
    activeTab === "hot" ? hot : activeTab === "green" ? green : uncontacted;

  const tabs: Array<{ key: LeadViewTab; label: string; count: number }> = [
    { key: "hot", label: "Hot", count: hot.length },
    { key: "green", label: "Green", count: green.length },
    { key: "uncontacted", label: "Uncontacted", count: uncontacted.length },
  ];

  return (
    <section
      className="rounded-xl border p-4"
      style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)" }}
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[#8ee0d4]">Shape CRM</p>
          <h2 className="text-xl font-bold text-foreground">LEADS</h2>
        </div>
        <div className="inline-grid grid-cols-3 rounded-lg p-1" style={{ background: "rgba(255,255,255,0.06)" }}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onTabChange(tab.key)}
              className={cn(
                "rounded-md px-3 py-2 text-xs font-bold",
                activeTab === tab.key ? "bg-[#174c3e] text-white" : "text-muted-foreground",
              )}
            >
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>
      </div>

      {activePhase !== "all" ? (
        <div
          className="mb-4 flex items-center justify-between rounded-lg border px-3 py-2 text-sm font-bold text-[#8ee0d4]"
          style={{ borderColor: "rgba(23,132,82,0.25)", background: "rgba(23,132,82,0.12)" }}
        >
          <span>Showing leads in {phaseLabel(activePhase)}</span>
          <button type="button" onClick={onClearPhase} className="rounded-md bg-[#174c3e] px-2 py-1 text-xs text-white">
            Clear
          </button>
        </div>
      ) : null}

      <div className="mb-3 flex items-baseline justify-between border-b pb-2" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        <h3 className="text-[13px] font-black uppercase">
          {activeTab === "hot" ? "Hot Leads" : activeTab === "green" ? "Green Leads" : "Uncontacted Leads"}
        </h3>
        <span className="text-xs text-muted-foreground">
          {activeTab === "hot"
            ? "New leads and past clients due for touchpoints"
            : activeTab === "green"
              ? "Application activity ready to advance"
              : "Leads with no completed contact attempt yet"}
        </span>
      </div>

      {searchQuery ? (
        <p className="mb-3 text-xs text-muted-foreground">Filtered by search: “{searchQuery}”</p>
      ) : null}

      <div className="grid gap-2.5">
        {visible.length === 0 ? (
          <div className="rounded-lg border px-4 py-8 text-center text-sm text-muted-foreground" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
            No leads in this view.
          </div>
        ) : (
          visible.map((lead) => (
            <button
              key={lead.id}
              type="button"
              onClick={() => onSelectLead(lead)}
              className={cn(
                "grid w-full gap-3 rounded-lg border px-3 py-3 text-left transition hover:-translate-y-0.5 sm:grid-cols-[1fr_auto]",
                activeTab === "hot" && "border-l-4 border-l-[#c83c31]",
                activeTab === "green" && "border-l-4 border-l-[#087f7a]",
                activeTab === "uncontacted" && "border-l-4 border-l-[#f3b33d]",
              )}
              style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)" }}
            >
              <div>
                <h4 className="text-[15px] font-bold text-foreground">{borrowerName(lead)}</h4>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>{lead.displayStatus}</span>
                  <span>{formatMoney(lead.loan_amount_cents)}</span>
                  <span>{lead.source ?? "—"}</span>
                  <span>{phaseLabel(lead.leadPhase)}</span>
                  <span>{fmtRelative(lead.last_status_change_at ?? lead.shape_last_updated_at)}</span>
                </div>
              </div>
              <div className="self-center rounded-md px-2 py-1 text-xs font-extrabold text-[#8ee0d4]" style={{ background: "rgba(23,132,82,0.15)" }}>
                {lead.hotTouchpointLabel ?? lead.portal_status_raw ?? lead.status_raw ?? "Follow up"}
              </div>
            </button>
          ))
        )}
      </div>
    </section>
  );
}
