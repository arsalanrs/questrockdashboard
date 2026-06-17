"use client";

import { useState } from "react";
import { shapeLeadUrl } from "@/lib/shape-link";
import { lendingPadLoanUrl } from "@/lib/lendingpad-link";

type LeadResult = {
  id?: string;
  shape_record_id?: number | null;
  lendingpad_loan_uuid?: string | null;
  borrower_first_name?: string | null;
  borrower_last_name?: string | null;
  status_raw?: string | null;
  source?: string | null;
};

export function ConciergeDesk() {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [results, setResults] = useState<LeadResult[]>([]);
  const [source, setSource] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<LeadResult | null>(null);

  async function search() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/concierge/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, name }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Search failed");
      setResults(json.leads ?? []);
      setSource(json.source ?? "");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Search failed");
    } finally {
      setBusy(false);
    }
  }

  async function savePhoneToShape() {
    if (!selected || !phone.trim()) return;
    const shapeId = Number(selected.shape_record_id);
    if (!shapeId) return;
    setBusy(true);
    try {
      const res = await fetch("/api/concierge/save-phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shapeRecordId: shapeId, phone }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      setMsg("Phone saved to Shape");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const shapeUrl = selected?.shape_record_id ? shapeLeadUrl(selected.shape_record_id) : null;
  const lpUrl = lendingPadLoanUrl(selected?.lendingpad_loan_uuid);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Concierge Desk</h1>
        <p className="text-sm text-gray-400 mt-1">
          Lookup caller by phone or name. Save phone to Shape before transcript arrives (~7 min).
        </p>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
        <input
          placeholder="Caller phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="w-full rounded border border-white/10 bg-black/40 p-2 text-sm text-white"
        />
        <input
          placeholder="Borrower name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded border border-white/10 bg-black/40 p-2 text-sm text-white"
        />
        <button
          type="button"
          onClick={search}
          disabled={busy}
          className="rounded bg-[#E8FF00] px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
        >
          Search
        </button>
      </div>

      {msg && <p className="text-sm text-gray-300">{msg}</p>}

      {results.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">Results from {source}</p>
          {results.map((r, i) => {
            const id = String(r.id ?? r.shape_record_id ?? i);
            const label = [r.borrower_first_name, r.borrower_last_name].filter(Boolean).join(" ") || "Lead";
            return (
              <button
                key={id}
                type="button"
                onClick={() => setSelected(r)}
                className="w-full rounded border border-white/10 bg-white/5 p-3 text-left text-sm hover:border-[#E8FF00]/40"
              >
                <div className="font-medium text-white">{label}</div>
                <div className="text-xs text-gray-400">
                  {r.status_raw ?? "—"} · {r.source ?? ""}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="rounded-xl border border-[#E8FF00]/30 bg-[#E8FF00]/5 p-4 space-y-3">
          <div className="font-medium text-white">
            {[selected.borrower_first_name, selected.borrower_last_name].filter(Boolean).join(" ")}
          </div>
          <div className="flex flex-wrap gap-2">
            {shapeUrl && (
              <a
                href={shapeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded border border-white/20 px-3 py-1 text-xs hover:border-[#E8FF00]/50"
              >
                Open Shape ↗
              </a>
            )}
            {lpUrl && (
              <a
                href={lpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded border border-white/20 px-3 py-1 text-xs hover:border-[#E8FF00]/50"
              >
                Open LP ↗
              </a>
            )}
            <button
              type="button"
              onClick={savePhoneToShape}
              disabled={busy || !phone.trim() || !selected.shape_record_id}
              className="rounded border border-white/20 px-3 py-1 text-xs disabled:opacity-50"
            >
              Save phone to Shape
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
