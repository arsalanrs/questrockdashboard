"use client";

import { useEffect, useState } from "react";
import { shapeLeadUrl } from "@/lib/shape-link";

export type LoanDetailData = {
  id: string;
  shape_record_id: number | null;
  lendingpad_loan_uuid: string | null;
  borrower_first_name: string | null;
  borrower_last_name: string | null;
  status_raw: string | null;
  loan_type: string | null;
  loan_purpose: string | null;
  loan_amount_cents: number | null;
  borrower_phone: string | null;
  borrower_email: string | null;
  credit_score_mid: number | null;
  lock_expiration_date: string | null;
  rich?: {
    front_dti?: number | null;
    back_dti?: number | null;
    ltv_ratio_percent?: number | null;
    note_rate?: number | null;
    lock_expiration_at?: string | null;
    borrower_mobile_phone?: string | null;
    borrower_email?: string | null;
    borrower_address_json?: { street?: string; city?: string; state?: string; zipCode?: string } | null;
    processing_checklist_json?: Record<string, { completed?: boolean; requestDate?: string; receivedDate?: string }> | null;
  } | null;
};

function fmt$(cents: number | null) {
  if (!cents) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    cents / 100,
  );
}

function borrowerName(l: LoanDetailData) {
  return [l.borrower_first_name, l.borrower_last_name].filter(Boolean).join(" ") || "—";
}

export function LoanDetailPanel({
  loan,
  onClose,
}: {
  loan: LoanDetailData;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const [status, setStatus] = useState(loan.status_raw ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const phone = loan.rich?.borrower_mobile_phone ?? loan.borrower_phone;
  const email = loan.rich?.borrower_email ?? loan.borrower_email;
  const addr = loan.rich?.borrower_address_json;
  const shapeUrl = shapeLeadUrl(loan.shape_record_id);
  const lpUrl = loan.lendingpad_loan_uuid
    ? `https://app.lendingpad.com/loans/${loan.lendingpad_loan_uuid}`
    : "https://prod.lendingpad.com/questrock-llc/login";

  async function postNote() {
    if (!note.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/loans/${loan.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      setNote("");
      setMsg("Note saved to LendingPad");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus() {
    if (!status.trim() || !loan.shape_record_id) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/loans/${loan.id}/shape-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      setMsg("Shape status updated");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        <h2 className="text-sm font-semibold text-[#E8FF00]">{borrowerName(loan)}</h2>
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 hover:bg-white/10">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div><span className="text-gray-400">Amount</span><div className="font-semibold text-[#E8FF00]">{fmt$(loan.loan_amount_cents)}</div></div>
          <div><span className="text-gray-400">Type</span><div>{loan.loan_type ?? "—"} · {loan.loan_purpose ?? "—"}</div></div>
          <div><span className="text-gray-400">Credit</span><div>{loan.credit_score_mid ?? "—"}</div></div>
          <div><span className="text-gray-400">DTI</span><div>{loan.rich?.front_dti ?? "—"} / {loan.rich?.back_dti ?? "—"}</div></div>
          <div><span className="text-gray-400">LTV</span><div>{loan.rich?.ltv_ratio_percent ?? "—"}%</div></div>
          <div><span className="text-gray-400">Rate</span><div>{loan.rich?.note_rate ?? "—"}%</div></div>
        </div>

        {phone && (
          <div>
            <a href={`tel:${phone}`} className="text-[#E8FF00] hover:underline">{phone}</a>
          </div>
        )}
        {email && <div className="text-gray-300">{email}</div>}
        {addr?.street && (
          <div className="text-gray-400 text-xs">
            {addr.street}, {addr.city} {addr.state} {addr.zipCode}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {shapeUrl && (
            <a href={shapeUrl} target="_blank" rel="noopener noreferrer" className="rounded border border-white/20 px-2 py-1 text-xs hover:border-[#E8FF00]/50">
              Open Shape ↗
            </a>
          )}
          <a href={lpUrl} target="_blank" rel="noopener noreferrer" className="rounded border border-white/20 px-2 py-1 text-xs hover:border-[#E8FF00]/50">
            Open LP ↗
          </a>
        </div>

        <LiveConditions loanId={loan.id} />
        <ProcessingChecklist data={loan.rich?.processing_checklist_json} />
        <NotesFeed loanId={loan.id} />

        <div className="space-y-2 border-t border-white/10 pt-3">
          <label className="text-xs text-gray-400">Add note to LendingPad</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="w-full rounded border border-white/10 bg-black/40 p-2 text-xs text-white"
          />
          <button
            type="button"
            disabled={busy}
            onClick={postNote}
            className="rounded bg-[#E8FF00]/20 px-3 py-1.5 text-xs font-medium text-[#E8FF00] disabled:opacity-50"
          >
            Save note
          </button>
        </div>

        {loan.shape_record_id && (
          <div className="space-y-2">
            <label className="text-xs text-gray-400">Update Shape status</label>
            <input
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded border border-white/10 bg-black/40 p-2 text-xs text-white"
            />
            <button
              type="button"
              disabled={busy}
              onClick={updateStatus}
              className="rounded border border-white/20 px-3 py-1.5 text-xs disabled:opacity-50"
            >
              Update Shape
            </button>
          </div>
        )}

        {msg && <p className="text-xs text-gray-300">{msg}</p>}
      </div>
    </div>
  );
}

function LiveConditions({ loanId }: { loanId: string }) {
  const [conditions, setConditions] = useState<Array<{ id: string; title: string; status: string; category?: string | null }>>([]);

  useEffect(() => {
    fetch(`/api/loans/${loanId}/conditions`)
      .then((r) => r.json())
      .then((j) => setConditions(j.conditions ?? []))
      .catch(() => {});
  }, [loanId]);

  const open = conditions.filter((c) => c.status === "open");
  const cleared = conditions.filter((c) => c.status === "cleared");

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-300 mb-2">Conditions ({open.length} open)</h3>
      <ul className="space-y-1 text-xs">
        {open.slice(0, 8).map((c) => (
          <li key={c.id} className="text-red-300">✗ {c.title}</li>
        ))}
        {cleared.slice(0, 3).map((c) => (
          <li key={c.id} className="text-green-400/80">✓ {c.title}</li>
        ))}
      </ul>
    </div>
  );
}

function ProcessingChecklist({
  data,
}: {
  data?: Record<string, { completed?: boolean; requestDate?: string; receivedDate?: string }> | null;
}) {
  if (!data) return null;
  const items = Object.entries(data).filter(([, v]) => v);
  if (!items.length) return null;

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-300 mb-2">Processing checklist</h3>
      <ul className="space-y-1 text-xs text-gray-400">
        {items.map(([key, v]) => (
          <li key={key}>
            {v.completed ? "✓" : "○"} {key.replace(/([A-Z])/g, " $1")}
            {v.requestDate && !v.completed ? ` (requested)` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

function NotesFeed({ loanId }: { loanId: string }) {
  const [notes, setNotes] = useState<Array<{ id: string; source: string; author: string | null; body: string; noted_at: string }>>([]);

  useEffect(() => {
    fetch(`/api/loans/${loanId}/notes`)
      .then((r) => r.json())
      .then((j) => setNotes(j.notes ?? []))
      .catch(() => {});
  }, [loanId]);

  if (!notes.length) return null;

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-300 mb-2">Notes</h3>
      <ul className="space-y-2 text-xs">
        {notes.slice(0, 10).map((n) => (
          <li key={n.id} className="rounded border border-white/5 p-2">
            <div className="text-gray-500">{new Date(n.noted_at).toLocaleString()} · {n.source}</div>
            <div className="text-gray-200 mt-1">{n.body}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
