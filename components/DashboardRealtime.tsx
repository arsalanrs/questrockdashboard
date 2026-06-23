"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

export function DashboardRealtime({ userId }: { userId: string }) {
  const router = useRouter();

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return;

    const supabase = createBrowserClient(url, key);
    const channel = supabase
      .channel(`dashboard-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "loans", filter: `assigned_loan_officer_user_id=eq.${userId}` },
        () => router.refresh(),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "conditions" }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "loan_notes" }, () => router.refresh())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, router]);

  return null;
}
