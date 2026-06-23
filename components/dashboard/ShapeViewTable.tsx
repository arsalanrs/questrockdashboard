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
      <div className="rounded-xl border border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
        <p className="font-medium text-foreground">{view.label}</p>
        <p className="mt-2">{view.deferredReason ?? "Coming soon."}</p>
      </div>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{
        border: "1px solid rgba(255,255,255,0.07)",
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.03)" }}>
              <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Borrower
              </th>
              <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Status
              </th>
              {showLoColumn && (
                <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  LO
                </th>
              )}
              <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Source
              </th>
              <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Last Activity
              </th>
              <th className="px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Amount
              </th>
              <th className="px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Links
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={showLoColumn ? 7 : 6}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
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
                  <tr key={row.id} style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                    <td className="px-4 py-3 font-medium">{borrowerName(row)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5">
                        <span>{row.status_raw ?? "—"}</span>
                        {row.portal_status_raw && row.portal_status_raw !== row.status_raw && (
                          <span className="text-[11px] text-muted-foreground">
                            POS: {row.portal_status_raw}
                          </span>
                        )}
                      </div>
                    </td>
                    {showLoColumn && (
                      <td className="px-4 py-3 text-muted-foreground">
                        {row.assigned_loan_officer_name ?? (
                          <span className="italic opacity-70">Unassigned</span>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <SourceBadge source={row.source} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{fmtRelative(lastAt)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                      {row.loan_amount_cents ? formatCurrency(row.loan_amount_cents) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        {shapeUrl && (
                          <a
                            href={shapeUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-400 hover:underline"
                          >
                            Shape
                          </a>
                        )}
                        {lpUrl && (
                          <a
                            href={lpUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-emerald-400 hover:underline"
                          >
                            LP
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {rows.length > 0 && view && (
        <div className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          {rows.length} record{rows.length === 1 ? "" : "s"} · sorted by{" "}
          {view.sort.field.replace(/_/g, " ")} ({view.sort.dir})
        </div>
      )}
    </div>
  );
}
