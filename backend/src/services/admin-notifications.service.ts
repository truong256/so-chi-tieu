import { getSupabaseAdminClient } from "./admin-auth.service.ts";
import { recordAdminAuditLog } from "./admin-audit.service.ts";

export interface SendSystemNotificationParams {
  title: string;
  message: string;
  target?: "all" | string[];
}

export function sanitizeHtml(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

export async function sendSystemNotification(
  adminId: string,
  params: SendSystemNotificationParams,
): Promise<{ sentCount: number }> {
  const title = sanitizeHtml(params.title);
  const message = sanitizeHtml(params.message);

  if (!title || title.length > 200) {
    throw new Error("Tiêu đề thông báo không được để trống và tối đa 200 ký tự.");
  }

  if (!message || message.length > 2000) {
    throw new Error("Nội dung thông báo không được để trống và tối đa 2.000 ký tự.");
  }

  const supabase = getSupabaseAdminClient();

  let targetUserIds: string[] = [];

  if (!params.target || params.target === "all") {
    // Get all user ids from profiles
    const { data: profiles, error: profError } = await supabase
      .from("profiles")
      .select("id");

    if (profError) {
      throw new Error(`Không thể lấy danh sách người nhận: ${profError.message}`);
    }

    targetUserIds = (profiles || []).map((p) => p.id);
  } else if (Array.isArray(params.target)) {
    targetUserIds = params.target.filter((id) => typeof id === "string" && id.trim().length > 0);
  }

  if (targetUserIds.length === 0) {
    return { sentCount: 0 };
  }

  // Batch insert into notifications table
  const batchSize = 100;
  let sentCount = 0;

  for (let i = 0; i < targetUserIds.length; i += batchSize) {
    const chunk = targetUserIds.slice(i, i + batchSize);
    const notificationsToInsert = chunk.map((userId) => ({
      user_id: userId,
      type: "system",
      title,
      message,
      is_read: false,
    }));

    const { error: insertError } = await supabase
      .from("notifications")
      .insert(notificationsToInsert);

    if (insertError) {
      console.error("Failed to insert notification batch:", insertError);
    } else {
      sentCount += chunk.length;
    }
  }

  await recordAdminAuditLog(adminId, "SYSTEM_NOTIFICATION_SENT", "notification", null, {
    title,
    sentCount,
    target: typeof params.target === "string" ? params.target : "selected_users",
  });

  return { sentCount };
}
