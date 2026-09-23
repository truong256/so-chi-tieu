import { getSupabaseAdminClient } from "./admin-auth.service.ts";

export type AdminAuditAction =
  | "USER_SUSPENDED"
  | "USER_RESTORED"
  | "PASSWORD_RESET_SENT"
  | "SYSTEM_SETTING_UPDATED"
  | "SYSTEM_NOTIFICATION_SENT"
  | "ROLE_CHANGED";

export interface AdminAuditEntry {
  id: string;
  admin_id: string | null;
  admin_name?: string;
  admin_email?: string;
  action: AdminAuditAction | string;
  target_type: string;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface GetAuditLogsParams {
  page?: number;
  limit?: number;
  action?: string;
  search?: string;
}

export async function recordAdminAuditLog(
  adminId: string,
  action: AdminAuditAction | string,
  targetType: string,
  targetId: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    const supabase = getSupabaseAdminClient();

    // Sanitize metadata to never include secrets, tokens or password properties
    const sanitizedMetadata: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(metadata)) {
      const lower = key.toLowerCase();
      if (
        lower.includes("password") ||
        lower.includes("secret") ||
        lower.includes("token") ||
        lower.includes("authorization")
      ) {
        continue;
      }
      sanitizedMetadata[key] = value;
    }

    await supabase.from("admin_audit_logs").insert({
      admin_id: adminId,
      action,
      target_type: targetType,
      target_id: targetId,
      metadata: sanitizedMetadata,
    });
  } catch (error) {
    console.error("Failed to record admin audit log:", error);
    // Audit logging failure should be logged but not crash the entire request
  }
}

export async function getAdminAuditLogs(params: GetAuditLogsParams = {}): Promise<{
  logs: AdminAuditEntry[];
  total: number;
  page: number;
  limit: number;
}> {
  const supabase = getSupabaseAdminClient();
  const page = Math.max(1, Number(params.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
  const offset = (page - 1) * limit;

  let query = supabase
    .from("admin_audit_logs")
    .select("*", { count: "exact" });

  if (params.action && params.action !== "all") {
    query = query.eq("action", params.action);
  }

  if (params.search?.trim()) {
    const term = `%${params.search.trim()}%`;
    query = query.or(`action.ilike.${term},target_type.ilike.${term},target_id.ilike.${term}`);
  }

  query = query.order("created_at", { ascending: false }).range(offset, offset + limit - 1);

  const { data, count, error } = await query;
  if (error) {
    throw new Error(`Không thể tải nhật ký kiểm toán: ${error.message}`);
  }

  // Enrich with admin profiles if available
  const adminIds = Array.from(new Set((data || []).map((row) => row.admin_id).filter(Boolean)));
  const adminMap = new Map<string, { full_name: string; email?: string }>();

  if (adminIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", adminIds);

    (profiles || []).forEach((p) => {
      adminMap.set(p.id, { full_name: p.full_name || "Quản trị viên" });
    });
  }

  const logs: AdminAuditEntry[] = (data || []).map((row) => ({
    id: row.id,
    admin_id: row.admin_id,
    admin_name: row.admin_id ? adminMap.get(row.admin_id)?.full_name ?? "Admin" : "Hệ thống",
    action: row.action,
    target_type: row.target_type,
    target_id: row.target_id,
    metadata: row.metadata || {},
    created_at: row.created_at,
  }));

  return {
    logs,
    total: count ?? 0,
    page,
    limit,
  };
}
