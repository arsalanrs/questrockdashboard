import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { createServerClient } from "@supabase/ssr";
import { canAccessDashboard } from "@/lib/dashboard-access";

const PROTECTED_PREFIXES = ["/dashboard", "/admin"];

function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { url, key };
}

export async function middleware(request: NextRequest) {
  const env = getSupabaseEnv();
  if (!env) {
    return NextResponse.json(
      { error: "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in environment" },
      { status: 503 }
    );
  }

  const response = await updateSession(request);

  const pathname = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!isProtected) return response;

  const supabase = createServerClient(env.url, env.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(url);
  }

  if (!canAccessDashboard(user.email)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set(
      "error",
      "QR Dashboard access is limited to authorized users."
    );
    const denied = NextResponse.redirect(url);
    const signOutClient = createServerClient(env.url, env.key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            denied.cookies.set(name, value, options)
          );
        },
      },
    });
    await signOutClient.auth.signOut();
    return denied;
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

