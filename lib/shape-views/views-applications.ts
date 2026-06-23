import type { ShapeViewRule } from "./types";

export const APPLICATIONS_VIEWS: ShapeViewRule[] = [
  {
    id: "pre-app-sent",
    label: "Pre-App Sent",
    category: "Applications",
    recordTypes: ["Applications"],
    statuses: ["App Sent"],
    portalStatuses: ["App Sent"],
    sort: { field: "conversion", dir: "desc" },
  },
  {
    id: "pre-app-started",
    label: "Pre-App Started",
    category: "Applications",
    recordTypes: ["Applications"],
    statuses: ["App Started", "Portal Registration Complete"],
    portalStatuses: ["App Started", "Portal Registration Complete"],
    sort: { field: "conversion", dir: "desc" },
  },
  {
    id: "pre-app-completed",
    label: "Pre-App Completed",
    category: "Applications",
    recordTypes: ["Applications"],
    statuses: ["App Completed"],
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
