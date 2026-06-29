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
    <div className="qr-dashboard-page mx-auto max-w-2xl animate-fade-up">
      <div>
        <p className="lo-accent-text text-xs font-bold uppercase tracking-wide">Front desk</p>
        <h1 className="lo-heading text-xl font-semibold sm:text-2xl">Concierge Desk</h1>
        <p className="lo-muted mt-1 text-[13px]">
          Lookup caller by phone or name. Save phone to Shape before transcript arrives (~7 min).
        </p>
      </div>

      <div className="lo-card space-y-3 p-4">
        <input
          placeholder="Caller phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="lo-input w-full rounded-lg p-2.5 text-sm"
        />
        <input
          placeholder="Borrower name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="lo-input w-full rounded-lg p-2.5 text-sm"
        />
        <button
          type="button"
          onClick={search}
          disabled={busy}
          className="accent-bg rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          Search
        </button>
      </div>

      {msg ? <p className="lo-heading text-sm font-medium">{msg}</p> : null}

      {results.length > 0 && (
        <div className="space-y-2">
          <p className="lo-muted text-xs">Results from {source}</p>
          {results.map((r, i) => {
            const id = String(r.id ?? r.shape_record_id ?? i);
            const label = [r.borrower_first_name, r.borrower_last_name].filter(Boolean).join(" ") || "Lead";
            return (
              <button
                key={id}
                type="button"
                onClick={() => setSelected(r)}
                className="lo-card w-full p-3 text-left text-sm transition-colors hover:border-[var(--lo-teal)]"
              >
                <div className="lo-heading font-semibold">{label}</div>
                <div className="lo-muted text-xs">
                  {r.status_raw ?? "—"} · {r.source ?? ""}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="lo-card border-[var(--lo-teal)] bg-[var(--lo-accent-soft)] p-4 space-y-3">
          <div className="lo-heading font-semibold">
            {[selected.borrower_first_name, selected.borrower_last_name].filter(Boolean).join(" ")}
          </div>
          <div className="flex flex-wrap gap-2">
            {shapeUrl && (
              <a
                href={shapeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="lo-contact-chip rounded-lg px-3 py-1.5 text-xs font-semibold hover:opacity-90"
              >
                Open Shape ↗
              </a>
            )}
            {lpUrl && (
              <a
                href={lpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="lo-contact-chip rounded-lg px-3 py-1.5 text-xs font-semibold hover:opacity-90"
              >
                Open LP ↗
              </a>
            )}
            <button
              type="button"
              onClick={savePhoneToShape}
              disabled={busy || !phone.trim() || !selected.shape_record_id}
              className="accent-bg rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            >
              Save phone to Shape
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
