"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/Badge";

type ChecklistItem = {
  id: string;
  title: string;
  is_required: boolean;
  sort_order: number;
  status: "pending" | "received" | "waived" | "na";
  received_at: string | null;
  notes: string | null;
};

type Condition = {
  id: string;
  title: string;
  status: "open" | "cleared";
  cleared_at: string | null;
};

type Props = {
  loanId: string;
  loanType: string | null;
  loanPurpose: string | null;
  documentationType: string | null;
};

const STATUS_ORDER: Record<string, number> = {
  pending: 0,
  received: 1,
  waived: 2,
  na: 3,
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function LoanChecklist({ loanId, loanType }: Props) {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [checklistName, setChecklistName] = useState<string | null>(null);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [clRes, condRes] = await Promise.all([
        fetch(`/api/loans/${loanId}/checklist`),
        fetch(`/api/loans/${loanId}/conditions`),
      ]);

      if (clRes.ok) {
        const clData = await clRes.json();
        setItems(clData.checklist ?? []);
        setChecklistName(clData.checklistName ?? null);
      }
      if (condRes.ok) {
        const condData = await condRes.json();
        setConditions(condData.conditions ?? []);
      }
    } catch {
      /* network errors handled silently */
    } finally {
      setLoading(false);
    }
  }, [loanId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const sortedItems = [...items].sort(
    (a, b) => (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99),
  );

  const requiredCount = items.filter((i) => i.is_required).length;
  const receivedRequired = items.filter(
    (i) => i.is_required && (i.status === "received" || i.status === "waived"),
  ).length;
  const progressPct = requiredCount > 0 ? (receivedRequired / requiredCount) * 100 : 0;

  const openConditions = conditions.filter((c) => c.status === "open").length;
  const clearedConditions = conditions.filter((c) => c.status === "cleared").length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-mutedForeground">
        Loading checklist…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Section A: Document Checklist */}
      <section className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-5 py-4">
          <h3 className="text-base font-semibold text-cardForeground">
            Document Checklist
          </h3>
          {checklistName && (
            <p className="mt-0.5 text-xs text-mutedForeground">
              {checklistName}
              {loanType && <span className="ml-1">— {loanType}</span>}
            </p>
          )}
        </div>

        {items.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-mutedForeground">
            No checklist available for this loan type.
          </div>
        ) : (
          <>
            {/* Progress bar */}
            <div className="border-b border-border px-5 py-3">
              <div className="flex items-center justify-between text-xs text-mutedForeground">
                <span>
                  {receivedRequired} of {requiredCount} required docs received
                </span>
                <span>{Math.round(progressPct)}%</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>

            {/* Items list */}
            <ul className="divide-y divide-border">
              {sortedItems.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-3 px-5 py-3"
                >
                  <StatusIcon status={item.status} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm text-cardForeground">
                        {item.title}
                      </span>
                      {item.is_required && (
                        <Badge variant="default">Required</Badge>
                      )}
                    </div>
                    {item.received_at && (
                      <p className="mt-0.5 text-[11px] text-mutedForeground">
                        Received {formatDate(item.received_at)}
                      </p>
                    )}
                  </div>
                  <StatusBadge status={item.status} />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* Section B: UW Conditions */}
      <section className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-5 py-4">
          <h3 className="text-base font-semibold text-cardForeground">
            Underwriting Conditions
          </h3>
          <p className="mt-0.5 text-xs text-mutedForeground">
            {openConditions} open / {clearedConditions} cleared
          </p>
        </div>

        {conditions.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-mutedForeground">
            No conditions on file.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {conditions.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between px-5 py-3"
              >
                <span className="text-sm text-cardForeground">{c.title}</span>
                <Badge variant={c.status === "open" ? "red" : "green"}>
                  {c.status === "open" ? "Open" : "Cleared"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === "received") {
    return (
      <svg className="h-5 w-5 flex-shrink-0 text-emerald-500" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
      </svg>
    );
  }
  if (status === "waived") {
    return (
      <svg className="h-5 w-5 flex-shrink-0 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-11.25a.75.75 0 00-1.5 0v2.5h-2.5a.75.75 0 000 1.5h2.5v2.5a.75.75 0 001.5 0v-2.5h2.5a.75.75 0 000-1.5h-2.5v-2.5z" clipRule="evenodd" />
      </svg>
    );
  }
  return (
    <svg className="h-5 w-5 flex-shrink-0 text-mutedForeground/40" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm0-2a6 6 0 100-12 6 6 0 000 12z" clipRule="evenodd" />
    </svg>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "received":
      return <Badge variant="green">Received</Badge>;
    case "waived":
      return (
        <span className="inline-flex items-center rounded-full border border-transparent bg-blue-500 px-2 py-0.5 text-xs font-medium text-white">
          Waived
        </span>
      );
    case "na":
      return <Badge variant="muted">N/A</Badge>;
    default:
      return <Badge variant="default">Pending</Badge>;
  }
}
