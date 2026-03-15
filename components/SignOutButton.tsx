"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function SignOutButton() {
  async function handleSignOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut({ scope: "local" });
    window.location.href = "/login";
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      className="rounded-md px-3 py-2 text-sm text-mutedForeground hover:bg-muted hover:text-foreground"
    >
      Sign out
    </button>
  );
}
