"use client";

import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { formatCurrency } from "@/lib/metrics";

export type LoCardRow = {
  loId: string | null;
  name: string;
  active: number;
  stuck: number;
  closingThisWeek: number;
  mtdLoans: number;
  mtdVolumeCents: number;
  health: { label: string; color: "green" | "amber" | "red" };
  avatar: { bg: string; text: string };
  initials: string;
};

const PILL_CLASS = {
  green: "pill-green",
  amber: "pill-amber",
  red: "pill-red",
} as const;

export function WhoHasWhatTable({ rows }: { rows: LoCardRow[] }) {
  const router = useRouter();

  if (rows.length === 0) {
    return (
      <div className="lo-muted px-4 py-8 text-center text-[12px]">No active loan officers found.</div>
    );
  }

  return (
    <div className="lo-table-shell">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="lo-th">Loan Officer</th>
            <th className="lo-th text-right">Active</th>
            <th className="lo-th text-right">Stuck</th>
            <th className="lo-th text-right">Closing</th>
            <th className="lo-th text-right">Funded MTD</th>
            <th className="lo-th text-right">Volume MTD</th>
            <th className="lo-th text-right">Health</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.name}
              className={cn("lo-data-row", r.loId && "cursor-pointer")}
              onClick={r.loId ? () => router.push(`/dashboard/manager?lo=${encodeURIComponent(r.loId!)}`) : undefined}
              title={r.loId ? `View ${r.name}'s pipeline` : undefined}
            >
              <td className="lo-td">
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                    style={{ background: r.avatar.bg, color: r.avatar.text }}
                  >
                    {r.initials}
                  </div>
                  <span className="lo-heading font-semibold">{r.name}</span>
                </div>
              </td>
              <td className="lo-td text-right font-semibold tabular-nums">{r.active}</td>
              <td className="lo-td text-right tabular-nums">
                <span style={{ color: r.stuck > 0 ? "var(--color-red)" : "var(--lo-text)", fontWeight: r.stuck > 0 ? 600 : 400 }}>
                  {r.stuck}
                </span>
              </td>
              <td className="lo-td text-right tabular-nums">
                <span style={{ color: r.closingThisWeek > 0 ? "var(--color-amber)" : "var(--lo-text)" }}>
                  {r.closingThisWeek}
                </span>
              </td>
              <td className="lo-td text-right tabular-nums">
                <span style={{ color: r.mtdLoans > 0 ? "var(--color-green)" : "var(--lo-text)" }}>
                  {r.mtdLoans}
                </span>
              </td>
              <td className="lo-td text-right font-mono text-[12px] tabular-nums">
                {formatCurrency(r.mtdVolumeCents)}
              </td>
              <td className="lo-td text-right">
                <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold", PILL_CLASS[r.health.color])}>
                  {r.health.label}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
