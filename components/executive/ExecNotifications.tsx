"use client";

import { useState } from "react";

export type ExecNotification = {
  id: string;
  kind: "hot_signal" | "morning_digest" | string;
  title: string;
  body: string | null;
  createdAt: string;
  readAt: string | null;
  signalId: string | null;
  payload: Record<string, unknown>;
};

function formatRelative(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function renderBody(md: string) {
  // tiny markdown: bold segments inside **…** and line breaks
  return md.split("\n").map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g).map((seg, j) => {
      if (seg.startsWith("**") && seg.endsWith("**")) {
        return (
          <strong key={j} className="text-foreground">
            {seg.slice(2, -2)}
          </strong>
        );
      }
      return <span key={j}>{seg}</span>;
    });
    return (
      <div key={i} className="leading-snug">
        {parts.length ? parts : <span>&nbsp;</span>}
      </div>
    );
  });
}

export function ExecNotifications({ initial }: { initial: ExecNotification[] }) {
  const [notifications, setNotifications] = useState(initial);
  const [open, setOpen] = useState(false);
  const unread = notifications.filter((n) => !n.readAt).length;

  async function markAllRead() {
    const ids = notifications.filter((n) => !n.readAt).map((n) => n.id);
    if (!ids.length) return;
    setNotifications((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })));
    await fetch("/api/notifications/mark-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }).catch(() => undefined);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs hover:bg-muted"
      >
        Notifications
        {unread > 0 && (
          <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 z-40 mt-2 w-96 max-w-[90vw] overflow-hidden rounded-lg border border-border bg-background shadow-xl"
          onMouseLeave={() => setOpen(false)}
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <div className="text-sm font-medium">Notifications</div>
            <button
              type="button"
              onClick={markAllRead}
              className="text-[11px] text-mutedForeground hover:text-foreground"
              disabled={unread === 0}
            >
              Mark all read
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto divide-y divide-border">
            {notifications.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-mutedForeground">You&apos;re all caught up.</div>
            )}
            {notifications.slice(0, 30).map((n) => (
              <div
                key={n.id}
                className={n.readAt ? "bg-background px-3 py-2" : "bg-muted/30 px-3 py-2"}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-medium text-foreground">{n.title}</div>
                  <div className="shrink-0 text-[10px] text-mutedForeground">{formatRelative(n.createdAt)}</div>
                </div>
                {n.body ? <div className="mt-1 text-xs text-mutedForeground">{renderBody(n.body)}</div> : null}
                <div className="mt-1 text-[10px] uppercase tracking-wide text-mutedForeground">{n.kind}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
