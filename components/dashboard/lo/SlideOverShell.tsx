"use client";

import { cn } from "@/lib/cn";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

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
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="lo-dialog-backdrop fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-dialog-title"
        className={cn(
          "lo-detail-dialog relative flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl border",
          "max-h-[min(90vh,900px)] lo-detail-dialog-enter",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--lo-border)] px-5 py-3">
          <p id="detail-dialog-title" className="lo-accent-text text-xs font-bold uppercase tracking-wide">
            {title}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="lo-muted flex h-8 w-8 items-center justify-center rounded-lg text-lg leading-none hover:bg-[var(--lo-accent-soft)]"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
