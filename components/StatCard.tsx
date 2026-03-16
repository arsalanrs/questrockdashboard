import { cn } from "@/lib/cn";

export function StatCard({
  label,
  value,
  subtext,
  accent,
  href,
  className,
}: {
  label: string;
  value: React.ReactNode;
  subtext?: React.ReactNode;
  accent?: boolean;
  href?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "group relative flex min-h-[110px] flex-col justify-between overflow-hidden rounded-xl border p-4",
        "transition-all duration-200",
        className
      )}
      style={{
        background: "rgba(255,255,255,0.03)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        border: "1px solid rgba(255,255,255,0.07)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
      }}
    >
      {/* inner top-shine — glass highlight */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.10) 50%, transparent)" }}
      />
      {/* hover: yellow top glow */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        style={{ background: "linear-gradient(90deg, transparent, #E8FF00 50%, transparent)" }}
      />

      {/* top row: label + arrow */}
      <div className="flex items-start justify-between gap-2">
        <div className="text-[13px] font-medium leading-tight text-foreground">{label}</div>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors"
            style={{ background: "rgba(255,255,255,0.06)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <svg className="h-3.5 w-3.5 text-mutedForeground" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" />
            </svg>
          </a>
        ) : (
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full opacity-0 transition-opacity duration-200 group-hover:opacity-100"
            style={{ background: "rgba(255,255,255,0.06)" }}
          >
            <svg className="h-3.5 w-3.5 text-mutedForeground" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" />
            </svg>
          </div>
        )}
      </div>

      {/* bottom row: value + subtext */}
      <div className="mt-3">
        <div
          className={cn("text-3xl font-bold tabular-nums tracking-tight", !accent && "text-foreground")}
          style={accent ? { color: "#E8FF00" } : undefined}
        >
          {value}
        </div>
        {subtext ? (
          <div className="mt-0.5 text-xs text-mutedForeground">{subtext}</div>
        ) : null}
      </div>
    </div>
  );
}
