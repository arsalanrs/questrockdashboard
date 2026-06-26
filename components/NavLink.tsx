"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href + "/");

  return (
    <Link href={href} className={cn("nav-link relative rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all duration-150", active && "nav-link-active font-semibold")}>
      {children}
      {active ? <span className="nav-link-indicator absolute inset-x-3 bottom-0.5 h-[2px] rounded-full" /> : null}
    </Link>
  );
}
