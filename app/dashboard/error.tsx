"use client";

import { useEffect } from "react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard error:", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg space-y-4 p-8">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <pre className="overflow-auto rounded-md border border-border bg-muted p-4 text-sm">
        {error.message}
      </pre>
      <p className="text-xs text-mutedForeground">
        If you just signed in, ensure Supabase migrations are applied and your user exists in the{" "}
        <code className="rounded bg-muted px-1">public.users</code> table with the correct role.
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90"
      >
        Try again
      </button>
    </div>
  );
}
