"use client";

import { useMemo, useState } from "react";
import {
  buildLoSelectOptions,
  loanMatchesLoFilter,
  type LoSelectOption,
} from "@/lib/dashboard/lo-selector";
import type { LoDashboardRichData } from "@/lib/shape-views/fetch-lo-dashboard";
import {
  borrowerDisplayName,
  buildPipelineLoans,
  classifyLeads,
  type ClassifiedLead,
  type LoDashboardLoanRow,
  type PipelineLoanRow,
} from "@/lib/shape-views/lo-dashboard";
import type { TurntimePhaseKey } from "@/lib/shape-views/turntime-milestones";
import { LeadDetailSlideOver } from "./LeadDetailSlideOver";
import { LeadsWorkspace } from "./LeadsWorkspace";
import { LoanDetailSlideOver } from "./LoanDetailSlideOver";
import { LoansWorkspace } from "./LoansWorkspace";
import { SummaryStrip, type SummaryFocus } from "./SummaryStrip";
import { TurntimesSection } from "./TurntimesSection";
import type { LeadViewTab } from "./types";

type Props = {
  loans: LoDashboardLoanRow[];
  richByLoanId: Record<string, LoDashboardRichData>;
  loUsers: LoSelectOption[];
  pageTitle: string;
};

export function LoCommandCenter({ loans, richByLoanId, loUsers, pageTitle }: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [leadTab, setLeadTab] = useState<LeadViewTab>("all");
  const [activePhase, setActivePhase] = useState<TurntimePhaseKey | "all">("all");
  const [summaryFocus, setSummaryFocus] = useState<SummaryFocus>(null);
  const [selectedLead, setSelectedLead] = useState<ClassifiedLead | null>(null);
  const [selectedLoan, setSelectedLoan] = useState<PipelineLoanRow | null>(null);

  const loOptions = useMemo(() => buildLoSelectOptions(loUsers, loans), [loUsers, loans]);

  const filteredLoans = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return loans.filter((loan) => {
      if (!loanMatchesLoFilter(loan, ownerFilter, loOptions)) return false;
      if (!q) return true;
      const haystack = [
        borrowerDisplayName(loan),
        loan.borrower_email,
        loan.borrower_phone,
        loan.source,
        loan.status_raw,
        loan.property_state,
        loan.mailing_state,
        loan.assigned_loan_officer_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [loans, ownerFilter, loOptions, searchQuery]);

  const classified = useMemo(() => classifyLeads(filteredLoans), [filteredLoans]);
  const pipelineLoans = useMemo(() => buildPipelineLoans(filteredLoans), [filteredLoans]);
  const alertCount = pipelineLoans.filter((loan) => loan.sla === "ALERT").length;

  const alertsOnly = summaryFocus === "alerts";

  function handleSummaryFocus(focus: SummaryFocus) {
    setSummaryFocus(focus);
    if (focus === "hotLeads") setLeadTab("hot");
    if (focus === "greenLeads") setLeadTab("green");
  }

  function handlePhaseClick(phase: TurntimePhaseKey) {
    setActivePhase((prev) => (prev === phase ? "all" : phase));
    setSummaryFocus(null);
  }

  return (
    <div className="flex min-w-0 flex-col gap-5 animate-fade-up">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="lo-accent-text text-xs font-bold uppercase tracking-wide">Loan Officer Dashboard</p>
          <h1 className="lo-heading text-2xl font-semibold tracking-tight">{pageTitle}</h1>
          <p className="lo-muted mt-1 text-[13px]">
            Daily command center · {filteredLoans.length} records · Shape leads + LendingPad pipeline
          </p>
        </div>
        <div className="flex w-full min-w-0 flex-col gap-2 sm:max-w-xl sm:flex-row">
          <label className="lo-input flex h-11 flex-1 items-center gap-2 rounded-lg px-3">
            <span aria-hidden className="lo-muted">⌕</span>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSummaryFocus(null);
              }}
              placeholder="Search borrower, lead, state"
              className="w-full bg-transparent text-sm outline-none"
            />
          </label>
          <select
            value={ownerFilter}
            onChange={(e) => {
              setOwnerFilter(e.target.value);
              setSummaryFocus(null);
            }}
            className="lo-input h-11 rounded-lg px-3 text-sm"
          >
            <option value="all">All loan officers</option>
            {loOptions.map((user) => (
              <option key={user.id} value={user.id}>
                {user.full_name ?? user.id}
              </option>
            ))}
          </select>
        </div>
      </div>

      <TurntimesSection activePhase={activePhase} onPhaseClick={handlePhaseClick} />

      <SummaryStrip
        hotCount={classified.hot.length}
        greenCount={classified.green.length}
        pipelineCount={pipelineLoans.length}
        alertCount={alertCount}
        activeFocus={summaryFocus}
        onFocus={handleSummaryFocus}
      />

      <div className="grid min-w-0 gap-5">
        <LeadsWorkspace
          leads={classified.all}
          activeTab={leadTab}
          onTabChange={setLeadTab}
          activePhase={activePhase}
          onClearPhase={() => setActivePhase("all")}
          onSelectLead={(lead) => {
            setSelectedLead(lead);
            setSelectedLoan(null);
          }}
          searchQuery={searchQuery}
        />

        <LoansWorkspace
          loans={pipelineLoans}
          alertsOnly={alertsOnly}
          onSelectLoan={(loan) => {
            setSelectedLoan(loan);
            setSelectedLead(null);
          }}
        />
      </div>

      <LeadDetailSlideOver
        lead={selectedLead}
        open={Boolean(selectedLead)}
        onClose={() => setSelectedLead(null)}
      />

      <LoanDetailSlideOver
        loan={selectedLoan}
        rich={selectedLoan ? richByLoanId[selectedLoan.id] : null}
        open={Boolean(selectedLoan)}
        onClose={() => setSelectedLoan(null)}
      />
    </div>
  );
}
