"use client";

import { useState } from "react";

// ── Chunk helpers ────────────────────────────────────────────────────────────

/** Split a date range into N-month windows, newest first. */
function buildChunks(fromIso: string, toIso: string, monthsPerChunk = 3): Array<{ from: string; to: string }> {
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

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function nMonthsAgoIso(n: number) {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
}

// ── State ────────────────────────────────────────────────────────────────────

type ChunkProgress = {
  label: string;
  status: "pending" | "running" | "done" | "error";
  loans?: number;
  error?: string;
};

type SyncState =
  | { status: "idle" }
  | { status: "running"; chunks: ChunkProgress[]; totalLoans: number; startMs: number }
  | { status: "success"; totalLoans: number; totalRecords: number; elapsed: number; unmapped?: string[] }
  | { status: "error"; message: string };

// ── API call ─────────────────────────────────────────────────────────────────

async function callShapeSync(from: string, to: string): Promise<{ loans: number; records: number; unmapped?: string[] }> {
  const res = await fetch("/api/sync/shape", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "full", dateFrom: from, dateTo: to }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) throw new Error(json?.error ?? `Server returned ${res.status}`);
  return {
    loans: json.loansUpserted ?? 0,
    records: json.recordsProcessed ?? 0,
    unmapped: json.unmappedStatuses,
  };
}

// ── Component ────────────────────────────────────────────────────────────────

export function SyncNowButton() {
  const [state, setState] = useState<SyncState>({ status: "idle" });
  const [mode, setMode] = useState<"recent" | "full">("recent");

  async function handleSync() {
    const today = todayIso();

    // Build chunks based on selected mode
    const chunks =
      mode === "recent"
        ? [{ from: nMonthsAgoIso(3), to: today }]
        : buildChunks(nMonthsAgoIso(24), today, 3); // 8 chunks of 3 months each

    const progress: ChunkProgress[] = chunks.map((c, i) => ({
      label: `${c.from} → ${c.to}${chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : ""}`,
      status: "pending",
    }));

    setState({ status: "running", chunks: progress, totalLoans: 0, startMs: Date.now() });

    let totalLoans = 0;
    let totalRecords = 0;
    const allUnmapped: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      setState((s) =>
        s.status === "running"
          ? {
              ...s,
              chunks: s.chunks.map((c, ci) =>
                ci === i ? { ...c, status: "running" } : c,
              ),
            }
          : s,
      );

      try {
        const result = await callShapeSync(chunks[i].from, chunks[i].to);
        totalLoans += result.loans;
        totalRecords += result.records;
        if (result.unmapped?.length) allUnmapped.push(...result.unmapped);

        setState((s) =>
          s.status === "running"
            ? {
                ...s,
                totalLoans,
                chunks: s.chunks.map((c, ci) =>
                  ci === i ? { ...c, status: "done", loans: result.loans } : c,
                ),
              }
            : s,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Chunk failed";
        setState((s) =>
          s.status === "running"
            ? {
                ...s,
                chunks: s.chunks.map((c, ci) =>
                  ci === i ? { ...c, status: "error", error: msg } : c,
                ),
              }
            : s,
        );
        setState({ status: "error", message: `Chunk ${i + 1}/${chunks.length} failed: ${msg}` });
        return;
      }
    }

    const elapsed = state.status === "running" ? Math.floor((Date.now() - (state as Extract<SyncState, { status: "running" }>).startMs) / 1000) : 0;
    setState({
      status: "success",
      totalLoans,
      totalRecords,
      elapsed,
      unmapped: allUnmapped.length ? [...new Set(allUnmapped)] : undefined,
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
          Full historical (2 years · 8 chunks)
        </button>
      </div>

      <p className="text-xs text-mutedForeground">
        {mode === "recent"
          ? "Syncs leads created/updated in the last 90 days. Runs in ~30s."
          : "Syncs all leads from the last 2 years in 8 sequential 3-month chunks. Takes ~3–5 min total but each request is small so it never times out."}
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

      {/* Chunk progress */}
      {state.status === "running" && (
        <div className="flex flex-col gap-1.5">
          {state.chunks.map((c, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              {c.status === "pending" && <span className="text-mutedForeground">○</span>}
              {c.status === "running" && (
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
              )}
              {c.status === "done" && <span className="text-green-500">✓</span>}
              {c.status === "error" && <span className="text-red-500">✗</span>}
              <span className={c.status === "running" ? "text-foreground font-medium" : "text-mutedForeground"}>
                {c.label}
              </span>
              {c.status === "done" && c.loans !== undefined && (
                <span className="text-green-600 dark:text-green-400">+{c.loans} loans</span>
              )}
              {c.status === "error" && (
                <span className="text-red-500">{c.error}</span>
              )}
            </div>
          ))}
          <p className="mt-1 text-xs text-mutedForeground">
            {state.totalLoans} loans upserted so far · do not close this tab
          </p>
        </div>
      )}

      {/* Success */}
      {state.status === "success" && (
        <div className="rounded-md border border-green-600/50 bg-green-50 px-3 py-2 text-sm dark:bg-green-950/30">
          <strong>Done</strong> — {state.totalLoans} loans upserted from {state.totalRecords} records
          {state.elapsed ? ` in ${state.elapsed}s` : ""}.
          {state.unmapped?.length ? (
            <p className="mt-2 text-mutedForeground">
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
