"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/current-user";
import { canAccessAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

async function requireAdmin() {
  const { appUser } = await requireCurrentUser();
  if (!canAccessAdmin(appUser.role)) notFound();
  return appUser;
}

async function getOrCreateAuthUser(params: { email: string; fullName: string; password: string }) {
  const admin = createSupabaseAdminClient();

  const created = await admin.auth.admin.createUser({
    email: params.email,
    password: params.password,
    email_confirm: true,
    user_metadata: { full_name: params.fullName },
  });

  if (created.error && !String(created.error.message).toLowerCase().includes("already")) {
    throw created.error;
  }

  if (created.data.user) return created.data.user;

  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listed.error) throw listed.error;
  const hit = listed.data.users.find((u) => (u.email ?? "").toLowerCase() === params.email.toLowerCase());
  if (!hit) throw new Error(`Could not find auth user for ${params.email}`);
  return hit;
}

export async function seedInitialOrg() {
  await requireAdmin();
  const admin = createSupabaseAdminClient();

  const password = "ChangeMe!123";

  const staff = [
    { full_name: "Bill Medley", role: "executive", email: "bill.medley@example.invalid" },
    { full_name: "Ray Conway", role: "executive", email: "ray.conway@example.invalid" },
    { full_name: "Nikk Smith", role: "executive", email: "nikk.smith@example.invalid" },
    { full_name: "Bastian Johnston", role: "manager", email: "bastian.johnston@example.invalid" },
    { full_name: "Stephen Curry", role: "loan_officer", email: "stephen.curry@example.invalid" },
    { full_name: "Tyler Johnson", role: "loan_officer", email: "tyler.johnson@example.invalid" },
    { full_name: "Jessica Sherard", role: "loan_officer", email: "jessica.sherard@example.invalid" },
    { full_name: "Kerry Rockey", role: "processor", email: "kerry.rockey@example.invalid" },
    { full_name: "Steve Metz", role: "closer", email: "steve.metz@example.invalid" },
  ] as const;

  const ids: Record<string, string> = {};
  for (const u of staff) {
    const authUser = await getOrCreateAuthUser({ email: u.email, fullName: u.full_name, password });
    ids[u.full_name] = authUser.id;

    const { error } = await admin
      .from("users")
      .upsert({ id: authUser.id, email: u.email, full_name: u.full_name, role: u.role, is_active: true }, { onConflict: "id" });
    if (error) throw error;
  }

  // Team: T Rex (managed by Bastian)
  const { data: team, error: teamErr } = await admin
    .from("teams")
    .upsert({ name: "T Rex", manager_user_id: ids["Bastian Johnston"] }, { onConflict: "name" })
    .select("id")
    .single();
  if (teamErr) throw teamErr;

  const teamId = team.id as string;

  const members = ["Bastian Johnston", "Stephen Curry", "Tyler Johnson"] as const;
  for (const name of members) {
    const userId = ids[name];
    const { error: memErr } = await admin.from("team_members").upsert({ team_id: teamId, user_id: userId });
    if (memErr) throw memErr;
    const { error: updErr } = await admin.from("users").update({ primary_team_id: teamId }).eq("id", userId);
    if (updErr) throw updErr;
  }

  revalidatePath("/admin/import");
  revalidatePath("/dashboard/manager");
  redirect("/admin/import?ok=1&seeded=1");
}

export async function createTeam(formData: FormData) {
  await requireAdmin();
  const admin = createSupabaseAdminClient();

  const name = String(formData.get("teamName") || "").trim();
  if (!name) redirect("/admin/import?error=Missing%20team%20name");

  const { error } = await admin.from("teams").insert({ name });
  if (error) redirect(`/admin/import?error=${encodeURIComponent(error.message)}`);

  revalidatePath("/admin/import");
  redirect("/admin/import?ok=1");
}

export async function createUserAndAssign(formData: FormData) {
  await requireAdmin();
  const admin = createSupabaseAdminClient();

  const email = String(formData.get("email") || "").trim();
  const fullName = String(formData.get("fullName") || "").trim();
  const role = String(formData.get("role") || "").trim();
  const password = String(formData.get("password") || "ChangeMe!123");
  const teamId = String(formData.get("teamId") || "").trim() || null;
  const setAsManager = String(formData.get("setAsManager") || "") === "on";

  if (!email || !fullName || !role) redirect("/admin/import?error=Missing%20required%20fields");

  const authUser = await getOrCreateAuthUser({ email, fullName, password });

  const { error: upsertErr } = await admin
    .from("users")
    .upsert({ id: authUser.id, email, full_name: fullName, role, is_active: true, primary_team_id: teamId }, { onConflict: "id" });
  if (upsertErr) redirect(`/admin/import?error=${encodeURIComponent(upsertErr.message)}`);

  if (teamId) {
    const { error: memErr } = await admin.from("team_members").upsert({ team_id: teamId, user_id: authUser.id });
    if (memErr) redirect(`/admin/import?error=${encodeURIComponent(memErr.message)}`);

    if (setAsManager) {
      const { error: mgrErr } = await admin.from("teams").update({ manager_user_id: authUser.id }).eq("id", teamId);
      if (mgrErr) redirect(`/admin/import?error=${encodeURIComponent(mgrErr.message)}`);
    }
  }

  revalidatePath("/admin/import");
  redirect("/admin/import?ok=1");
}

