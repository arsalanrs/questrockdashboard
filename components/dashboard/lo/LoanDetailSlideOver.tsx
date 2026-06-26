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
  if (sla === "ALERT") return "pill-red";
  if (sla === "CAUTION") return "pill-amber";
  return "pill-green";
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
            <h2 className="text-2xl font-bold text-foreground">{borrowerDisplayName(loan)}</h2>
            <div className="mt-2 flex flex-wrap gap-2 text-[13px] text-muted-foreground">
              {email ? (
                <span className="rounded-md border px-2 py-1" style={{ borderColor: "rgba(255,255,255,0.1)" }}>
                  {email}
                </span>
              ) : null}
              {phone ? (
                <span className="rounded-md border px-2 py-1" style={{ borderColor: "rgba(255,255,255,0.1)" }}>
                  {phone}
                </span>
              ) : null}
              {loan.assigned_loan_officer_name ? (
                <span className="rounded-md border px-2 py-1" style={{ borderColor: "rgba(255,255,255,0.1)" }}>
                  {loan.assigned_loan_officer_name}
                </span>
              ) : null}
            </div>
          </div>
          <span className={cnPill(slaClass(loan.sla))}>{loan.sla}</span>
        </div>

        <ActionButtons record={loan} />

        <div>
          <div className="mb-2 flex items-baseline justify-between gap-3 border-b pb-2" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
            <h3 className="text-[13px] font-black uppercase tracking-wide">Turntimes</h3>
            <span className="text-xs text-muted-foreground">
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

        <div
          className="rounded-lg border px-4 py-3"
          style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}
        >
          <strong className="block text-[11px] font-black uppercase text-muted-foreground">Pipeline Notes</strong>
          <p className="mt-2 text-sm leading-relaxed text-foreground">{loan.notesPreview}</p>
        </div>

        <div className="space-y-2 border-t pt-4" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
          <label className="text-xs font-semibold text-muted-foreground">Add note to LendingPad</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="w-full rounded-lg border bg-black/40 p-3 text-sm text-foreground"
            style={{ borderColor: "rgba(255,255,255,0.12)" }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={postNote}
            className="rounded-lg bg-[#E8FF00]/15 px-3 py-2 text-xs font-bold text-[#E8FF00] disabled:opacity-50"
          >
            Save note
          </button>
          {msg ? <p className="text-xs text-muted-foreground">{msg}</p> : null}
        </div>
      </div>
    </SlideOverShell>
  );
}

function cnPill(base: string) {
  return `${base} rounded-full px-3 py-1 text-xs font-black`;
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
    <div
      className="rounded-lg border px-4 py-3"
      style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}
    >
      <h3 className="text-xs font-black uppercase text-muted-foreground">Conditions ({open.length} open)</h3>
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
    <div
      className="rounded-lg border px-4 py-3"
      style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}
    >
      <h3 className="text-xs font-black uppercase text-muted-foreground">Processing checklist</h3>
      <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
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
    <div
      className="rounded-lg border px-4 py-3"
      style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}
    >
      <h3 className="text-xs font-black uppercase text-muted-foreground">Synced notes</h3>
      <ul className="mt-2 space-y-2 text-sm">
        {notes.slice(0, 8).map((n) => (
          <li key={n.id} className="rounded border px-2 py-2" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
            <div className="text-xs text-muted-foreground">
              {new Date(n.noted_at).toLocaleString()} · {n.source}
            </div>
            <div className="mt-1 text-foreground">{n.body}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
