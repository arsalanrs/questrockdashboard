"use client";

import { useEffect, useState } from "react";
import type { LoDashboardRichData } from "@/lib/shape-views/fetch-lo-dashboard";
import {
  borrowerDisplayName,
  formatMoney,
  formatShortDate,
  stateForRow,
  type PipelineLoanRow,
} from "@/lib/shape-views/lo-dashboard";
import { ActionButtons } from "./ActionButtons";
import { ChevronTrack } from "./ChevronTrack";
import { DetailGrid } from "./DetailGrid";
import { SlideOverShell } from "./SlideOverShell";

function slaClass(sla: PipelineLoanRow["sla"]) {
  if (sla === "ALERT") return "bg-[#fde6e2] text-[#c83c31]";
  if (sla === "CAUTION") return "bg-[#fff4d7] text-[#8a5a00]";
  return "bg-[#e2f6eb] text-[#178452]";
}

export function LoanDetailSlideOver({
  loan,
  rich,
  open,
  onClose,
}: {
  loan: PipelineLoanRow | null;
  rich?: LoDashboardRichData | null;
  open: boolean;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setNote("");
    setMsg(null);
  }, [loan?.id]);

  if (!loan) return null;

  async function postNote() {
    if (!note.trim() || !loan) return;
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

  const phone = rich?.borrower_mobile_phone ?? loan.borrower_phone;
  const email = rich?.borrower_email ?? loan.borrower_email;

  return (
    <SlideOverShell open={open} onClose={onClose} title="LendingPad Loan File">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="lo-heading text-2xl font-bold">{borrowerDisplayName(loan)}</h2>
            <div className="mt-2 flex flex-wrap gap-2 text-[13px]">
              {email ? (
                <span className="lo-muted rounded-md border border-[var(--lo-border)] bg-white px-2 py-1">{email}</span>
              ) : null}
              {phone ? (
                <span className="lo-muted rounded-md border border-[var(--lo-border)] bg-white px-2 py-1">{phone}</span>
              ) : null}
              {loan.assigned_loan_officer_name ? (
                <span className="lo-muted rounded-md border border-[var(--lo-border)] bg-white px-2 py-1">
                  {loan.assigned_loan_officer_name}
                </span>
              ) : null}
            </div>
          </div>
          <span className={`${slaClass(loan.sla)} rounded-full px-3 py-1 text-xs font-black`}>{loan.sla}</span>
        </div>

        <ActionButtons record={loan} />

        <div>
          <div className="mb-2 flex items-baseline justify-between gap-3 border-b border-[var(--lo-border)] pb-2">
            <h3 className="lo-heading text-[13px] font-black uppercase tracking-wide">Turntimes</h3>
            <span className="lo-muted text-xs">
              {loan.milestoneLabel} · {loan.turntimeLabel}
            </span>
          </div>
          <ChevronTrack progress={loan.progress} verificationTrack={loan.verificationTrack} compact />
        </div>

        <DetailGrid
          items={[
            ["Milestone", loan.milestoneLabel],
            ["Verification Track", loan.verificationTrack],
            ["Next Action", loan.nextAction],
            ["State", stateForRow(loan)],
            ["Loan Amount", formatMoney(loan.loan_amount_cents)],
            ["Loan Type", loan.loan_type],
            ["Loan Purpose", loan.loan_purpose],
            ["Credit Pulled", formatShortDate(loan.credit_report_requested_at)],
            ["Piped", formatShortDate(loan.conversion_date ?? loan.submitted_to_processing_at)],
            ["Approved", formatShortDate(loan.uw_decision_at)],
            ["Lock Days", loan.lockDaysLabel],
            ["CTC", formatShortDate(loan.ctc_at)],
            ["Closing Date", formatShortDate(loan.closing_date)],
            ["Finance Contingency", formatShortDate(loan.finance_contingency_date)],
            ["Appraisal Contingency", formatShortDate(loan.appraisal_contingency_date)],
            ["Credit Score", loan.credit_score_mid ?? "—"],
            ["DTI", rich ? `${rich.front_dti ?? "—"} / ${rich.back_dti ?? "—"}` : "—"],
            ["LTV", rich?.ltv_ratio_percent != null ? `${rich.ltv_ratio_percent}%` : "—"],
            ["Rate", rich?.note_rate != null ? `${rich.note_rate}%` : "—"],
          ]}
        />

        <LiveConditions loanId={loan.id} />
        <ProcessingChecklist data={rich?.processing_checklist_json} />
        <NotesFeed loanId={loan.id} />

        <div className="rounded-lg border border-[var(--lo-border)] bg-white px-4 py-3">
          <strong className="lo-muted block text-[11px] font-black uppercase">Pipeline Notes</strong>
          <p className="lo-heading mt-2 text-sm leading-relaxed">{loan.notesPreview}</p>
        </div>

        <div className="space-y-2 border-t border-[var(--lo-border)] pt-4">
          <label className="lo-muted text-xs font-semibold">Add note to LendingPad</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="lo-input w-full rounded-lg p-3 text-sm"
          />
          <button
            type="button"
            disabled={busy}
            onClick={postNote}
            className="rounded-lg bg-[var(--lo-accent)] px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
          >
            Save note
          </button>
          {msg ? <p className="lo-muted text-xs">{msg}</p> : null}
        </div>
      </div>
    </SlideOverShell>
  );
}

function LiveConditions({ loanId }: { loanId: string }) {
  const [conditions, setConditions] = useState<Array<{ id: string; title: string; status: string }>>([]);

  useEffect(() => {
    fetch(`/api/loans/${loanId}/conditions`)
      .then((r) => r.json())
      .then((j) => setConditions(j.conditions ?? []))
      .catch(() => {});
  }, [loanId]);

  const open = conditions.filter((c) => c.status === "open");
  if (!conditions.length) return null;

  return (
    <div className="rounded-lg border border-[var(--lo-border)] bg-white px-4 py-3">
      <h3 className="lo-muted text-xs font-black uppercase">Conditions ({open.length} open)</h3>
      <ul className="mt-2 space-y-1 text-sm">
        {open.slice(0, 8).map((c) => (
          <li key={c.id} className="text-[#FF4B4B]">
            ✗ {c.title}
          </li>
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
    <div className="rounded-lg border border-[var(--lo-border)] bg-white px-4 py-3">
      <h3 className="lo-muted text-xs font-black uppercase">Processing checklist</h3>
      <ul className="lo-muted mt-2 space-y-1 text-sm">
        {items.map(([key, v]) => (
          <li key={key}>
            {v.completed ? "✓" : "○"} {key.replace(/([A-Z])/g, " $1")}
          </li>
        ))}
      </ul>
    </div>
  );
}

function NotesFeed({ loanId }: { loanId: string }) {
  const [notes, setNotes] = useState<Array<{ id: string; source: string; body: string; noted_at: string }>>([]);

  useEffect(() => {
    fetch(`/api/loans/${loanId}/notes`)
      .then((r) => r.json())
      .then((j) => setNotes(j.notes ?? []))
      .catch(() => {});
  }, [loanId]);

  if (!notes.length) return null;

  return (
    <div className="rounded-lg border border-[var(--lo-border)] bg-white px-4 py-3">
      <h3 className="lo-muted text-xs font-black uppercase">Synced notes</h3>
      <ul className="mt-2 space-y-2 text-sm">
        {notes.slice(0, 8).map((n) => (
          <li key={n.id} className="rounded border border-[var(--lo-border)] px-2 py-2">
            <div className="lo-muted text-xs">
              {new Date(n.noted_at).toLocaleString()} · {n.source}
            </div>
            <div className="lo-heading mt-1">{n.body}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
