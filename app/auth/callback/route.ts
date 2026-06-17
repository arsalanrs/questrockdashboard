import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canAccessDashboard } from "@/lib/dashboard-access";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const accessToken = searchParams.get("sso_at");
  const refreshToken = searchParams.get("sso_rt");
  const redirectTo = searchParams.get("redirectTo") || "/dashboard/lo";

  const supabase = await createSupabaseServerClient();

  if (code) {
    await supabase.auth.exchangeCodeForSession(code);
  } else if (accessToken && refreshToken) {
    await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user && !canAccessDashboard(user.email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent("QR Dashboard access is limited to authorized users.")}`
    );
  }

  return NextResponse.redirect(`${origin}${redirectTo}`);
}
