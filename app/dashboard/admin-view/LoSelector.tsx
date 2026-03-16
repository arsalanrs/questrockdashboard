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
                ? "border-foreground bg-foreground text-background"
                : isUnassigned && item.total > 0
                  ? "border-amber-500/60 bg-amber-50 text-foreground hover:border-amber-500 dark:bg-amber-950/20"
                  : "border-border bg-card text-foreground hover:border-foreground/40",
            ].join(" ")}
          >
            <span className="text-sm font-semibold">{item.full_name ?? "Unknown"}</span>
            <span className={["text-xs mt-0.5", active ? "text-background/70" : "text-mutedForeground"].join(" ")}>
              {item.total} total &middot; {item.pipeline} pipeline &middot; {item.prePipeline} pre-pipe
            </span>
          </button>
        );
      })}
    </div>
  );
}
