import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/DashboardShell";
import { requireCurrentUser } from "@/lib/current-user";
import { canAccessAdmin } from "@/lib/permissions";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { appUser } = await requireCurrentUser();
  if (!canAccessAdmin(appUser.role)) notFound();

  return (
    <DashboardShell appUser={appUser} wideMain>
      {children}
    </DashboardShell>
  );
}
