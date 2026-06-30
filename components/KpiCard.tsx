import { cn } from "@/lib/cn";
import { SparkLine } from "@/components/charts/SparkLine";

type KpiColor = "yellow" | "red" | "green" | "amber" | "blue" | "muted";

const STRIPE_CLASS: Record<KpiColor, string> = {
  yellow: "kpi-stripe-yellow",
  red: "kpi-stripe-red",
  green: "kpi-stripe-green",
  amber: "kpi-stripe-amber",
  blue: "kpi-stripe-blue",
  muted: "kpi-stripe-muted",
};

const VALUE_CLASS: Record<KpiColor, string> = {
  yellow: "kpi-value-yellow",
  red: "kpi-value-red",
  green: "kpi-value-green",
  amber: "kpi-value-amber",
  blue: "kpi-value-blue",
  muted: "kpi-value-muted",
};

export function KpiCard({
  label,
  value,
  sub,
  color = "muted",
  subColor,
  trend,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  color?: KpiColor;
  subColor?: "up" | "down" | "neutral";
  trend?: number[];
  className?: string;
}) {
  const subClass =
    subColor === "up"
      ? "kpi-sub-up"
      : subColor === "down"
        ? "kpi-sub-down"
        : "kpi-sub-neutral";

  return (
    <div className={cn("kpi-card lo-card", STRIPE_CLASS[color], className)}>
      <div className="kpi-card-label">{label}</div>
      <div className={cn("kpi-card-value", VALUE_CLASS[color])}>{value}</div>
      {trend && trend.length > 1 ? (
        <SparkLine data={trend} color="var(--lo-teal)" height={36} />
      ) : null}
      {sub != null ? <div className={cn("kpi-card-sub", subClass)}>{sub}</div> : null}
    </div>
  );
}
