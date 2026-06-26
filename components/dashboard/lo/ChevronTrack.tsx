"use client";

import { cn } from "@/lib/cn";
import {
  milestonesForVerificationTrack,
  type MilestoneProgressState,
  type TurntimePhaseKey,
} from "@/lib/shape-views/turntime-milestones";
import type { VerificationTrack } from "@/lib/shape-views/lo-dashboard";

type Props = {
  progress: Record<TurntimePhaseKey, MilestoneProgressState>;
  verificationTrack?: VerificationTrack | "All";
  compact?: boolean;
  clickable?: boolean;
  activePhase?: TurntimePhaseKey | "all";
  onPhaseClick?: (phase: TurntimePhaseKey) => void;
};

export function ChevronTrack({
  progress,
  verificationTrack = "All",
  compact = false,
  clickable = false,
  activePhase = "all",
  onPhaseClick,
}: Props) {
  const trackForMilestones =
    verificationTrack === "Pending" || verificationTrack === "Verification A"
      ? "Verification A"
      : verificationTrack === "Verification B"
        ? "Verification B"
        : verificationTrack;
  const milestones = milestonesForVerificationTrack(trackForMilestones);

  return (
    <div
      className={cn(
        "grid gap-2",
        compact ? "grid-flow-col auto-cols-[minmax(132px,1fr)] overflow-x-auto pb-2" : "grid-cols-2 md:grid-cols-4 xl:grid-cols-7",
      )}
    >
      {milestones.map((step) => {
        const state = progress[step.key] ?? "open";
        const active = activePhase === step.key;
        const className = cn(
          "chevron-step min-h-[94px] rounded-lg border px-3 py-3 text-left transition-all",
          compact && "min-w-[132px]",
          state === "complete" && "chevron-complete",
          state === "in-progress" && "chevron-progress",
          state === "stalled" && "chevron-stalled",
          state === "open" && "chevron-open",
          active && "ring-2 ring-[#2d67b1]/50",
          clickable && "cursor-pointer hover:-translate-y-0.5",
        );

        const inner = (
          <>
            <strong className="lo-heading block text-[12px]">{step.title}</strong>
            <span className="mt-1 block text-[11px] leading-snug text-[var(--lo-muted,#62716c)]">{step.detail}</span>
            <em className="mt-2 block text-[11px] font-extrabold not-italic text-[var(--lo-teal,#087f7a)]">{step.time}</em>
          </>
        );

        if (clickable) {
          return (
            <button
              key={step.key}
              type="button"
              className={className}
              onClick={() => onPhaseClick?.(step.key)}
            >
              {inner}
            </button>
          );
        }

        return (
          <article key={step.key} className={className}>
            {inner}
          </article>
        );
      })}
    </div>
  );
}
