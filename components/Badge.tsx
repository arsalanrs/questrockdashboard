import { cn } from "@/lib/cn";

export function Badge({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: "default" | "red" | "orange" | "yellow" | "green" | "muted";
}) {
  const styles: Record<string, string> = {
    default: "bg-muted text-foreground border-border",
    muted: "bg-background text-mutedForeground border-border",
    red: "bg-destructive text-destructiveForeground border-transparent",
    orange: "bg-amber-500 text-white border-transparent",
    yellow: "bg-yellow-400 text-black border-transparent",
    green: "bg-emerald-500 text-white border-transparent",
  };

  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", styles[variant])}>
      {children}
    </span>
  );
}

