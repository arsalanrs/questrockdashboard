import Link from "next/link";
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
    <div className="flex flex-col gap-4">
      {/* Record-type tabs */}
      <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-muted/30 p-1">
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
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-foreground text-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
              <span className={`ml-1.5 tabular-nums text-xs ${isActive ? "opacity-80" : "opacity-60"}`}>
                ({total})
              </span>
            </Link>
          );
        })}
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
        {/* Sidebar views */}
        <nav
          className="flex shrink-0 flex-row gap-1 overflow-x-auto lg:w-56 lg:flex-col lg:gap-0.5 lg:overflow-visible"
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
                className={`flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm transition-colors whitespace-nowrap lg:whitespace-normal ${
                  isActive
                    ? "bg-muted font-semibold text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                } ${view.deferred ? "opacity-60" : ""}`}
                title={view.deferred ? view.deferredReason : undefined}
              >
                <span className="leading-snug">{view.label}</span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${
                    isActive ? "bg-foreground/10" : "bg-muted"
                  }`}
                >
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
