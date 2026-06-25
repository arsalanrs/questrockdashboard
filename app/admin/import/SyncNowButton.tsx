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

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// ── Per-page API call (with 429 retry) ───────────────────────────────────────

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

/** Calls the per-page endpoint with up to 3 retries on 429 rate-limit. */
async function syncOnePage(
  pageNumber: number,
  dateFrom: string,
  dateTo: string,
  importBatchId: string | null,
): Promise<PageResult> {
  const MAX_RETRIES = 3;
  let delay = 12000; // 12s initial back-off on 429

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch("/api/sync/shape/page", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageNumber, dateFrom, dateTo, importBatchId }),
    });

    if (res.status === 429) {
      if (attempt === MAX_RETRIES) throw new Error("Rate limited by Shape API after 3 retries.");
      await sleep(delay);
      delay *= 2; // exponential back-off: 12s → 24s → 48s
      continue;
    }

    if (res.status === 504 || res.status === 502) {
      if (attempt === MAX_RETRIES) {
        throw new Error(
          `Shape sync timed out on page ${pageNumber} (HTTP ${res.status}). ` +
            "The server may need more time per page — retry, or run `node scripts/rebuild-shape-sync.mjs` locally.",
        );
      }
      await sleep(3000);
      continue;
    }

    const json = await res.json().catch(() => null);
    if (!res.ok || !json) throw new Error(json?.error ?? `Server returned ${res.status}`);
    return json as PageResult;
  }

  throw new Error("Unreachable");
}

/** Delay between pages to stay under Shape's rate limit (~1 req/s safe). */
const PAGE_DELAY_MS = 1200;

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
  | { status: "running"; chunks: ChunkState[]; totalLoans: number; totalPages: number; startMs: number; phase?: string }
  | { status: "success"; totalLoans: number; totalPages: number; elapsed: number; unmapped?: string[]; rebuilt?: boolean; lpWarning?: string }
  | { status: "error"; message: string };

function nDaysAgoIso(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SyncNowButton() {
  const [state, setState] = useState<SyncState>({ status: "idle" });
  const [mode, setMode] = useState<"recent" | "full" | "rebuild">("recent");
  const abortRef = useRef(false);

  async function handleSync() {
    const today = todayIso();
    abortRef.current = false;

    if (mode === "rebuild") {
      const startMs = Date.now();
      setState({
        status: "running",
        chunks: [{ label: "Reset operational loans", status: "running", loans: 0, pages: 0 }],
        totalLoans: 0,
        totalPages: 0,
        startMs,
        phase: "reset",
      });

      const resetRes = await fetch("/api/admin/reset-loans", { method: "POST" });
      const resetJson = await resetRes.json().catch(() => null);
      if (!resetRes.ok) {
        setState({ status: "error", message: resetJson?.error ?? "Reset failed" });
        return;
      }

      const dateChunks = [{ from: nDaysAgoIso(90), to: today }];
      const initialChunks: ChunkState[] = [
        { label: "Reset complete", status: "done", loans: 0, pages: 0 },
        ...dateChunks.map((c) => ({
          label: `Shape sync ${c.from} → ${c.to}`,
          status: "pending" as const,
          loans: 0,
          pages: 0,
        })),
        { label: "LendingPad sync", status: "pending", loans: 0, pages: 0 },
      ];

      setState({
        status: "running",
        chunks: initialChunks,
        totalLoans: 0,
        totalPages: 0,
        startMs,
        phase: "sync",
      });

      let totalLoans = 0;
      let totalPages = 0;
      const allUnmapped = new Set<string>();

      for (let ci = 1; ci < dateChunks.length + 1; ci++) {
        if (abortRef.current) break;
        const chunkIdx = ci;
        setState((s) =>
          s.status === "running"
            ? {
                ...s,
                chunks: s.chunks.map((c, i) => (i === chunkIdx ? { ...c, status: "running" } : c)),
              }
            : s,
        );

        const { from, to } = dateChunks[ci - 1];
        let page = 1;
        let importBatchId: string | null = null;
        let chunkLoans = 0;
        let chunkPages = 0;

        while (!abortRef.current) {
          try {
            const result = await syncOnePage(page, from, to, importBatchId);
            importBatchId = result.importBatchId;
            chunkLoans += result.loansUpserted;
            chunkPages++;
            totalLoans += result.loansUpserted;
            totalPages++;
            result.unmappedStatuses?.forEach((s) => allUnmapped.add(s));

            setState((s) =>
              s.status === "running"
                ? {
                    ...s,
                    totalLoans,
                    totalPages,
                    chunks: s.chunks.map((c, i) =>
                      i === chunkIdx ? { ...c, loans: chunkLoans, pages: chunkPages } : c,
                    ),
                  }
                : s,
            );

            if (result.done || result.duplicatePage) break;
            page = result.nextPage;
            await sleep(PAGE_DELAY_MS);
          } catch (err) {
            setState({
              status: "error",
              message: err instanceof Error ? err.message : "Shape sync failed during rebuild",
            });
            return;
          }
        }

        setState((s) =>
          s.status === "running"
            ? {
                ...s,
                chunks: s.chunks.map((c, i) => (i === chunkIdx ? { ...c, status: "done" } : c)),
              }
            : s,
        );
      }

      const lpIdx = dateChunks.length + 1;
      setState((s) =>
        s.status === "running"
          ? {
              ...s,
              chunks: s.chunks.map((c, i) => (i === lpIdx ? { ...c, status: "running" } : c)),
            }
          : s,
      );

      const lpRes = await fetch("/api/sync/lendingpad?scope=loans&skipDetail=1", { method: "POST" });
      const lpJson = await lpRes.json().catch(() => null);
      if (!lpRes.ok) {
        const lpErr =
          lpJson?.error ??
          (lpRes.status === 504
            ? "LendingPad sync timed out on the server (Shape data is saved — retry LP sync separately)."
            : lpRes.status === 503
              ? "LendingPad is not configured on this deployment (set LENDINGPAD_* env vars on Vercel)."
              : `LendingPad sync failed (HTTP ${lpRes.status})`);
        setState((s) =>
          s.status === "running"
            ? {
                ...s,
                chunks: s.chunks.map((c, i) =>
                  i === lpIdx ? { ...c, status: "error", error: lpErr } : c,
                ),
              }
            : s,
        );
        setState({
          status: "success",
          totalLoans,
          totalPages,
          elapsed: Math.floor((Date.now() - startMs) / 1000),
          unmapped: allUnmapped.size ? Array.from(allUnmapped).sort() : undefined,
          rebuilt: true,
          lpWarning: lpErr,
        });
        return;
      }

      const lpUpserted = lpJson?.loans?.loansUpserted ?? 0;

      setState((s) =>
        s.status === "running"
          ? {
              ...s,
              chunks: s.chunks.map((c, i) =>
                i === lpIdx ? { ...c, status: "done", loans: lpUpserted } : c,
              ),
            }
          : s,
      );

      setState({
        status: "success",
        totalLoans,
        totalPages,
        elapsed: Math.floor((Date.now() - startMs) / 1000),
        unmapped: allUnmapped.size ? Array.from(allUnmapped).sort() : undefined,
        rebuilt: true,
      });
      return;
    }

    const dateChunks =
      mode === "recent"
        ? [{ from: nDaysAgoIso(90), to: today }]
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
          // Pause between pages to stay under Shape's rate limit
          await sleep(PAGE_DELAY_MS);
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
        <button
          type="button"
          onClick={() => setMode("rebuild")}
          disabled={isRunning}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            mode === "rebuild"
              ? "bg-red-600 text-white"
              : "border border-red-600/40 bg-background text-red-600 hover:bg-red-950/20"
          } disabled:opacity-50`}
        >
          Clean 90-day rebuild
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        {mode === "recent"
          ? "Syncs leads from the last 90 days — one page (~50 leads) per request, paced to avoid Shape rate limits."
          : mode === "full"
            ? "Syncs all leads from the last 2 years in 8 date chunks. One page per request with 1.2s pacing — handles any volume without timeouts or rate limits."
            : "Wipes all operational loan data, then re-syncs Shape (90 days) and LendingPad. Keeps users, teams, and stage_mapping."}
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
        ) : mode === "rebuild" ? (
          "Clean rebuild…"
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
          <strong>{state.rebuilt ? "Rebuild complete" : "Done"}</strong> — {state.totalLoans} leads upserted across {state.totalPages} pages
          {state.elapsed ? ` in ${state.elapsed}s` : ""}.
          {state.unmapped?.length ? (
            <p className="mt-2 text-muted-foreground">
              Unmapped statuses (add to stage_mapping):{" "}
              {state.unmapped.slice(0, 15).join(", ")}
              {state.unmapped.length > 15 ? "…" : ""}
            </p>
          ) : null}
          {state.lpWarning ? (
            <p className="mt-2 text-amber-700 dark:text-amber-400">
              <strong>Shape rebuild OK.</strong> LendingPad step failed: {state.lpWarning}
              {" "}You can retry with the main Sync button or run{" "}
              <code className="text-xs">npm run lendingpad:sync</code> locally.
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
