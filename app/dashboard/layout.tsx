import { DashboardShell } from "@/components/DashboardShell";
import { requireCurrentUser } from "@/lib/current-user";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { appUser } = await requireCurrentUser();
  return <DashboardShell appUser={appUser}>{children}</DashboardShell>;
}
