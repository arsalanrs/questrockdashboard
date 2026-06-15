import type { AppRole } from "@/lib/current-user";

export function canViewManagerDashboard(role: AppRole) {
  return role === "manager" || role === "executive" || role === "admin";
}

export function canViewExecutiveDashboard(role: AppRole) {
  return role === "executive" || role === "admin";
}

export function canViewProcessorDashboard(role: AppRole) {
  return role === "processor" || role === "manager" || role === "executive" || role === "admin";
}

export function canViewCloserDashboard(role: AppRole) {
  return role === "closer" || role === "manager" || role === "executive" || role === "admin";
}

export function canAccessAdmin(role: AppRole) {
  return role === "executive" || role === "admin";
}

export function canViewMonitor(role: AppRole) {
  return role === "manager" || role === "executive" || role === "admin";
}

