"use client";

import { useState } from "react";
import { runShapeApiSyncReturn } from "./actions";

type SyncState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; pages: number; records: number; skipped: number; loans: number; unmapped?: string[] }
  | { status: "error"; message: string };

export function SyncNowButton() {
  const [state, setState] = useState<SyncState>({ status: "idle" });

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    setState({ status: "loading" });
    try {
      const out = await runShapeApiSyncReturn(formData);
      if (out.ok) {
        setState({
          status: "success",
          pages: out.result.pages,
          records: out.result.recordsProcessed,
          skipped: out.result.recordsSkipped,
          loans: out.result.loansUpserted,
          unmapped: out.result.unmappedStatuses,
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
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="text-mutedForeground">Optional date window (first run):</label>
          <input name="dateFrom" type="date" className="rounded border border-border bg-background px-2 py-1" />
          <span>to</span>
          <input name="dateTo" type="date" className="rounded border border-border bg-background px-2 py-1" />
          <span className="text-mutedForeground">(leave blank for last 2 years)</span>
        </div>
        <button
          type="submit"
          disabled={state.status === "loading"}
          className="inline-flex w-fit items-center rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
        >
          {state.status === "loading" ? "Syncing…" : "Sync now"}
        </button>
      </form>
      {state.status === "success" && (
        <div className="rounded-md border border-green-600/50 bg-green-50 px-3 py-2 text-sm dark:bg-green-950/30">
          <strong>Synced to Supabase:</strong> {state.pages} pages, {state.records} records ({state.skipped} filtered out), {state.loans} loans
          upserted.
          {state.unmapped?.length ? (
            <p className="mt-2 text-mutedForeground">
              Unmapped statuses (add to stage_mapping): {state.unmapped.slice(0, 15).join(", ")}
              {state.unmapped.length > 15 ? "…" : ""}
            </p>
          ) : null}
        </div>
      )}
      {state.status === "error" && (
        <div className="rounded-md border border-red-600/50 bg-red-50 px-3 py-2 text-sm dark:bg-red-950/30">
          <strong>Sync failed:</strong> {state.message}
        </div>
      )}
    </div>
  );
}
