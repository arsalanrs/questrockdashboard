"use client";

import { borrowerDisplayName, formatMoney, formatShortDate, stateForRow } from "@/lib/shape-views/lo-dashboard";
import type { PipelineLoanRow } from "@/lib/shape-views/lo-dashboard";

function slaPillClass(sla: PipelineLoanRow["sla"]) {
  if (sla === "ALERT") return "bg-[#fde6e2] text-[#c83c31]";
  if (sla === "CAUTION") return "bg-[#fff4d7] text-[#8a5a00]";
  return "bg-[#e2f6eb] text-[#178452]";
}

type Props = {
  loans: PipelineLoanRow[];
  alertsOnly: boolean;
  onSelectLoan: (loan: PipelineLoanRow) => void;
};

export function LoansWorkspace({ loans, alertsOnly, onSelectLoan }: Props) {
  const rows = alertsOnly ? loans.filter((loan) => loan.sla === "ALERT") : loans;

  return (
    <section className="lo-card lo-workspace-panel min-w-0 p-4">
      <div className="mb-4 flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="lo-accent-text text-xs font-bold uppercase tracking-wide">LendingPad</p>
          <h2 className="lo-heading text-xl font-bold">LOANS</h2>
        </div>
        <div className="lo-muted flex flex-wrap gap-3 text-xs font-bold">
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5 rounded-full bg-[#22C55E]" /> OK
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5 rounded-full bg-[#F59E0B]" /> Caution
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5 rounded-full bg-[#FF4B4B]" /> Alert
          </span>
        </div>
      </div>

      <div className="mb-3 flex shrink-0 items-baseline justify-between border-b border-[var(--lo-border)] pb-2">
        <h3 className="lo-heading text-[13px] font-black uppercase">Hot Loans</h3>
        <span className="lo-muted text-xs">
          {alertsOnly ? "SLA alert pipeline" : "Entire active pipeline with SLA visibility"} · {rows.length} loans
        </span>
      </div>

      <div className="lo-table-wrap min-w-0 rounded-lg border border-[var(--lo-border)]">
        <table>
          <thead>
            <tr>
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase">SLA</th>
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase">Turntime</th>
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase">Borrower Name</th>
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase">Milestone</th>
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase">Next Action</th>
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase">Notes</th>
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase">State</th>
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase">Loan Amount</th>
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase">Loan Type</th>
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase">Loan Purpose</th>
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase">Credit Pulled</th>
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase">Piped</th>
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase">Approved</th>
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase">Lock Days</th>
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase">CTC</th>
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase">Closing Date</th>
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase">Finance Contingency</th>
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase">Appraisal Contingency</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={18} className="lo-muted px-4 py-10 text-center text-sm">
                  No loans in this view.
                </td>
              </tr>
            ) : (
              rows.map((loan) => (
                <tr key={loan.id} className="cursor-pointer" onClick={() => onSelectLoan(loan)}>
                  <td className="px-3">
                    <span
                      className={`${slaPillClass(loan.sla)} inline-flex min-w-[70px] justify-center rounded-full px-2 py-0.5 text-[11px] font-black`}
                    >
                      {loan.sla}
                    </span>
                  </td>
                  <td className="lo-muted px-3">{loan.turntimeLabel}</td>
                  <td className="px-3">
                    <button type="button" className="font-bold text-[#2d67b1] hover:underline">
                      {borrowerDisplayName(loan)}
                    </button>
                  </td>
                  <td className="px-3">{loan.milestoneLabel}</td>
                  <td className="lo-wrap px-3">{loan.nextAction}</td>
                  <td className="lo-wrap lo-muted px-3">{loan.notesPreview}</td>
                  <td className="px-3">{stateForRow(loan)}</td>
                  <td className="px-3">{formatMoney(loan.loan_amount_cents)}</td>
                  <td className="px-3">{loan.loan_type ?? "—"}</td>
                  <td className="px-3">{loan.loan_purpose ?? "—"}</td>
                  <td className="px-3">{formatShortDate(loan.credit_report_requested_at)}</td>
                  <td className="px-3">{formatShortDate(loan.conversion_date ?? loan.submitted_to_processing_at)}</td>
                  <td className="px-3">{formatShortDate(loan.uw_decision_at)}</td>
                  <td className="px-3">{loan.lockDaysLabel}</td>
                  <td className="px-3">{formatShortDate(loan.ctc_at)}</td>
                  <td className="px-3">{formatShortDate(loan.closing_date)}</td>
                  <td className="px-3">{formatShortDate(loan.finance_contingency_date)}</td>
                  <td className="px-3">{formatShortDate(loan.appraisal_contingency_date)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
