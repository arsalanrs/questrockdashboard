import { formatDistanceToNow } from "date-fns";
import { SourceBadge } from "@/components/SourceBadge";
import { shapeLeadUrl } from "@/lib/shape-link";
import { lendingPadLoanUrl } from "@/lib/lendingpad-link";
import { formatCurrency } from "@/lib/metrics";
import { getViewById } from "@/lib/shape-views";
import type { ShapeLoanRow } from "@/lib/shape-views/types";

function borrowerName(row: ShapeLoanRow) {
  return [row.borrower_first_name, row.borrower_last_name].filter(Boolean).join(" ") || "—";
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
  rows: ShapeLoanRow[];
  viewId: string;
  showLoColumn?: boolean;
};

export function ShapeViewTable({ rows, viewId, showLoColumn = false }: Props) {
  const view = getViewById(viewId);

  if (view?.deferred) {
    return (
      <div className="lo-note-panel px-4 py-8 text-center text-sm">
        <p className="lo-heading font-medium">{view.label}</p>
        <p className="lo-muted mt-2">{view.deferredReason ?? "Coming soon."}</p>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <table className="min-w-full">
        <thead>
          <tr>
            <th className="px-3 py-2 text-left text-[11px] font-bold uppercase">Borrower</th>
            <th className="px-3 py-2 text-left text-[11px] font-bold uppercase">Status</th>
            {showLoColumn ? (
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase">LO</th>
            ) : null}
            <th className="px-3 py-2 text-left text-[11px] font-bold uppercase">Source</th>
            <th className="px-3 py-2 text-left text-[11px] font-bold uppercase">Last Activity</th>
            <th className="px-3 py-2 text-right text-[11px] font-bold uppercase">Amount</th>
            <th className="px-3 py-2 text-right text-[11px] font-bold uppercase">Links</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={showLoColumn ? 7 : 6} className="lo-muted px-4 py-8 text-center text-sm">
                No records in this view (90-day window).
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const shapeUrl = shapeLeadUrl(row.shape_record_id);
              const lpUrl = lendingPadLoanUrl(row.lendingpad_loan_uuid);
              const lastAt =
                row.last_status_change_at ??
                row.shape_last_updated_at ??
                row.last_contacted_at ??
                row.lead_created_at;
              return (
                <tr key={row.id}>
                  <td className="lo-heading px-3 font-medium">{borrowerName(row)}</td>
                  <td className="px-3">
                    <div className="flex flex-col gap-0.5">
                      <span>{row.status_raw ?? "—"}</span>
                      {row.portal_status_raw && row.portal_status_raw !== row.status_raw ? (
                        <span className="lo-muted text-[11px]">POS: {row.portal_status_raw}</span>
                      ) : null}
                    </div>
                  </td>
                  {showLoColumn ? (
                    <td className="lo-muted px-3">
                      {row.assigned_loan_officer_name ?? <span className="italic opacity-70">Unassigned</span>}
                    </td>
                  ) : null}
                  <td className="px-3">
                    <SourceBadge source={row.source} />
                  </td>
                  <td className="lo-muted px-3 text-xs">{fmtRelative(lastAt)}</td>
                  <td className="lo-heading px-3 text-right font-mono text-xs tabular-nums">
                    {row.loan_amount_cents ? formatCurrency(row.loan_amount_cents) : "—"}
                  </td>
                  <td className="px-3 text-right">
                    <div className="flex justify-end gap-2">
                      {shapeUrl ? (
                        <a
                          href={shapeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold text-[#2d67b1] hover:underline"
                        >
                          Shape
                        </a>
                      ) : null}
                      {lpUrl ? (
                        <a
                          href={lpUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold text-[#087f7a] hover:underline"
                        >
                          LP
                        </a>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      {rows.length > 0 && view ? (
        <div className="lo-muted border-t border-[var(--lo-border)] px-3 py-2 text-[11px]">
          {rows.length} record{rows.length === 1 ? "" : "s"} · sorted by {view.sort.field.replace(/_/g, " ")}{" "}
          ({view.sort.dir})
        </div>
      ) : null}
    </div>
  );
}
