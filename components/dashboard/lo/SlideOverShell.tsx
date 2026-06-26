"use client";

import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

export function SlideOverShell({
  open,
  onClose,
  children,
  title,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title: string;
}) {
  return (
    <>
      {open ? (
        <button
          type="button"
          aria-label="Close panel backdrop"
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        />
      ) : null}
      <aside
        aria-hidden={!open}
        className={cn(
          "fixed right-0 top-0 z-50 flex h-full w-full max-w-3xl flex-col border-l shadow-2xl transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "translate-x-full",
        )}
        style={{
          borderColor: "rgba(255,255,255,0.1)",
          background: "rgba(8,12,10,0.96)",
          backdropFilter: "blur(24px)",
        }}
      >
        <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
          <p className="text-xs font-bold uppercase tracking-wide text-[#8ee0d4]">{title}</p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-muted-foreground hover:bg-white/10 hover:text-foreground"
          >
            Close
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </aside>
    </>
  );
}
