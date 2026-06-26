"use client";

import { formatDistanceToNow } from "date-fns";
import { NEUTRAL_MILESTONE_PROGRESS } from "@/lib/shape-views/turntime-milestones";
import type { ClassifiedLead } from "@/lib/shape-views/lo-dashboard";
import { formatMoney, stateForRow } from "@/lib/shape-views/lo-dashboard";
import { ActionButtons } from "./ActionButtons";
import { ChevronTrack } from "./ChevronTrack";
import { DetailGrid } from "./DetailGrid";
import { SlideOverShell } from "./SlideOverShell";

function fmtRelative(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return "—";
  }
}

function borrowerName(lead: ClassifiedLead) {
  return [lead.borrower_first_name, lead.borrower_last_name].filter(Boolean).join(" ") || "—";
}

export function LeadDetailSlideOver({
  lead,
  open,
  onClose,
}: {
  lead: ClassifiedLead | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!lead) return null;

  const notes = [lead.notes_sidebar, lead.recent_notes].filter(Boolean).join("\n\n");
  const aiNotes = lead.notes_sidebar_ai_note?.trim() ?? "";

  return (
    <SlideOverShell open={open} onClose={onClose} title="Shape Lead File">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
          <h2 className="lo-heading text-2xl font-bold">{borrowerName(lead)}</h2>
            <div className="mt-2 flex flex-wrap gap-2 text-[13px]">
          {lead.borrower_email ? (
            <span className="lo-muted rounded-md border border-[var(--lo-border)] bg-white px-2 py-1">
              {lead.borrower_email}
            </span>
          ) : null}
          {lead.borrower_phone ? (
            <span className="lo-muted rounded-md border border-[var(--lo-border)] bg-white px-2 py-1">
              {lead.borrower_phone}
            </span>
          ) : null}
          {lead.assigned_loan_officer_name ? (
            <span className="lo-muted rounded-md border border-[var(--lo-border)] bg-white px-2 py-1">
              {lead.assigned_loan_officer_name}
            </span>
          ) : null}
        </div>
          </div>
          <span className="rounded-full bg-[var(--lo-accent-soft)] px-3 py-1 text-xs font-black text-[var(--lo-accent)]">
            {lead.displayStatus}
          </span>
        </div>

        <ActionButtons record={lead} />

        <div>
          <div className="mb-2 flex items-baseline justify-between gap-3 border-b border-[var(--lo-border)] pb-2">
            <h3 className="text-[13px] font-black uppercase tracking-wide">Turntimes</h3>
            <span className="text-xs text-muted-foreground">
              Lead workspace files are unfilled until converted to loan pipeline
            </span>
          </div>
          <ChevronTrack progress={NEUTRAL_MILESTONE_PROGRESS} compact />
        </div>

        <DetailGrid
          items={[
            ["Source", lead.source],
            ["Last Status Change", fmtRelative(lead.last_status_change_at ?? lead.shape_last_updated_at)],
            ["Trigger", lead.hotTouchpointLabel ?? lead.portal_status_raw ?? lead.status_raw],
            ["Contact Attempts", lead.contactAttempts],
            ["Verification Track", lead.verificationTrack],
            ["Current Phase", lead.leadPhaseLabel],
            ["Loan Purpose", lead.loan_purpose],
            ["Estimated Amount", formatMoney(lead.loan_amount_cents)],
            ["State", stateForRow(lead)],
            ["Portal Status", lead.portal_status_raw],
            ["Original Status", lead.status_raw],
          ]}
        />

        {aiNotes ? (
          <div className="rounded-lg border border-[var(--lo-border)] bg-white px-4 py-3">
            <strong className="lo-muted block text-[11px] font-black uppercase">AI Notes / Call Summary</strong>
            <p className="lo-heading mt-2 whitespace-pre-wrap text-sm leading-relaxed">{aiNotes}</p>
          </div>
        ) : null}

        <div
          className="rounded-lg border border-[var(--lo-border)] bg-white px-4 py-3"
        >
          <strong className="lo-muted block text-[11px] font-black uppercase">Shape Notes</strong>
          <p className="lo-heading mt-2 whitespace-pre-wrap text-sm leading-relaxed">
            {notes || "No notes synced from Shape yet."}
          </p>
        </div>
      </div>
    </SlideOverShell>
  );
}
