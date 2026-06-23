import type { ShapeViewRule } from "./types";
import { stalledDays } from "./views-loans";

export const ALL_RECORDS_VIEWS: ShapeViewRule[] = [
  {
    id: "recent-text-email",
    label: "Recent Text/Email Engagement",
    category: "all",
    recordTypes: "all",
    statuses: [],
    sort: { field: "last_status_change", dir: "desc" },
    deferred: true,
    deferredReason: "Requires Shape activity fields not yet in bulk export (Phase 1b).",
  },
  {
    id: "bb-help-requested",
    label: "Help Requested",
    category: "all",
    recordTypes: "all",
    statuses: ["Help Requested", "Launch File Help Requested"],
    sort: { field: "last_status_change", dir: "desc" },
  },
  {
    id: "bb-stalled-3d",
    label: "Stalled 3+ Days",
    category: "all",
    recordTypes: "all",
    statuses: [],
    sort: { field: "last_status_change", dir: "asc" },
    extraFilter: (row) => stalledDays(row, new Date(), 3),
  },
  {
    id: "bb-pitch-help",
    label: "Pitch Help",
    category: "all",
    recordTypes: "all",
    statuses: ["Pitch Help"],
    sort: { field: "last_status_change", dir: "desc" },
  },
  {
    id: "bb-second-voice",
    label: "Second Voice",
    category: "all",
    recordTypes: "all",
    statuses: ["Second Voice"],
    sort: { field: "last_status_change", dir: "desc" },
  },
  {
    id: "bb-dna",
    label: "DNA",
    category: "all",
    recordTypes: "all",
    statuses: ["DNA", "Did Not Advance"],
    sort: { field: "last_status_change", dir: "desc" },
  },
  {
    id: "bb-turndown",
    label: "Turndown",
    category: "all",
    recordTypes: "all",
    statuses: ["Turndown"],
    sort: { field: "last_status_change", dir: "desc" },
  },
  {
    id: "bb-bad-lead",
    label: "Bad Lead",
    category: "all",
    recordTypes: "all",
    statuses: ["Bad Lead", "Bad Contact Info"],
    sort: { field: "last_status_change", dir: "desc" },
  },
];

export function bindAllRecordsViewsToDate(now: Date): ShapeViewRule[] {
  return ALL_RECORDS_VIEWS.map((view) => {
    if (view.id !== "bb-stalled-3d") return view;
    return {
      ...view,
      extraFilter: (row) => stalledDays(row, now, 3),
    };
  });
}
