"use client";

import { useState } from "react";

type SyncState =
  | { status: "idle" }
  | { status: "loading"; elapsed: number }
  | { status: "success"; pages: number; records: number; skipped: number; loans: number; unmapped?: string[] }
  | { status: "error"; message: string };

export function SyncNowButton() {
  const [state, setState] = useState<SyncState>({ status: "idle" });

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const dateFrom = (form.elements.namedItem("dateFrom") as HTMLInputElement)?.value?.trim();
    const dateTo = (form.elements.namedItem("dateTo") as HTMLInputElement)?.value?.trim();

    setState({ status: "loading", elapsed: 0 });

    // Tick elapsed seconds so user sees progress during long syncs
    const startMs = Date.now();
    const ticker = setInterval(() => {
      setState((s) =>
        s.status === "loading"
          ? { ...s, elapsed: Math.floor((Date.now() - startMs) / 1000) }
          : s,
      );
    }, 1000);

    try {
      // Call the API route directly — avoids server-action timeout (maxDuration=300 on route)
      const body: Record<string, string> = { mode: "full" };
      if (dateFrom) body.dateFrom = dateFrom;
      if (dateTo) body.dateTo = dateTo;

      const res = await fetch("/api/sync/shape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json) {
        const msg = json?.error ?? `Server returned ${res.status}`;
        setState({ status: "error", message: msg });
        return;
      }

      setState({
        status: "success",
        pages: json.pages ?? 0,
        records: json.recordsProcessed ?? 0,
        skipped: json.recordsSkipped ?? 0,
        loans: json.loansUpserted ?? 0,
        unmapped: json.unmappedStatuses,
      });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Sync failed — check network or try again.",
      });
    } finally {
      clearInterval(ticker);
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="text-mutedForeground">Optional date window:</label>
          <input name="dateFrom" type="date" className="rounded border border-border bg-background px-2 py-1" />
          <span>to</span>
          <input name="dateTo" type="date" className="rounded border border-border bg-background px-2 py-1" />
          <span className="text-mutedForeground">(leave blank for last 2 years)</span>
        </div>
        <button
          type="submit"
          disabled={state.status === "loading"}
          className="inline-flex w-fit items-center gap-2 rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
        >
          {state.status === "loading" ? (
            <>
              <span
                className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-background/30 border-t-background"
              />
              Syncing… {state.elapsed}s
            </>
          ) : (
            "Sync now"
          )}
        </button>
      </form>

      {state.status === "loading" && (
        <p className="text-xs text-mutedForeground">
          Full sync pulls all leads in pages of 50 — this can take 2–5 minutes for large databases.
          Do not close this tab.
        </p>
      )}

      {state.status === "success" && (
        <div className="rounded-md border border-green-600/50 bg-green-50 px-3 py-2 text-sm dark:bg-green-950/30">
          <strong>Synced:</strong> {state.pages} pages · {state.records} records ({state.skipped} filtered) · {state.loans} loans upserted.
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
