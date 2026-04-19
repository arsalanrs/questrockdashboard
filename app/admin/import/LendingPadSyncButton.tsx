"use client";

import { useState } from "react";
import { runLendingPadSyncReturn } from "./actions";

type SyncState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "success";
      loansUpserted: number;
      loansConsidered: number;
      sources: Array<{ kind: string; pages: number; loansUpserted: number }>;
      loanErrors: string[];
      conditionsWritten: number;
      conditionsLoansSynced: number;
      conditionErrors: string[];
    }
  | { status: "error"; message: string };

export function LendingPadSyncButton() {
  const [state, setState] = useState<SyncState>({ status: "idle" });

  async function handleClick() {
    setState({ status: "loading" });
    try {
      const out = await runLendingPadSyncReturn();
      if (out.ok) {
        setState({
          status: "success",
          loansUpserted: out.loans.loansUpserted,
          loansConsidered: out.loans.loansConsidered,
          sources: out.loans.sources.map((s) => ({
            kind: s.kind,
            pages: s.pages,
            loansUpserted: s.loansUpserted,
          })),
          loanErrors: out.loans.errors,
          conditionsWritten: out.conditions.conditionsWritten,
          conditionsLoansSynced: out.conditions.loansSynced,
          conditionErrors: out.conditions.errors,
        });
      } else {
        setState({ status: "error", message: out.error });
      }
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Sync failed",
      });
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      <button
        type="button"
        onClick={handleClick}
        disabled={state.status === "loading"}
        className="inline-flex w-fit items-center rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
      >
        {state.status === "loading" ? "Syncing LendingPad…" : "Sync LendingPad now"}
      </button>
      {state.status === "success" && (
        <div className="rounded-md border border-green-600/50 bg-green-50 px-3 py-2 text-sm dark:bg-green-950/30">
          <p>
            <strong>Loans:</strong> {state.loansUpserted} upserted ({state.loansConsidered} considered from LP).
          </p>
          {state.sources.length > 0 ? (
            <ul className="mt-2 list-inside list-disc text-mutedForeground">
              {state.sources.map((s, i) => (
                <li key={i}>
                  {s.kind}: {s.pages} pages, {s.loansUpserted} loans
                </li>
              ))}
            </ul>
          ) : null}
          {state.loanErrors.length > 0 ? (
            <p className="mt-2 text-amber-700 dark:text-amber-400">
              Loan sync warnings: {state.loanErrors.slice(0, 5).join(" · ")}
              {state.loanErrors.length > 5 ? "…" : ""}
            </p>
          ) : null}
          <p className="mt-2">
            <strong>Conditions:</strong> {state.conditionsWritten} rows for {state.conditionsLoansSynced} loans (with
            LP UUID).
          </p>
          {state.conditionErrors.length > 0 ? (
            <p className="mt-2 text-amber-700 dark:text-amber-400">
              Conditions: {state.conditionErrors.slice(0, 3).join(" · ")}
            </p>
          ) : null}
        </div>
      )}
      {state.status === "error" && (
        <div className="rounded-md border border-red-600/50 bg-red-50 px-3 py-2 text-sm dark:bg-red-950/30">
          <strong>LendingPad sync failed:</strong> {state.message}
        </div>
      )}
    </div>
  );
}
