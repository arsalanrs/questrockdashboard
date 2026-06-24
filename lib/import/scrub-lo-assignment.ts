import { isPlausibleLoName } from "@/lib/import/plausible-lo-name";
import { resolveShapeLoAssignment } from "@/lib/import/resolve-shape-lo-assignment";
import { buildLoUserIdLookup } from "@/lib/import/resolve-lo-user-id";

/**
 * Clear junk assigned_loan_officer_* values from mistaken Shape field-map matches.
 * Preserves LP-sourced assignments (lendingpad_loan_uuid + user id).
 */
export async function scrubInvalidLoAssignments(
  admin: ReturnType<typeof import("@/lib/supabase/admin").createSupabaseAdminClient>,
): Promise<{ cleared: number; repairedNames: number }> {
  const { data: users, error: usersError } = await admin.from("users").select("id,full_name,email");
  if (usersError) throw usersError;

  const lookup = { ...buildLoUserIdLookup(users ?? []), users: users ?? [] };
  const userNameById = new Map((users ?? []).map((u) => [u.id, u.full_name]));

  let cleared = 0;
  let repairedNames = 0;
  let offset = 0;

  while (true) {
    const { data: rows, error } = await admin
      .from("loans")
      .select(
        "id,assigned_loan_officer_name,assigned_loan_officer_user_id,lendingpad_loan_uuid",
      )
      .range(offset, offset + 499);
    if (error) throw error;
    if (!rows?.length) break;

    for (const row of rows) {
      const name = row.assigned_loan_officer_name as string | null;
      const userId = row.assigned_loan_officer_user_id as string | null;
      const hasLp = Boolean(row.lendingpad_loan_uuid);

      if (hasLp && userId) {
        const canonical = userNameById.get(userId);
        if (canonical && name !== canonical && (!name || !isPlausibleLoName(name))) {
          const { error: upErr } = await admin
            .from("loans")
            .update({ assigned_loan_officer_name: canonical })
            .eq("id", row.id);
          if (!upErr) repairedNames += 1;
        }
        continue;
      }

      if (!name && !userId) continue;

      const plausible = name ? isPlausibleLoName(name) : false;

      if (plausible && !userId) {
        const resolved = resolveShapeLoAssignment(
          { "Loan Officer User Name": name ?? undefined },
          lookup,
        );
        if (resolved.assignedLoUserId) {
          const { error: upErr } = await admin
            .from("loans")
            .update({
              assigned_loan_officer_user_id: resolved.assignedLoUserId,
              assigned_loan_officer_name: resolved.loName ?? name,
            })
            .eq("id", row.id);
          if (!upErr) repairedNames += 1;
        }
        continue;
      }

      if (!plausible && !hasLp) {
        const { error: upErr } = await admin
          .from("loans")
          .update({
            assigned_loan_officer_name: null,
            assigned_loan_officer_user_id: null,
          })
          .eq("id", row.id);
        if (!upErr) cleared += 1;
      }
    }

    if (rows.length < 500) break;
    offset += 500;
  }

  return { cleared, repairedNames };
}
