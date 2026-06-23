"use client";

import { useState } from "react";

export function DismissReminderButton({ loanId }: { loanId: string }) {
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);

  if (hidden) return null;

  async function dismiss() {
    setBusy(true);
    try {
      const res = await fetch("/api/reminders/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loanId }),
      });
      if (res.ok) setHidden(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={dismiss}
      className="rounded border border-green-500/30 px-2 py-0.5 text-[10px] text-green-400 hover:bg-green-500/10 disabled:opacity-50"
    >
      ✓ Called
    </button>
  );
}
