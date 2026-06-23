import type { ShapeViewRule } from "./types";

export const LEADS_VIEWS: ShapeViewRule[] = [
  {
    id: "new-leads-follow-up",
    label: "New Leads & Follow-Up Queue",
    category: "Leads",
    recordTypes: ["Leads"],
    statuses: ["New Lead", "New Lead - Reapplied"],
    sort: { field: "created", dir: "asc" },
  },
  {
    id: "long-term-nurture",
    label: "Long Term Nurture",
    category: "Leads",
    recordTypes: ["Leads"],
    statuses: ["Long Term Nurture"],
    sort: { field: "last_status_change", dir: "desc" },
  },
];
