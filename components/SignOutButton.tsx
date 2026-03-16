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
      className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-mutedForeground transition-all duration-150 hover:bg-muted hover:text-foreground"
    >
      Sign out
    </button>
  );
}
