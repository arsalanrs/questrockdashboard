import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type NotificationType =
  | "verification_complete"
  | "esign_requested"
  | "esign_returned"
  | "processing_deadline"
  | "restructure_hold"
  | "processing_complete"
  | "uw_decision"
  | "mini_meeting_needed"
  | "conditions_submitted"
  | "pre_cd_ready"
  | "ctc"
  | "lock_warning"
  | "contingency_warning"
  | "sla_warning";

export async function createNotification(params: {
  userId: string;
  type: NotificationType;
  loanId?: string;
  title: string;
  body?: string;
}) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("notifications").insert({
    user_id: params.userId,
    type: params.type,
    loan_id: params.loanId ?? null,
    title: params.title,
    body: params.body ?? null,
  });
  if (error) {
    console.error("Failed to create notification:", error.message);
  }
}

export async function createNotificationsForMany(params: {
  userIds: string[];
  type: NotificationType;
  loanId?: string;
  title: string;
  body?: string;
}) {
  const admin = createSupabaseAdminClient();
  const rows = params.userIds.map((uid) => ({
    user_id: uid,
    type: params.type,
    loan_id: params.loanId ?? null,
    title: params.title,
    body: params.body ?? null,
  }));
  if (!rows.length) return;
  const { error } = await admin.from("notifications").insert(rows);
  if (error) {
    console.error("Failed to create notifications:", error.message);
  }
}
