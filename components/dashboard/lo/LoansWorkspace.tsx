"use client";

import { formatShortDate, formatMoney, stateForRow, borrowerDisplayName, pipedDateForDisplay, approvedDateForDisplay, ctcDateForDisplay, creditDateForDisplay, closingDateForDisplay } from "@/lib/shape-views/lo-dashboard";
import type { PipelineLoanRow } from "@/lib/shape-views/lo-dashboard";
import { BorrowerAvatar } from "./BorrowerAvatar";

function SlaPill({ sla }: { sla: PipelineLoanRow["sla"] }) {
  const cls =
    sla === "ALERT"
      ? "text-[#c83c31] font-bold text-[11px]"
      : sla === "CAUTION"
        ? "text-[#b45309] font-bold text-[11px]"
        : "text-[#178452] font-bold text-[11px]";
  const dot =
    sla === "ALERT"
      ? "bg-[#c83c31]"
      : sla === "CAUTION"
        ? "bg-[#f59e0b]"
        : "bg-[#22c55e]";

  return (
    <span className={`${cls} inline-flex items-center gap-1.5`}>
      <i className={`inline-block h-2 w-2 flex-none rounded-full ${dot}`} />
      {sla === "ALERT" ? "Alert" : sla === "CAUTION" ? "Caution" : "OK"}
    </span>
  );
}

function MilestoneBadge({ label }: { label: string }) {
  const l = label.toLowerCase();
  let cls = "bg-[var(--lo-chip-bg)] text-[var(--lo-chip-text)]";
  if (l.includes("verification")) cls = "bg-[#dbeafe] text-[#1d4ed8]";
  else if (l.includes("package")) cls = "bg-[#f3e8ff] text-[#6b21a8]";
  else if (l.includes("validation") || l.includes("processing")) cls = "bg-[#fef3c7] text-[#92400e]";
  else if (l.includes("underwriting") || l.includes("uw")) cls = "bg-[#fff7ed] text-[#c2410c]";
  else if (l.includes("ctc") || l.includes("close")) cls = "bg-[#d1fae5] text-[#065f46]";
  return (
    <span className={`${cls} inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap`}>
      {label}
    </span>
  );
}

type Props = {
  loans: PipelineLoanRow[];
  alertsOnly: boolean;
  onSelectLoan: (loan: PipelineLoanRow) => void;
};

export function LoansWorkspace({ loans, alertsOnly, onSelectLoan }: Props) {
  const rows = alertsOnly ? loans.filter((loan) => loan.sla === "ALERT") : loans;
  const alertCount = loans.filter((l) => l.sla === "ALERT").length;
  const cautionCount = loans.filter((l) => l.sla === "CAUTION").length;

  return (
    <section className="lo-card lo-workspace-panel min-w-0 overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 flex-col gap-3 border-b border-[var(--lo-border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="lo-accent-text text-[10px] font-bold uppercase tracking-widest">LendingPad</p>
          <h2 className="lo-heading text-lg font-bold tracking-tight">Pipeline Loans</h2>
          <p className="lo-muted mt-0.5 text-[11px]">
            {rows.length} active loan{rows.length !== 1 ? "s" : ""}
            {alertCount > 0 ? ` · ${alertCount} alert${alertCount !== 1 ? "s" : ""}` : ""}
            {cautionCount > 0 ? ` · ${cautionCount} caution${cautionCount !== 1 ? "s" : ""}` : ""}
          </p>
        </div>
        <div className="lo-muted flex items-center gap-4 text-[11px] font-semibold">
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block h-2 w-2 rounded-full bg-[#22C55E]" /> OK
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block h-2 w-2 rounded-full bg-[#F59E0B]" /> Caution
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block h-2 w-2 rounded-full bg-[#EF4444]" /> Alert
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="lo-table-wrap">
        <table className="w-full border-collapse">
          <thead>
            <tr className="lo-table-header-row">
              <th className="lo-th w-[90px]">SLA</th>
              <th className="lo-th">Borrower</th>
              <th className="lo-th">Milestone</th>
              <th className="lo-th">Next Action</th>
              <th className="lo-th">Turntime</th>
              <th className="lo-th text-right">Amount</th>
              <th className="lo-th">State</th>
              <th className="lo-th">Type</th>
              <th className="lo-th">Purpose</th>
              <th className="lo-th">Credit</th>
              <th className="lo-th">Piped</th>
              <th className="lo-th">Approved</th>
              <th className="lo-th">Lock</th>
              <th className="lo-th">CTC</th>
              <th className="lo-th">Closing</th>
              <th className="lo-th">Fin. Cont.</th>
              <th className="lo-th">Apr. Cont.</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={17} className="lo-muted px-5 py-14 text-center text-sm">
                  No loans in the active pipeline.
                </td>
              </tr>
            ) : (
              rows.map((loan) => (
                <tr
                  key={loan.id}
                  className="lo-data-row cursor-pointer"
                  onClick={() => onSelectLoan(loan)}
                >
                  <td className="lo-td w-[90px]">
                    <SlaPill sla={loan.sla} />
                  </td>
                  <td className="lo-td">
                    <div className="flex items-center gap-2.5">
                      <BorrowerAvatar firstName={loan.borrower_first_name} lastName={loan.borrower_last_name} />
                      <span className="lo-name-text whitespace-nowrap">{borrowerDisplayName(loan)}</span>
                    </div>
                  </td>
                  <td className="lo-td">
                    <MilestoneBadge label={loan.milestoneLabel} />
                  </td>
                  <td className="lo-td lo-next-action-cell">
                    <span className="lo-muted text-[11px] italic">{loan.nextAction}</span>
                  </td>
                  <td className="lo-td">
                    <span className="lo-muted text-[11px] whitespace-nowrap">{loan.turntimeLabel}</span>
                  </td>
                  <td className="lo-td text-right">
                    <span className="lo-amount-text">{formatMoney(loan.loan_amount_cents)}</span>
                  </td>
                  <td className="lo-td">
                    <span className="lo-muted text-[12px]">{stateForRow(loan)}</span>
                  </td>
                  <td className="lo-td">
                    <span className="text-[12px]">{loan.loan_type ?? "—"}</span>
                  </td>
                  <td className="lo-td">
                    <span className="text-[12px]">{loan.loan_purpose ?? "—"}</span>
                  </td>
                  <td className="lo-td">
                    <span className="lo-muted text-[11px] whitespace-nowrap">{formatShortDate(creditDateForDisplay(loan))}</span>
                  </td>
                  <td className="lo-td">
                    <span className="lo-muted text-[11px] whitespace-nowrap">{formatShortDate(pipedDateForDisplay(loan))}</span>
                  </td>
                  <td className="lo-td">
                    <span className="lo-muted text-[11px] whitespace-nowrap">{formatShortDate(approvedDateForDisplay(loan))}</span>
                  </td>
                  <td className="lo-td">
                    <span className={`text-[12px] font-medium ${loan.lockDaysLabel === "Expired" ? "text-[#c83c31]" : loan.lockDaysLabel === "Unlocked" ? "lo-muted" : ""}`}>
                      {loan.lockDaysLabel}
                    </span>
                  </td>
                  <td className="lo-td">
                    <span className="lo-muted text-[11px] whitespace-nowrap">{formatShortDate(ctcDateForDisplay(loan))}</span>
                  </td>
                  <td className="lo-td">
                    <span className="lo-muted text-[11px] whitespace-nowrap">{formatShortDate(closingDateForDisplay(loan))}</span>
                  </td>
                  <td className="lo-td">
                    <span className="lo-muted text-[11px] whitespace-nowrap">{formatShortDate(loan.finance_contingency_date)}</span>
                  </td>
                  <td className="lo-td">
                    <span className="lo-muted text-[11px] whitespace-nowrap">{formatShortDate(loan.appraisal_contingency_date)}</span>
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
