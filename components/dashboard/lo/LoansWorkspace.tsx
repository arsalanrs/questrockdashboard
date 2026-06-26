"use client";

import { borrowerDisplayName, formatMoney, formatShortDate, stateForRow } from "@/lib/shape-views/lo-dashboard";
import type { PipelineLoanRow } from "@/lib/shape-views/lo-dashboard";

function slaPillClass(sla: PipelineLoanRow["sla"]) {
  if (sla === "ALERT") return "pill-red";
  if (sla === "CAUTION") return "pill-amber";
  return "pill-green";
}

type Props = {
  loans: PipelineLoanRow[];
  alertsOnly: boolean;
  onSelectLoan: (loan: PipelineLoanRow) => void;
};

export function LoansWorkspace({ loans, alertsOnly, onSelectLoan }: Props) {
  const rows = alertsOnly ? loans.filter((loan) => loan.sla === "ALERT") : loans;

  return (
    <section
      className="rounded-xl border p-4"
      style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)" }}
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[#8ee0d4]">LendingPad</p>
          <h2 className="text-xl font-bold text-foreground">LOANS</h2>
        </div>
        <div className="flex flex-wrap gap-3 text-xs font-bold text-muted-foreground">
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

      <div className="mb-3 flex items-baseline justify-between border-b pb-2" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        <h3 className="text-[13px] font-black uppercase">Hot Loans</h3>
        <span className="text-xs text-muted-foreground">
          {alertsOnly ? "SLA alert pipeline" : "Entire active pipeline with SLA visibility"} · {rows.length} loans
        </span>
      </div>

      <div className="overflow-auto rounded-lg border" style={{ borderColor: "rgba(255,255,255,0.08)", maxHeight: "calc(100vh - 280px)" }}>
        <table className="dt min-w-[1800px]">
          <thead>
            <tr>
              <th>SLA</th>
              <th>Turntime</th>
              <th>Borrower Name</th>
              <th>Milestone</th>
              <th>Next Action</th>
              <th>Notes</th>
              <th>State</th>
              <th>Loan Amount</th>
              <th>Loan Type</th>
              <th>Loan Purpose</th>
              <th>Credit Pulled</th>
              <th>Piped</th>
              <th>Approved</th>
              <th>Lock Days</th>
              <th>CTC</th>
              <th>Closing Date</th>
              <th>Finance Contingency</th>
              <th>Appraisal Contingency</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={18} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No loans in this view.
                </td>
              </tr>
            ) : (
              rows.map((loan) => (
                <tr key={loan.id} className="cursor-pointer" onClick={() => onSelectLoan(loan)}>
                  <td>
                    <span className={`${slaPillClass(loan.sla)} inline-flex min-w-[70px] justify-center rounded-full px-2 py-1 text-xs font-black`}>
                      {loan.sla}
                    </span>
                  </td>
                  <td className="text-xs text-muted-foreground">{loan.turntimeLabel}</td>
                  <td>
                    <button type="button" className="font-bold text-[#60A5FA] hover:underline">
                      {borrowerDisplayName(loan)}
                    </button>
                  </td>
                  <td>{loan.milestoneLabel}</td>
                  <td className="max-w-[220px] whitespace-normal text-xs">{loan.nextAction}</td>
                  <td className="max-w-[220px] whitespace-normal text-xs text-muted-foreground">{loan.notesPreview}</td>
                  <td>{stateForRow(loan)}</td>
                  <td>{formatMoney(loan.loan_amount_cents)}</td>
                  <td>{loan.loan_type ?? "—"}</td>
                  <td>{loan.loan_purpose ?? "—"}</td>
                  <td>{formatShortDate(loan.credit_report_requested_at)}</td>
                  <td>{formatShortDate(loan.conversion_date ?? loan.submitted_to_processing_at)}</td>
                  <td>{formatShortDate(loan.uw_decision_at)}</td>
                  <td>{loan.lockDaysLabel}</td>
                  <td>{formatShortDate(loan.ctc_at)}</td>
                  <td>{formatShortDate(loan.closing_date)}</td>
                  <td>{formatShortDate(loan.finance_contingency_date)}</td>
                  <td>{formatShortDate(loan.appraisal_contingency_date)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
