"use client";

import { useRouter, useSearchParams } from "next/navigation";

type LoUser = {
  id: string;
  full_name: string | null;
  total: number;
  pipeline: number;
  prePipeline: number;
  unassignedCount?: never;
};

type UnassignedTab = {
  id: "unassigned";
  full_name: "Unassigned Leads";
  total: number;
  pipeline: number;
  prePipeline: number;
};

type SelectorItem = LoUser | UnassignedTab;

export function LoSelector({ items, currentLo }: { items: SelectorItem[]; currentLo: string }) {
  const router = useRouter();

  function select(id: string) {
    router.push(`/dashboard/admin-view?lo=${id}`);
  }

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => {
        const active = item.id === currentLo;
        const isUnassigned = item.id === "unassigned";
        return (
          <button
            key={item.id}
            onClick={() => select(item.id)}
            className={[
              "flex flex-col items-start rounded-lg border px-4 py-3 text-left transition-colors",
              active
                ? "lo-segment-active border-transparent shadow-sm"
                : isUnassigned && item.total > 0
                  ? "lo-card border-amber-500/60 bg-amber-50/80 hover:border-amber-500 dark:bg-amber-950/20"
                  : "lo-card lo-muted hover:border-[var(--lo-teal)]/40",
            ].join(" ")}
          >
            <span className={["text-sm font-semibold", active ? "" : "lo-heading"].join(" ")}>{item.full_name ?? "Unknown"}</span>
            <span className={["mt-0.5 text-xs", active ? "opacity-80" : "lo-muted"].join(" ")}>
              {item.total} total &middot; {item.pipeline} pipeline &middot; {item.prePipeline} pre-pipe
            </span>
          </button>
        );
      })}
    </div>
  );
}
