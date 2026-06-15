import { cn } from "@/lib/cn";

type KpiColor = "yellow" | "red" | "green" | "amber" | "blue" | "muted";

const VALUE_COLORS: Record<KpiColor, string> = {
  yellow: "#E8FF00",
  red:    "#FF4B4B",
  green:  "#22C55E",
  amber:  "#F59E0B",
  blue:   "#60A5FA",
  muted:  "hsl(210 20% 96%)",
};

const STRIPE_COLORS: Record<KpiColor, string> = {
  yellow: "#E8FF00",
  red:    "#FF4B4B",
  green:  "#22C55E",
  amber:  "#F59E0B",
  blue:   "#60A5FA",
  muted:  "rgba(255,255,255,0.12)",
};

export function KpiCard({
  label,
  value,
  sub,
  color = "muted",
  subColor,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  color?: KpiColor;
  subColor?: "up" | "down" | "neutral";
  className?: string;
}) {
  const subStyle =
    subColor === "up"
      ? { color: "#22C55E" }
      : subColor === "down"
      ? { color: "#FF4B4B" }
      : { color: "hsl(215 14% 50%)" };

  return (
    <div
      className={cn(
        "relative flex flex-col gap-1.5 overflow-hidden rounded-[14px] p-4 transition-all duration-150",
        "border hover:border-white/[0.12]",
        className,
      )}
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.07)",
      }}
    >
      {/* 2px color stripe at top */}
      <div
        className="absolute inset-x-0 top-0 h-[2px]"
        style={{ background: STRIPE_COLORS[color] }}
      />

      <div className="text-[11px] font-medium tracking-wide" style={{ color: "hsl(215 14% 52%)" }}>
        {label}
      </div>

      <div
        className="text-[28px] font-bold leading-none tabular-nums tracking-tight"
        style={{ color: VALUE_COLORS[color] }}
      >
        {value}
      </div>

      {sub != null && (
        <div className="text-[11px] font-medium" style={subStyle}>
          {sub}
        </div>
      )}
    </div>
  );
}
