/**
 * Semantic lead-source badge.
 * Colors match QuestRock's primary inbound channels.
 */

type SourceStyle = { className: string; short: string };

function getStyle(raw: string | null): SourceStyle {
  if (!raw) return { className: "source-badge source-badge-default", short: "—" };

  const s = raw.toLowerCase();

  if (s.includes("zoom")) {
    return { className: "source-badge source-badge-zoom", short: raw };
  }
  if (s.includes("inbound shape") || s.includes("shape call") || s.includes("shape phone")) {
    return { className: "source-badge source-badge-shape", short: "Shape Call" };
  }
  if (s.includes("questmail") || s.includes("quest mail")) {
    return { className: "source-badge source-badge-questmail", short: "QuestMail" };
  }
  if (s.includes("dscr")) {
    return { className: "source-badge source-badge-dscr", short: raw };
  }
  if (s.includes("web")) {
    return { className: "source-badge source-badge-web", short: "Web Lead" };
  }
  if (s.includes("referral")) {
    return { className: "source-badge source-badge-referral", short: "Referral" };
  }
  return { className: "source-badge source-badge-default", short: raw };
}

export function SourceBadge({
  source,
  className,
}: {
  source: string | null;
  className?: string;
}) {
  const { className: badgeClass, short } = getStyle(source);
  return (
    <span
      className={`${badgeClass} inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap leading-tight ${className ?? ""}`}
      title={source ?? undefined}
    >
      {short}
    </span>
  );
}
