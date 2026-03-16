"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href + "/");

  return (
    <Link
      href={href}
      className={cn(
        "relative rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all duration-150",
        active
          ? "font-semibold"
          : "text-mutedForeground hover:text-foreground"
      )}
      style={
        active
          ? {
              color: "#E8FF00",
              background: "rgba(232,255,0,0.08)",
            }
          : undefined
      }
    >
      {children}
      {active && (
        <span
          className="absolute inset-x-3 bottom-0.5 h-[2px] rounded-full"
          style={{ background: "#E8FF00" }}
        />
      )}
    </Link>
  );
}
