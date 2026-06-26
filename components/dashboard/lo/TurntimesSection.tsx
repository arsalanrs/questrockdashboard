"use client";

import { NEUTRAL_MILESTONE_PROGRESS } from "@/lib/shape-views/turntime-milestones";
import type { TurntimePhaseKey } from "@/lib/shape-views/turntime-milestones";
import { ChevronTrack } from "./ChevronTrack";

type Props = {
  activePhase: TurntimePhaseKey | "all";
  onPhaseClick: (phase: TurntimePhaseKey) => void;
};

export function TurntimesSection({ activePhase, onPhaseClick }: Props) {
  return (
    <section className="grid min-w-0 gap-3">
      <div className="lo-card px-5 py-4">
        <h2 className="lo-heading text-lg font-semibold">Company Leads Policy</h2>
        <p className="lo-muted mt-2 text-sm leading-relaxed">
          Treat every lead with urgency. The client walked into your shop, do not look away and ignore them.
          Go up and help them.
        </p>
        <ol className="lo-muted mt-3 list-decimal space-y-1 pl-5 text-sm">
          <li>Initial contact attempt within 30 seconds, no later than 2 minutes.</li>
          <li>Call twice per day for 3 days.</li>
          <li>
            Leads may be reassigned automatically if there is no contact within 3 days, or sooner if there
            are no contact attempts.
          </li>
        </ol>
      </div>

      <div className="lo-card px-5 py-4">
        <div className="mb-3 flex items-baseline justify-between gap-3 border-b border-[var(--lo-border)] pb-3">
          <h3 className="lo-heading text-[13px] font-black uppercase tracking-wide">General Turntimes</h3>
          <span className="lo-muted text-xs">Shared service level expectations · click a phase to filter leads</span>
        </div>
        <ChevronTrack
          progress={NEUTRAL_MILESTONE_PROGRESS}
          verificationTrack="All"
          clickable
          activePhase={activePhase}
          onPhaseClick={onPhaseClick}
        />
      </div>
    </section>
  );
}
