import { cn } from "@/lib/cn";

type Props = {
  eyebrow?: string;
  title: string;
  description?: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
};

export function DashboardPageHeader({
  eyebrow,
  title,
  description,
  meta,
  actions,
  className,
}: Props) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p className="lo-accent-text text-xs font-bold uppercase tracking-wide">{eyebrow}</p>
        ) : null}
        <h1 className="lo-heading text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description ? <p className="lo-muted mt-1 text-[13px]">{description}</p> : null}
      </div>
      {actions || meta ? (
        <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
          {actions}
          {meta ? <div className="lo-muted text-[11px] tabular-nums">{meta}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
