import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AppRole = "executive" | "manager" | "loan_officer" | "processor" | "closer" | "admin";

export const getCurrentUser = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) throw error;
  if (!user) return { authUser: null, appUser: null };

  const { data: appUser, error: appUserError } = await supabase
    .from("users")
    .select("id,email,full_name,role,primary_team_id,is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (appUserError) {
    console.error("getCurrentUser profile error:", appUserError.message);
    redirect(`/login?error=${encodeURIComponent("Database setup required. Run Supabase migrations (see supabase/migrations). " + appUserError.message)}`);
  }
  return { authUser: user, appUser };
});

export async function requireCurrentUser() {
  const { authUser, appUser } = await getCurrentUser();
  if (!authUser) redirect("/login");
  if (!appUser || !appUser.is_active) redirect("/login");
  return { authUser, appUser };
}

