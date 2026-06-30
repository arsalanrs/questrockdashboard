"use client";

import { useRouter } from "next/navigation";

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
    <div className="ops-selector-grid">
      {items.map((item) => {
        const active = item.id === currentLo;
        const isUnassigned = item.id === "unassigned";
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => select(item.id)}
            className={[
              "ops-selector-pill",
              active && "active",
              isUnassigned && item.total > 0 && !active ? "warn" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <span className="ops-name-main text-sm">{item.full_name ?? "Unknown"}</span>
            <span className="ops-name-sub mt-1 block text-xs">
              {item.total} total · {item.pipeline} pipeline · {item.prePipeline} pre-pipe
            </span>
          </button>
        );
      })}
    </div>
  );
}
