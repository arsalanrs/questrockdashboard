"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SyncButton() {
  const [status, setStatus] = useState<"idle" | "syncing" | "done" | "error">("idle");
  const [lastSync, setLastSync] = useState<string | null>(null);
  const router = useRouter();

  async function handleSync() {
    setStatus("syncing");
    try {
      await Promise.allSettled([
        fetch("/api/sync/shape",      { method: "POST" }),
        fetch("/api/sync/lendingpad", { method: "POST" }),
      ]);
      const t = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
      setLastSync(t);
      setStatus("done");
      router.refresh();
      setTimeout(() => setStatus("idle"), 4000);
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 4000);
    }
  }

  return (
    <button
      onClick={handleSync}
      disabled={status === "syncing"}
      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-all"
      style={{
        background:
          status === "done"  ? "rgba(34,197,94,0.12)"  :
          status === "error" ? "rgba(255,75,75,0.12)"   :
          status === "syncing" ? "rgba(232,255,0,0.08)" :
          "rgba(255,255,255,0.06)",
        color:
          status === "done"  ? "#22C55E" :
          status === "error" ? "#FF4B4B" :
          status === "syncing" ? "#E8FF00" :
          "hsl(215 14% 60%)",
        border: "1px solid rgba(255,255,255,0.08)",
        cursor: status === "syncing" ? "wait" : "pointer",
      }}
      title={lastSync ? `Last synced at ${lastSync}` : "Sync Shape & LendingPad"}
    >
      {status === "syncing" ? (
        <>
          <svg className="animate-spin" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" d="M4 12a8 8 0 018-8" />
          </svg>
          Syncing…
        </>
      ) : status === "done" ? (
        <>
          <svg width="11" height="11" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          Synced {lastSync}
        </>
      ) : (
        <>
          <svg width="11" height="11" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
          Sync
        </>
      )}
    </button>
  );
}
