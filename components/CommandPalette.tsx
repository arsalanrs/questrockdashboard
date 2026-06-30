"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";

type CommandItem = {
  id: string;
  label: string;
  href?: string;
  keywords?: string[];
  group: string;
};

const COMMANDS: CommandItem[] = [
  { id: "lo", label: "Loan Officer Dashboard", href: "/dashboard/lo", group: "Navigate", keywords: ["pipeline", "leads"] },
  { id: "manager", label: "Manager Pipeline", href: "/dashboard/manager", group: "Navigate", keywords: ["team"] },
  { id: "monitor", label: "Monitor — Exceptions", href: "/dashboard/monitor", group: "Navigate", keywords: ["sla", "alerts"] },
  { id: "processor", label: "Processor Queue", href: "/dashboard/processor", group: "Navigate" },
  { id: "closer", label: "Closer Queue", href: "/dashboard/closer", group: "Navigate", keywords: ["closing"] },
  { id: "executive", label: "Executive Dashboard", href: "/dashboard/executive", group: "Navigate", keywords: ["signals", "ai"] },
  { id: "concierge", label: "Concierge Desk", href: "/dashboard/concierge", group: "Navigate", keywords: ["phone", "lookup"] },
  { id: "advisor", label: "AI Guideline Advisor", href: "/dashboard/advisor", group: "Navigate", keywords: ["chat", "guidelines"] },
  { id: "team", label: "Team View (Admin)", href: "/dashboard/admin-view", group: "Navigate" },
  { id: "admin", label: "Admin Import & Sync", href: "/admin/import", group: "Navigate", keywords: ["sync", "csv"] },
  {
    id: "shape",
    label: "Open Shape CRM",
    href: "https://secure.setshape.com/",
    group: "External",
    keywords: ["crm", "leads"],
  },
];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMANDS;
    return COMMANDS.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.group.toLowerCase().includes(q) ||
        c.keywords?.some((k) => k.includes(q)),
    );
  }, [query]);

  const run = useCallback(
    (item: CommandItem) => {
      setOpen(false);
      setQuery("");
      if (!item.href) return;
      if (item.href.startsWith("http")) {
        window.open(item.href, "_blank", "noopener,noreferrer");
      } else {
        router.push(item.href);
      }
    },
    [router],
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        setActiveIndex(0);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!open) return null;

  const grouped = filtered.reduce<Record<string, CommandItem[]>>((acc, item) => {
    (acc[item.group] ??= []).push(item);
    return acc;
  }, {});

  let flatIndex = 0;

  return (
    <div
      className="lo-dialog-backdrop fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4"
      onClick={() => setOpen(false)}
    >
      <div
        className="lo-detail-dialog lo-card w-full max-w-lg overflow-hidden rounded-xl border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-[var(--lo-border)] p-3">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages and actions…"
            className="lo-input w-full rounded-lg px-3 py-2 text-sm outline-none"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => Math.max(i - 1, 0));
              }
              if (e.key === "Enter" && filtered[activeIndex]) {
                run(filtered[activeIndex]);
              }
            }}
          />
          <p className="lo-muted mt-1.5 px-1 text-[10px]">↑↓ navigate · Enter open · Esc close</p>
        </div>
        <div className="max-h-[320px] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <p className="lo-muted py-6 text-center text-sm">No matches</p>
          ) : (
            Object.entries(grouped).map(([group, items]) => (
              <div key={group} className="mb-2">
                <p className="lo-muted px-2 py-1 text-[10px] font-bold uppercase tracking-wider">{group}</p>
                {items.map((item) => {
                  const idx = flatIndex++;
                  const active = idx === activeIndex;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={cn(
                        "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors",
                        active ? "bg-[var(--lo-accent-soft)] text-[var(--lo-text)]" : "lo-heading hover:bg-[var(--lo-surface-muted)]",
                      )}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => run(item)}
                    >
                      <span className="font-medium">{item.label}</span>
                      {item.href?.startsWith("http") ? (
                        <span className="lo-muted text-[10px]">↗</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
