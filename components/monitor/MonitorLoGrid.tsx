"use client";

import Link from "next/link";

export type MonitorLoRow = {
  loName: string;
  loUserId: string | null;
  touchPct: number;
  touched: number;
  total: number;
};

const AVATAR_COLORS = [
  { bg: "var(--green-800)", text: "#F4EFDD" },
  { bg: "var(--green-700)", text: "#F4EFDD" },
  { bg: "var(--green-600)", text: "#F4EFDD" },
  { bg: "var(--green-500)", text: "#F4EFDD" },
  { bg: "var(--gold-600)", text: "#F4EFDD" },
  { bg: "var(--green-900)", text: "#F4EFDD" },
];

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function pctColor(pct: number, total: number): string {
  if (total === 0) return "var(--lo-muted)";
  if (pct >= 75) return "var(--color-green)";
  if (pct >= 50) return "var(--color-amber)";
  return "var(--color-red)";
}

export function MonitorLoGrid({ rows }: { rows: MonitorLoRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="lo-muted px-6 py-10 text-center text-sm">No activity recorded today yet.</div>
    );
  }

  return (
    <div className="mon-lo-grid">
      {rows.map((lo, i) => {
        const href = lo.loUserId
          ? `/dashboard/manager?lo=${encodeURIComponent(lo.loUserId)}`
          : `/dashboard/manager?lo=${encodeURIComponent(lo.loName)}`;
        const clr = pctColor(lo.touchPct, lo.total);
        const av = AVATAR_COLORS[i % AVATAR_COLORS.length];
        const flagged = lo.total > 0 && lo.touchPct < 75;

        return (
          <Link key={lo.loName} href={href} className={`mon-lo-card${flagged ? " flag" : ""}`}>
            <div className="mon-lo-card-top">
              <div className="mon-avatar" style={{ background: av.bg, color: av.text }}>
                {initials(lo.loName)}
              </div>
              <div>
                <div className="mon-lo-card-name">{lo.loName}</div>
                <div className="mon-lo-card-role">Loan Officer</div>
              </div>
            </div>
            <div className="mon-lo-stats">
              <span>
                Touched <b>{lo.touched}/{lo.total}</b>
              </span>
              <b style={{ color: clr }}>{lo.touchPct}%</b>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
