/**
 * Semantic lead-source badge.
 * Colors match QuestRock's primary inbound channels.
 */

type SourceStyle = { bg: string; color: string; short: string };

function getStyle(raw: string | null): SourceStyle {
  if (!raw) return { bg: "rgba(255,255,255,0.06)", color: "hsl(215 14% 52%)", short: "—" };

  const s = raw.toLowerCase();

  // Zoom (highest intent — live call booked)
  if (s.includes("zoom")) {
    return { bg: "rgba(34,197,94,0.12)", color: "#22C55E", short: raw };
  }
  // Inbound Shape phone/call
  if (s.includes("inbound shape") || s.includes("shape call") || s.includes("shape phone")) {
    return { bg: "rgba(99,102,241,0.14)", color: "#818cf8", short: "Shape Call" };
  }
  // QuestMail
  if (s.includes("questmail") || s.includes("quest mail")) {
    return { bg: "rgba(232,255,0,0.10)", color: "#E8FF00", short: "QuestMail" };
  }
  // DSCR
  if (s.includes("dscr")) {
    return { bg: "rgba(168,85,247,0.12)", color: "#c084fc", short: raw };
  }
  // Web lead
  if (s.includes("web")) {
    return { bg: "rgba(96,165,250,0.12)", color: "#60A5FA", short: "Web Lead" };
  }
  // Referral
  if (s.includes("referral")) {
    return { bg: "rgba(34,197,94,0.08)", color: "#4ade80", short: "Referral" };
  }
  // Default
  return { bg: "rgba(255,255,255,0.06)", color: "hsl(215 14% 60%)", short: raw };
}

export function SourceBadge({
  source,
  className,
}: {
  source: string | null;
  className?: string;
}) {
  const { bg, color, short } = getStyle(source);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap leading-tight ${className ?? ""}`}
      style={{ background: bg, color }}
      title={source ?? undefined}
    >
      {short}
    </span>
  );
}
