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
    <div className={cn("stat-card lo-card group", className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="stat-card-label">{label}</div>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="stat-card-icon-btn"
            onClick={(e) => e.stopPropagation()}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" />
            </svg>
          </a>
        ) : (
          <div className="stat-card-icon-btn opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" />
            </svg>
          </div>
        )}
      </div>

      <div className="mt-3">
        <div className={cn("stat-card-value", accent && "stat-card-value-accent")}>{value}</div>
        {subtext ? <div className="stat-card-sub">{subtext}</div> : null}
      </div>
    </div>
  );
}
