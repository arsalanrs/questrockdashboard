"use client";

import { useState } from "react";

type SyncState =
  | { status: "idle" }
  | { status: "loading"; phase?: string }
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

type LpApiBody = {
  error?: string;
  loans?: {
    loansUpserted: number;
    loansConsidered: number;
    sources: Array<{ kind: string; pages: number; loansUpserted: number }>;
    errors: string[];
  };
  conditions?: {
    conditionsWritten: number;
    loansSynced: number;
    errors: string[];
  };
};

async function postLpSync(query: string): Promise<{ ok: true; body: LpApiBody } | { ok: false; error: string }> {
  const res = await fetch(`/api/sync/lendingpad${query}`, { method: "POST" });
  let body: LpApiBody | null = null;
  try {
    body = (await res.json()) as LpApiBody;
  } catch {
    body = null;
  }
  if (!res.ok) {
    return {
      ok: false,
      error:
        body?.error ??
        (res.status === 504
          ? "LendingPad sync timed out — try again or run npm run lendingpad:sync locally."
          : `HTTP ${res.status}`),
    };
  }
  if (!body) {
    return { ok: false, error: "Empty response from LendingPad sync API." };
  }
  return { ok: true, body };
}

export function LendingPadSyncButton() {
  const [state, setState] = useState<SyncState>({ status: "idle" });

  async function handleClick() {
    setState({ status: "loading", phase: "Loans" });
    try {
      const loansRes = await postLpSync("?scope=loans&skipDetail=1");
      if (!loansRes.ok) {
        setState({ status: "error", message: loansRes.error });
        return;
      }

      setState({ status: "loading", phase: "Conditions" });
      const condRes = await postLpSync("?scope=conditions");
      if (!condRes.ok) {
        const loans = loansRes.body.loans!;
        setState({
          status: "success",
          loansUpserted: loans.loansUpserted,
          loansConsidered: loans.loansConsidered,
          sources: loans.sources ?? [],
          loanErrors: loans.errors ?? [],
          conditionsWritten: 0,
          conditionsLoansSynced: 0,
          conditionErrors: [`Conditions step failed: ${condRes.error}`],
        });
        return;
      }

      const loans = loansRes.body.loans!;
      const conditions = condRes.body.conditions!;
      setState({
        status: "success",
        loansUpserted: loans.loansUpserted,
        loansConsidered: loans.loansConsidered,
        sources: loans.sources ?? [],
        loanErrors: loans.errors ?? [],
        conditionsWritten: conditions.conditionsWritten,
        conditionsLoansSynced: conditions.loansSynced,
        conditionErrors: conditions.errors ?? [],
      });
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
        {state.status === "loading"
          ? `Syncing LendingPad${state.phase ? ` (${state.phase})…` : "…"}`
          : "Sync LendingPad now"}
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
