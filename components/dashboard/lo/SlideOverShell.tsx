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
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        />
      ) : null}
      <aside
        aria-hidden={!open}
        className={cn(
          "lo-slide-over fixed right-0 top-0 z-50 flex h-full w-full max-w-3xl flex-col border-l shadow-2xl transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex items-center justify-between border-b border-[var(--lo-border)] px-5 py-3">
          <p className="lo-accent-text text-xs font-bold uppercase tracking-wide">{title}</p>
          <button
            type="button"
            onClick={onClose}
            className="lo-muted rounded-lg px-2 py-1 text-sm hover:bg-[var(--lo-accent-soft)]"
          >
            Close
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </aside>
    </>
  );
}
