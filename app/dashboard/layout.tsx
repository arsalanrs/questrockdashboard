import { NavLink } from "@/components/NavLink";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { SignOutButton } from "@/components/SignOutButton";
import { requireCurrentUser } from "@/lib/current-user";
import {
  canAccessAdmin,
  canViewCloserDashboard,
  canViewExecutiveDashboard,
  canViewManagerDashboard,
  canViewProcessorDashboard,
} from "@/lib/permissions";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { appUser } = await requireCurrentUser();

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-foreground" />
            <div className="leading-tight">
              <div className="text-sm font-semibold">LO Command Center</div>
              <div className="text-xs text-mutedForeground">Questrock Mortgage Dashboard</div>
            </div>
          </div>
          <nav className="flex items-center gap-1">
            <NavLink href="/dashboard/lo">Loan Officer</NavLink>
            {canViewManagerDashboard(appUser.role) ? <NavLink href="/dashboard/manager">Manager</NavLink> : null}
            {canViewProcessorDashboard(appUser.role) ? <NavLink href="/dashboard/processor">Processor</NavLink> : null}
            {canViewCloserDashboard(appUser.role) ? <NavLink href="/dashboard/closer">Closer</NavLink> : null}
            {canViewExecutiveDashboard(appUser.role) ? <NavLink href="/dashboard/executive">Executive</NavLink> : null}
            <NavLink href="/dashboard/advisor">AI Advisor</NavLink>
            {canAccessAdmin(appUser.role) ? <NavLink href="/admin/import">Admin</NavLink> : null}
            <NotificationBell />
            <SignOutButton />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-6">{children}</main>
    </div>
  );
}

