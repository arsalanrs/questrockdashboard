"use client";

import { differenceInCalendarDays } from "date-fns";

const SHAPE_BASE = "https://secure.setshape.com/prospects/";

export type AppraisalLoan = {
  id: string;
  shape_record_id: number | null;
  borrower_first_name: string | null;
  borrower_last_name: string | null;
  loan_type: string | null;
  loan_amount_cents: number | null;
  appraisal_ordered_at: string | null;
};

function borrowerName(l: AppraisalLoan) {
  return [l.borrower_first_name, l.borrower_last_name].filter(Boolean).join(" ") || "—";
}

function fmt$(cents: number | null) {
  if (!cents) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

export function AppraisalTracker({ loans }: { loans: AppraisalLoan[] }) {
  if (loans.length === 0) {
    return (
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Appraisal Tracker</h3>
        <div className="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-mutedForeground">
          No appraisals pending — all ordered appraisals have been received.
        </div>
      </section>
    );
  }

  const now = new Date();

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Appraisal Tracker</h3>
          <p className="text-xs text-mutedForeground">Appraisals ordered but not yet received.</p>
        </div>
        <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
          {loans.length} pending
        </span>
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr className="text-left text-xs text-mutedForeground">
              <th className="px-3 py-2">Borrower</th>
              <th className="px-3 py-2">Ordered</th>
              <th className="px-3 py-2">Days Waiting</th>
              <th className="px-3 py-2">Loan Type</th>
              <th className="px-3 py-2">Amount</th>
              <th className="px-3 py-2">Shape</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loans
              .sort((a, b) => {
                const da = a.appraisal_ordered_at ? new Date(a.appraisal_ordered_at).getTime() : 0;
                const db = b.appraisal_ordered_at ? new Date(b.appraisal_ordered_at).getTime() : 0;
                return da - db;
              })
              .map((l) => {
                const ordered = l.appraisal_ordered_at ? new Date(l.appraisal_ordered_at) : null;
                const days = ordered ? differenceInCalendarDays(now, ordered) : null;
                return (
                  <tr key={l.id} className="hover:bg-muted/40">
                    <td className="px-3 py-2 font-medium">{borrowerName(l)}</td>
                    <td className="px-3 py-2 text-xs text-mutedForeground">
                      {ordered ? ordered.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {days != null ? (
                        <span className={days > 10 ? "text-red-600 dark:text-red-400 font-semibold" : days > 5 ? "text-amber-600 dark:text-amber-400" : ""}>
                          {days}d
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-mutedForeground">{l.loan_type ?? "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt$(l.loan_amount_cents)}</td>
                    <td className="px-3 py-2">
                      {l.shape_record_id ? (
                        <a
                          href={`${SHAPE_BASE}${l.shape_record_id}/edit`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                        >
                          #{l.shape_record_id}
                        </a>
                      ) : "—"}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
