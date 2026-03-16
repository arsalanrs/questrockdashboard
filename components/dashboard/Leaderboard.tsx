"use client";

type LoStats = {
  name: string;
  creditPulls: number;
  appraisalsOrdered: number;
  closedLoans: number;
  fundedVolumeCents: number;
};

function fmt$(cents: number) {
  if (!cents) return "$0";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

export function Leaderboard({ data }: { data: LoStats[] }) {
  const sorted = [...data].sort((a, b) => b.fundedVolumeCents - a.fundedVolumeCents);

  if (sorted.length === 0) {
    return (
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">LO Leaderboard</h3>
        <div className="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-mutedForeground">
          No loan officer data available.
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">LO Leaderboard</h3>
        <div
        className="overflow-hidden rounded-xl"
        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr
              className="text-left text-[11px] uppercase tracking-widest text-mutedForeground"
              style={{ background: "rgba(255,255,255,0.05)" }}
            >
              <th className="px-3 py-2.5 w-8">#</th>
              <th className="px-3 py-2.5">Loan Officer</th>
              <th className="px-3 py-2.5 text-right">Credit Pulls</th>
              <th className="px-3 py-2.5 text-right">Appraisals</th>
              <th className="px-3 py-2.5 text-right">Closed</th>
              <th className="px-3 py-2.5 text-right">Funded Volume</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {sorted.map((lo, i) => (
              <tr
                key={lo.name}
                className="transition-colors"
                style={i === 0
                  ? { background: "rgba(232,255,0,0.05)" }
                  : undefined}
                onMouseEnter={e => (e.currentTarget.style.background = "hsl(220 10% 14%)")}
                onMouseLeave={e => (e.currentTarget.style.background = i === 0 ? "rgba(232,255,0,0.05)" : "")}
              >
                <td className="px-3 py-2.5 text-xs tabular-nums font-bold"
                  style={i === 0 ? { color: "#E8FF00" } : { color: "hsl(215 14% 52%)" }}>
                  {i + 1}
                </td>
                <td className="px-3 py-2.5 font-medium"
                  style={i === 0 ? { color: "#E8FF00" } : undefined}>
                  {lo.name}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{lo.creditPulls}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{lo.appraisalsOrdered}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{lo.closedLoans}</td>
                <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{fmt$(lo.fundedVolumeCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
