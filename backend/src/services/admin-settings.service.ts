import { getSupabaseAdminClient } from "./admin-auth.service.ts";
import { recordAdminAuditLog } from "./admin-audit.service.ts";

export interface SystemSettingItem {
  key: string;
  value: unknown;
  description: string;
  updated_at: string;
}

const ALLOWED_SETTING_KEYS = new Set([
  "ai_enabled",
  "receipt_scan_enabled",
  "maintenance_mode",
]);

export async function getSystemSettings(): Promise<Record<string, unknown>> {
  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase
    .from("system_settings")
    .select("key, value, description, updated_at");

  if (error) {
    throw new Error(`Không thể lấy cài đặt hệ thống: ${error.message}`);
  }

  const settings: Record<string, unknown> = {};
  (data || []).forEach((row) => {
    // Only return allowed keys
    if (ALLOWED_SETTING_KEYS.has(row.key)) {
      settings[row.key] = row.value;
    }
  });

  return settings;
}

export async function updateSystemSetting(
  adminId: string,
  key: string,
  value: unknown,
): Promise<void> {
  const trimmedKey = key.trim();

  if (!ALLOWED_SETTING_KEYS.has(trimmedKey)) {
    throw new Error(
      `Khóa cấu hình không hợp lệ hoặc không được phép sửa đổi: ${trimmedKey}`,
    );
  }

  // Prevent modifying secret keys
  const lower = trimmedKey.toLowerCase();
  if (lower.includes("secret") || lower.includes("key") || lower.includes("token")) {
    throw new Error("Không được phép lưu trữ hoặc cập nhật khóa bảo mật qua giao diện.");
  }

  const supabase = getSupabaseAdminClient();

  const { error } = await supabase
    .from("system_settings")
    .upsert({
      key: trimmedKey,
      value,
      updated_at: new Date().toISOString(),
      updated_by: adminId,
    });

  if (error) {
    throw new Error(`Không thể lưu cài đặt hệ thống: ${error.message}`);
  }

  await recordAdminAuditLog(adminId, "SYSTEM_SETTING_UPDATED", "system_setting", trimmedKey, {
    value,
  });
}
