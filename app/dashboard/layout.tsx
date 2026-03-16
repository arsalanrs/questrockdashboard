import Image from "next/image";
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
    <div className="relative min-h-screen overflow-x-hidden" style={{ background: "#000" }}>

      {/* ── Ambient gradient orbs ─────────────────────────────────────── */}
      {/* Top-left yellow orb — gives a warm AI glow near the header */}
      <div
        className="orb"
        style={{
          top: "-120px",
          left: "-80px",
          width: "480px",
          height: "480px",
          background: "radial-gradient(circle, rgba(232,255,0,0.12) 0%, transparent 70%)",
        }}
      />
      {/* Top-right blue-violet orb — contrasts the yellow for depth */}
      <div
        className="orb"
        style={{
          top: "-60px",
          right: "-100px",
          width: "400px",
          height: "400px",
          background: "radial-gradient(circle, rgba(99,102,241,0.10) 0%, transparent 70%)",
        }}
      />
      {/* Mid-page subtle yellow drift — makes scrolling feel alive */}
      <div
        className="orb"
        style={{
          top: "45%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "700px",
          height: "300px",
          background: "radial-gradient(ellipse, rgba(232,255,0,0.04) 0%, transparent 70%)",
        }}
      />

      {/* ── Header — true glassmorphism ───────────────────────────────── */}
      <header
        className="sticky top-0 z-30 border-b"
        style={{
          background: "rgba(0, 0, 0, 0.55)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderColor: "rgba(255,255,255,0.07)",
        }}
      >
        {/* hairline yellow gradient under the header border */}
        <div
          className="absolute inset-x-0 bottom-0 h-px"
          style={{
            background: "linear-gradient(90deg, transparent 0%, rgba(232,255,0,0.3) 30%, rgba(232,255,0,0.3) 70%, transparent 100%)",
          }}
        />

        <div className="relative mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="relative h-11 w-[180px] shrink-0 rounded-lg overflow-hidden bg-white/90 px-2 flex items-center">
              <Image
                src="/questrock-logo.png"
                alt="QuestRock"
                width={170}
                height={44}
                className="object-contain object-left"
                priority
                unoptimized
              />
            </div>
            <div className="leading-tight hidden sm:block">
              <div className="text-[13px] font-semibold tracking-tight text-foreground">LO Command Center</div>
              <div className="text-[11px]" style={{ color: "#E8FF00", opacity: 0.8 }}>Questrock Mortgage</div>
            </div>
          </div>

          {/* Nav */}
          <nav className="flex items-center gap-0.5">
            <NavLink href="/dashboard/lo">Loan Officer</NavLink>
            {canViewManagerDashboard(appUser.role) ? <NavLink href="/dashboard/manager">Manager</NavLink> : null}
            {canViewProcessorDashboard(appUser.role) ? <NavLink href="/dashboard/processor">Processor</NavLink> : null}
            {canViewCloserDashboard(appUser.role) ? <NavLink href="/dashboard/closer">Closer</NavLink> : null}
            {canViewExecutiveDashboard(appUser.role) ? <NavLink href="/dashboard/executive">Executive</NavLink> : null}
            {canAccessAdmin(appUser.role) ? <NavLink href="/dashboard/admin-view">Team View</NavLink> : null}
            {canAccessAdmin(appUser.role) ? <NavLink href="/admin/import">Admin</NavLink> : null}
            <NotificationBell />
            <SignOutButton />
          </nav>
        </div>
      </header>

      {/* ── Page content ─────────────────────────────────────────────── */}
      <main className="relative z-10 mx-auto max-w-7xl px-6 py-6">{children}</main>
    </div>
  );
}
