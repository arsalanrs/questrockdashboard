"use client";

import { useState, useTransition } from "react";

export function EscalateButton({
  loanId,
  borrowerName,
  onEscalated,
}: {
  loanId: string;
  borrowerName: string;
  onEscalated?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    setError(null);

    startTransition(async () => {
      try {
        const res = await fetch("/api/escalate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ loan_id: loanId, note }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          setError((j as { error?: string }).error ?? "Failed to escalate");
          return;
        }
        setNote("");
        setOpen(false);
        onEscalated?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors"
        style={{
          background: "rgba(239,68,68,0.12)",
          border: "1px solid rgba(239,68,68,0.25)",
          color: "#f87171",
        }}
      >
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
        </svg>
        Escalate
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="inline-flex flex-col gap-1.5 rounded-xl p-3"
      style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", minWidth: "240px" }}
    >
      <div className="text-xs font-semibold" style={{ color: "#f87171" }}>
        Escalating: {borrowerName}
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Add escalation note…"
        rows={2}
        className="w-full resize-none rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder:text-mutedForeground"
        style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", outline: "none" }}
        disabled={isPending}
        autoFocus
      />
      {error && <div className="text-xs" style={{ color: "#f87171" }}>{error}</div>}
      <div className="flex gap-1.5">
        <button
          type="submit"
          disabled={isPending || !note.trim()}
          className="flex-1 rounded-lg px-3 py-1 text-xs font-semibold transition-opacity disabled:opacity-40"
          style={{ background: "#ef4444", color: "#fff" }}
        >
          {isPending ? "Saving…" : "Submit"}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setNote(""); setError(null); }}
          className="rounded-lg px-3 py-1 text-xs font-medium"
          style={{ background: "rgba(255,255,255,0.06)", color: "var(--muted-foreground)" }}
          disabled={isPending}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export function ResolveButton({
  escalationId,
  onResolved,
}: {
  escalationId: string;
  onResolved?: () => void;
}) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      await fetch("/api/escalate", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ escalation_id: escalationId }),
      });
      onResolved?.();
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-opacity disabled:opacity-40"
      style={{
        background: "rgba(34,197,94,0.12)",
        border: "1px solid rgba(34,197,94,0.25)",
        color: "#4ade80",
      }}
    >
      {isPending ? "…" : "✓ Resolve"}
    </button>
  );
}
