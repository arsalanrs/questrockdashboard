"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function signInWithPassword(formData: FormData) {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const redirectTo = String(formData.get("redirectTo") || "/dashboard/lo");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}&redirectTo=${encodeURIComponent(redirectTo)}`);

  redirect(redirectTo);
}

export async function sendMagicLink(formData: FormData) {
  const email = String(formData.get("email") || "").trim();
  const redirectTo = String(formData.get("redirectTo") || "/dashboard/lo");
  const origin = headers().get("origin") ?? "";

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback?redirectTo=${encodeURIComponent(redirectTo)}` },
  });

  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}&redirectTo=${encodeURIComponent(redirectTo)}`);
  redirect(`/login?checkEmail=1&redirectTo=${encodeURIComponent(redirectTo)}`);
}

