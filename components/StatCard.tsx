import { cn } from "@/lib/cn";

export function StatCard({
  label,
  value,
  subtext,
  className,
}: {
  label: string;
  value: React.ReactNode;
  subtext?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-border bg-card p-4 text-cardForeground", className)}>
      <div className="text-xs text-mutedForeground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      {subtext ? <div className="mt-1 text-xs text-mutedForeground">{subtext}</div> : null}
    </div>
  );
}

