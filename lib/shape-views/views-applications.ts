import type { ShapeViewRule } from "./types";
import { GREEN_LEAD_STATUSES } from "./lo-dashboard";
import { isPreApplicationStatus } from "./record-type-normalize";

export const APPLICATIONS_VIEWS: ShapeViewRule[] = [
  {
    id: "green-leads-pos",
    label: "Green Leads (POS)",
    category: "Applications",
    recordTypes: ["Leads", "Applications"],
    statuses: [...GREEN_LEAD_STATUSES],
    sort: { field: "conversion", dir: "desc" },
  },
  {
    id: "all-pre-applications-pos",
    label: "All Pre-Applications (POS)",
    category: "Applications",
    recordTypes: ["Applications"],
    statuses: [
      "App Sent",
      "App Started",
      "App Completed",
      "Portal Registration Complete",
      "Verification Docs Requested",
      "Verification Docs Received",
      "Pre-Application Sent",
      "Pre-Application Started",
      "Pre-Application Completed",
    ],
    portalStatuses: [
      "App Sent",
      "App Started",
      "App Completed",
      "Portal Registration Complete",
    ],
    sort: { field: "conversion", dir: "desc" },
  },
  {
    id: "pre-app-sent",
    label: "Pre-App Sent",
    category: "Applications",
    recordTypes: ["Applications"],
    statuses: ["App Sent", "Pre-Application Sent"],
    portalStatuses: ["App Sent"],
    sort: { field: "conversion", dir: "desc" },
  },
  {
    id: "pre-app-started",
    label: "Pre-App Started",
    category: "Applications",
    recordTypes: ["Applications"],
    statuses: ["App Started", "Portal Registration Complete", "Pre-Application Started"],
    portalStatuses: ["App Started", "Portal Registration Complete"],
    sort: { field: "conversion", dir: "desc" },
  },
  {
    id: "pre-app-completed",
    label: "Pre-App Completed",
    category: "Applications",
    recordTypes: ["Applications"],
    statuses: ["App Completed", "Pre-Application Completed"],
    portalStatuses: ["App Completed"],
    sort: { field: "conversion", dir: "desc" },
  },
  {
    id: "docs-requested",
    label: "Docs Requested",
    category: "Applications",
    recordTypes: ["Applications"],
    statuses: ["Verification Docs Requested"],
    sort: { field: "conversion", dir: "desc" },
  },
  {
    id: "docs-received",
    label: "Docs Received",
    category: "Applications",
    recordTypes: ["Applications"],
    statuses: ["Verification Docs Received"],
    sort: { field: "conversion", dir: "desc" },
  },
];

/** Shape POS view also surfaces Leads with portal-style statuses — use for diagnostics. */
export function matchesAllPreApplicationsPos(row: {
  record_type?: string | null;
  status_raw?: string | null;
  portal_status_raw?: string | null;
}): boolean {
  const rt = row.record_type?.trim();
  if (rt !== "Applications" && rt !== "Leads") return false;
  return isPreApplicationStatus(row.status_raw, row.portal_status_raw);
}
