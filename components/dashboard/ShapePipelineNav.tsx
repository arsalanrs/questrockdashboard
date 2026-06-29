import Link from "next/link";
import { cn } from "@/lib/cn";
import {
  SHAPE_VIEW_CATEGORIES,
  defaultViewIdForCategory,
  getViewsForCategory,
  type ShapeViewCategory,
} from "@/lib/shape-views";

type Props = {
  basePath: string;
  category: ShapeViewCategory;
  activeViewId: string;
  viewCounts: Record<string, number>;
  /** Extra query params to preserve (viewAs, lo, etc.) */
  extraParams?: Record<string, string | undefined>;
};

function buildHref(
  basePath: string,
  category: ShapeViewCategory,
  viewId: string,
  extra?: Record<string, string | undefined>,
) {
  const params = new URLSearchParams();
  params.set("category", category);
  params.set("view", viewId);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v) params.set(k, v);
    }
  }
  return `${basePath}?${params.toString()}`;
}

export function ShapePipelineNav({ basePath, category, activeViewId, viewCounts, extraParams }: Props) {
  const sidebarViews = getViewsForCategory(category);

  return (
    <div className="flex flex-col gap-3">
      <div className="lo-segment-track flex flex-wrap gap-1 rounded-lg p-1">
        {SHAPE_VIEW_CATEGORIES.map(({ key, label }) => {
          const isActive = category === key;
          const href = buildHref(
            basePath,
            key,
            defaultViewIdForCategory(key),
            extraParams,
          );
          const catViews = getViewsForCategory(key);
          const total = catViews.reduce((n, v) => n + (viewCounts[v.id] ?? 0), 0);
          return (
            <Link
              key={key}
              href={href}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
                isActive
                  ? "lo-segment-active shadow-sm"
                  : "lo-heading hover:bg-[var(--lo-accent-soft)]",
              )}
            >
              {label}
              <span className={cn("ml-1.5 tabular-nums text-xs", isActive ? "opacity-90" : "lo-muted")}>
                ({total})
              </span>
            </Link>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:gap-4">
        <nav
          className="lo-card flex shrink-0 flex-row gap-0.5 overflow-x-auto p-1.5 lg:w-56 lg:flex-col lg:overflow-visible"
          aria-label="Shape pipeline views"
        >
          {sidebarViews.map((view) => {
            const isActive = view.id === activeViewId;
            const count = viewCounts[view.id] ?? 0;
            const href = buildHref(basePath, category, view.id, extraParams);
            return (
              <Link
                key={view.id}
                href={href}
                className={cn(
                  "lo-pipeline-view-link flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap lg:whitespace-normal",
                  isActive && "lo-pipeline-view-active",
                  view.deferred && "opacity-60",
                )}
                title={view.deferred ? view.deferredReason : undefined}
              >
                <span className="leading-snug">{view.label}</span>
                <span className={cn("lo-pipeline-count", isActive && "lo-pipeline-count-active")}>
                  {view.deferred ? "—" : count}
                </span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
