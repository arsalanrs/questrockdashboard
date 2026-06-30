"use client";

import { cn } from "@/lib/cn";

export type BentoRow = {
  id: string;
  name: string;
  meta: string;
  href?: string | null;
};

export type BentoCategory = {
  key: string;
  title: string;
  tone: "red" | "amber" | "green" | "muted";
  count: number;
  rows: BentoRow[];
};

const TONE_COUNT: Record<BentoCategory["tone"], string> = {
  red: "text-[var(--color-red)]",
  amber: "text-[var(--color-amber)]",
  green: "text-[var(--color-green)]",
  muted: "text-[var(--lo-text)]",
};

const TONE_DOT: Record<BentoCategory["tone"], string> = {
  red: "mgr-badge-red",
  amber: "mgr-badge-amber",
  green: "mgr-badge-green",
  muted: "mgr-badge-muted",
};

export function ManagerNotMovingBento({ categories }: { categories: BentoCategory[] }) {
  const visible = categories.filter((c) => c.count > 0);
  if (visible.length === 0) {
    return (
      <div className="mgr-bento-empty lo-muted px-6 py-10 text-center text-sm">
        All clear — no stuck or untouched leads in this window.
      </div>
    );
  }

  return (
    <div className="mgr-bento-grid">
      {visible.map((cat) => (
        <div key={cat.key} className="mgr-bento-card">
          <div className="mgr-bento-top">
            <div className="mgr-bento-title">
              <span className={cn("mgr-badge", TONE_DOT[cat.tone])}>
                <span className="mgr-badge-dot" aria-hidden />
              </span>
              {cat.title}
            </div>
            <div className={cn("mgr-bento-count", TONE_COUNT[cat.tone])}>{cat.count}</div>
          </div>
          <div className="mgr-bento-list">
            {cat.rows.length === 0 ? (
              <div className="lo-muted text-[11px]">No rows to show</div>
            ) : (
              cat.rows.map((row) => (
                <div key={row.id} className="mgr-bento-row">
                  {row.href ? (
                    <a href={row.href} target="_blank" rel="noopener noreferrer" className="mgr-bento-name hover:underline">
                      {row.name}
                    </a>
                  ) : (
                    <span className="mgr-bento-name">{row.name}</span>
                  )}
                  <span className="mgr-bento-meta">{row.meta}</span>
                </div>
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
