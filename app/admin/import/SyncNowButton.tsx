"use client";

import { useState, useRef } from "react";

// ── Date helpers ──────────────────────────────────────────────────────────────

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function nMonthsAgoIso(n: number) {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
}

/** Split a date range into N-month windows, newest-first. */
function buildDateChunks(fromIso: string, toIso: string, monthsPerChunk = 3): Array<{ from: string; to: string }> {
  const chunks: Array<{ from: string; to: string }> = [];
  let cursor = new Date(`${toIso}T12:00:00Z`);
  const floor = new Date(`${fromIso}T12:00:00Z`);
  while (cursor > floor) {
    const chunkTo = cursor.toISOString().slice(0, 10);
    cursor.setUTCMonth(cursor.getUTCMonth() - monthsPerChunk);
    const chunkFrom = cursor < floor ? fromIso : cursor.toISOString().slice(0, 10);
    chunks.push({ from: chunkFrom, to: chunkTo });
    if (chunkFrom === fromIso) break;
  }
  return chunks;
}

// ── Per-page API call ─────────────────────────────────────────────────────────

interface PageResult {
  done: boolean;
  nextPage: number;
  importBatchId: string;
  loansUpserted: number;
  recordsProcessed: number;
  recordsSkipped: number;
  duplicatePage?: boolean;
  unmappedStatuses?: string[];
}

async function syncOnePage(
  pageNumber: number,
  dateFrom: string,
  dateTo: string,
  importBatchId: string | null,
): Promise<PageResult> {
  const res = await fetch("/api/sync/shape/page", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pageNumber, dateFrom, dateTo, importBatchId }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) throw new Error(json?.error ?? `Server returned ${res.status}`);
  return json as PageResult;
}

// ── State ─────────────────────────────────────────────────────────────────────

type ChunkState = {
  label: string;
  status: "pending" | "running" | "done" | "error";
  loans: number;
  pages: number;
  error?: string;
};

type SyncState =
  | { status: "idle" }
  | { status: "running"; chunks: ChunkState[]; totalLoans: number; totalPages: number; startMs: number }
  | { status: "success"; totalLoans: number; totalPages: number; elapsed: number; unmapped?: string[] }
  | { status: "error"; message: string };

// ── Component ─────────────────────────────────────────────────────────────────

export function SyncNowButton() {
  const [state, setState] = useState<SyncState>({ status: "idle" });
  const [mode, setMode] = useState<"recent" | "full">("recent");
  const abortRef = useRef(false);

  async function handleSync() {
    const today = todayIso();
    abortRef.current = false;

    const dateChunks =
      mode === "recent"
        ? [{ from: nMonthsAgoIso(3), to: today }]
        : buildDateChunks(nMonthsAgoIso(24), today, 3);

    const initialChunks: ChunkState[] = dateChunks.map((c, i) => ({
      label: `${c.from} → ${c.to}${dateChunks.length > 1 ? ` (${i + 1}/${dateChunks.length})` : ""}`,
      status: "pending",
      loans: 0,
      pages: 0,
    }));

    const startMs = Date.now();
    setState({ status: "running", chunks: initialChunks, totalLoans: 0, totalPages: 0, startMs });

    let totalLoans = 0;
    let totalPages = 0;
    const allUnmapped = new Set<string>();

    for (let ci = 0; ci < dateChunks.length; ci++) {
      if (abortRef.current) break;

      setState((s) =>
        s.status === "running"
          ? { ...s, chunks: s.chunks.map((c, i) => (i === ci ? { ...c, status: "running" } : c)) }
          : s,
      );

      const { from, to } = dateChunks[ci];
      let page = 1;
      let importBatchId: string | null = null;
      let chunkLoans = 0;
      let chunkPages = 0;
      let chunkError: string | null = null;

      while (!abortRef.current) {
        try {
          const result = await syncOnePage(page, from, to, importBatchId);
          importBatchId = result.importBatchId;
          chunkLoans += result.loansUpserted;
          chunkPages++;
          totalLoans += result.loansUpserted;
          totalPages++;
          result.unmappedStatuses?.forEach((s) => allUnmapped.add(s));

          // Capture for closure
          const cl = chunkLoans;
          const cp = chunkPages;
          setState((s) =>
            s.status === "running"
              ? {
                  ...s,
                  totalLoans,
                  totalPages,
                  chunks: s.chunks.map((c, i) => (i === ci ? { ...c, loans: cl, pages: cp } : c)),
                }
              : s,
          );

          if (result.done || result.duplicatePage) break;
          page = result.nextPage;
        } catch (err) {
          chunkError = err instanceof Error ? err.message : "Page request failed";
          break;
        }
      }

      if (chunkError) {
        setState((s) =>
          s.status === "running"
            ? { ...s, chunks: s.chunks.map((c, i) => (i === ci ? { ...c, status: "error", error: chunkError! } : c)) }
            : s,
        );
        setState({ status: "error", message: `Chunk ${ci + 1}/${dateChunks.length} failed: ${chunkError}` });
        return;
      }

      setState((s) =>
        s.status === "running"
          ? { ...s, chunks: s.chunks.map((c, i) => (i === ci ? { ...c, status: "done" } : c)) }
          : s,
      );
    }

    setState({
      status: "success",
      totalLoans,
      totalPages,
      elapsed: Math.floor((Date.now() - startMs) / 1000),
      unmapped: allUnmapped.size ? Array.from(allUnmapped).sort() : undefined,
    });
  }

  const isRunning = state.status === "running";

  return (
    <div className="mt-4 flex flex-col gap-4">
      {/* Mode selector */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode("recent")}
          disabled={isRunning}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            mode === "recent"
              ? "bg-foreground text-background"
              : "border border-border bg-background text-foreground hover:bg-muted"
          } disabled:opacity-50`}
        >
          Quick sync (last 90 days)
        </button>
        <button
          type="button"
          onClick={() => setMode("full")}
          disabled={isRunning}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            mode === "full"
              ? "bg-foreground text-background"
              : "border border-border bg-background text-foreground hover:bg-muted"
          } disabled:opacity-50`}
        >
          Full historical (2 years)
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        {mode === "recent"
          ? "Syncs leads from the last 90 days — one page at a time, never times out."
          : "Syncs all leads from the last 2 years in 8 date chunks, one page (~50 leads) per request. Handles any database size — no timeouts possible."}
      </p>

      {/* Run button */}
      <button
        type="button"
        onClick={handleSync}
        disabled={isRunning}
        className="inline-flex w-fit items-center gap-2 rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
      >
        {isRunning ? (
          <>
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-background/30 border-t-background" />
            Syncing…
          </>
        ) : (
          "Sync now"
        )}
      </button>

      {/* Live progress */}
      {state.status === "running" && (
        <div className="flex flex-col gap-1.5">
          {state.chunks.map((c, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              {c.status === "pending" && <span className="text-muted-foreground">○</span>}
              {c.status === "running" && (
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
              )}
              {c.status === "done" && <span className="text-green-500">✓</span>}
              {c.status === "error" && <span className="text-red-500">✗</span>}
              <span className={c.status === "running" ? "font-medium text-foreground" : "text-muted-foreground"}>
                {c.label}
              </span>
              {(c.status === "running" || c.status === "done") && (
                <span className={c.status === "done" ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}>
                  {c.loans} leads · {c.pages}p
                </span>
              )}
              {c.status === "error" && <span className="text-red-500">{c.error}</span>}
            </div>
          ))}
          <p className="mt-1 text-xs text-muted-foreground">
            {state.totalLoans} leads upserted · {state.totalPages} pages fetched — do not close this tab
          </p>
        </div>
      )}

      {/* Success */}
      {state.status === "success" && (
        <div className="rounded-md border border-green-600/50 bg-green-50 px-3 py-2 text-sm dark:bg-green-950/30">
          <strong>Done</strong> — {state.totalLoans} leads upserted across {state.totalPages} pages
          {state.elapsed ? ` in ${state.elapsed}s` : ""}.
          {state.unmapped?.length ? (
            <p className="mt-2 text-muted-foreground">
              Unmapped statuses (add to stage_mapping):{" "}
              {state.unmapped.slice(0, 15).join(", ")}
              {state.unmapped.length > 15 ? "…" : ""}
            </p>
          ) : null}
        </div>
      )}

      {/* Error */}
      {state.status === "error" && (
        <div className="rounded-md border border-red-600/50 bg-red-50 px-3 py-2 text-sm dark:bg-red-950/30">
          <strong>Sync failed:</strong> {state.message}
        </div>
      )}
    </div>
  );
}
