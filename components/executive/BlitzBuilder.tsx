"use client";

import { useState } from "react";

import type { AssignmentPreviewRow } from "@/lib/assignment/engine";

function fmt$(cents: number | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function BlitzBuilder() {
  const [tier, setTier] = useState<"RED" | "ORANGE">("RED");
  const [limit, setLimit] = useState(20);
  const [rows, setRows] = useState<AssignmentPreviewRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [execLoading, setExecLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [execResult, setExecResult] = useState<string | null>(null);

  async function runPreview() {
    setLoading(true);
    setError(null);
    setExecResult(null);
    try {
      const res = await fetch("/api/executive/assignment/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, limit }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setRows(body.rows ?? []);
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function runExecute() {
    if (rows.length === 0) return;
    setExecLoading(true);
    setError(null);
    setExecResult(null);
    try {
      const res = await fetch("/api/executive/assignment/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tier,
          loanIds: rows.map((r) => r.loanId),
          confirm: true,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setExecResult(`Assigned ${body.completed} loan(s). Failed: ${body.failed?.length ?? 0}.`);
      setRows([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExecLoading(false);
    }
  }

  return (
    <section className="exec-section" style={{ marginBottom: 0 }}>
      <div className="exec-section-body p-0">
        <div className="exec-blitz-box">
          <div className="exec-blitz-title">⚡ Blitz Builder</div>
          <div className="exec-blitz-sub">Preview before bulk-assigning RED/ORANGE tier leads</div>

      <div className="mt-4 flex flex-wrap items-end gap-3 relative z-[1]">
        <label className="flex flex-col gap-1 text-xs text-[rgba(244,239,221,0.7)]">
          <span>Tier</span>
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value as "RED" | "ORANGE")}
            className="rounded border border-[rgba(255,255,255,0.2)] bg-[rgba(0,0,0,0.2)] px-2 py-1 text-[#F4EFDD]"
          >
            <option value="RED">RED</option>
            <option value="ORANGE">ORANGE</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[rgba(244,239,221,0.7)]">
          <span>Limit</span>
          <input
            type="number"
            min={1}
            max={100}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value) || 20)}
            className="w-24 rounded border border-[rgba(255,255,255,0.2)] bg-[rgba(0,0,0,0.2)] px-2 py-1 text-[#F4EFDD]"
          />
        </label>
        <button
          type="button"
          onClick={() => void runPreview()}
          disabled={loading}
          className="exec-blitz-btn text-xs disabled:opacity-50"
        >
          {loading ? "Preview…" : "Preview blitz"}
        </button>
        <button
          type="button"
          onClick={() => void runExecute()}
          disabled={execLoading || rows.length === 0}
          className="rounded-md border border-[rgba(255,255,255,0.25)] px-3 py-1.5 text-xs font-semibold text-[#F4EFDD] hover:bg-[rgba(255,255,255,0.08)] disabled:opacity-50"
        >
          {execLoading ? "Executing…" : "Confirm execute"}
        </button>
      </div>

      {error && (
        <div className="mt-3 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-600">{error}</div>
      )}
      {execResult && (
        <div className="mt-3 rounded-md bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700">{execResult}</div>
      )}

      {rows.length > 0 && (
        <div className="relative z-[1] mt-4 overflow-x-auto rounded-md border border-[rgba(255,255,255,0.15)]">
          <table className="w-full min-w-[640px] text-left text-xs text-[#F4EFDD]">
            <thead className="border-b border-[rgba(255,255,255,0.15)] text-[11px] uppercase opacity-70">
              <tr>
                <th className="px-2 py-2">Borrower</th>
                <th className="px-2 py-2">Amount</th>
                <th className="px-2 py-2">Current LO</th>
                <th className="px-2 py-2">Assign to</th>
                <th className="px-2 py-2">Method</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.loanId} className="border-b border-[rgba(255,255,255,0.08)]">
                  <td className="px-2 py-2">{r.borrowerDisplay ?? "—"}</td>
                  <td className="px-2 py-2 tabular-nums">{fmt$(r.loanAmountCents)}</td>
                  <td className="px-2 py-2">{r.currentLoName ?? "—"}</td>
                  <td className="px-2 py-2 font-medium">{r.proposedName}</td>
                  <td className="px-2 py-2 opacity-70">{r.assignmentMethod}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
        </div>
      </div>
    </section>
  );
}
