import { getSupabaseAdminClient } from "./admin-auth.service.ts";
import { recordAdminAuditLog } from "./admin-audit.service.ts";

export interface AdminUserSummary {
  id: string;
  email: string;
  username: string | null;
  full_name: string;
  role: "user" | "admin";
  status: "active" | "suspended";
  email_verified: boolean;
  created_at: string;
  last_sign_in_at: string | null;
}

export interface AdminUserDetail extends AdminUserSummary {
  updated_at: string;
  banned_until: string | null;
}

export interface GetAdminUsersParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: "all" | "active" | "suspended";
  role?: "all" | "user" | "admin";
}

export async function getAdminUsers(params: GetAdminUsersParams = {}): Promise<{
  users: AdminUserSummary[];
  total: number;
  page: number;
  limit: number;
}> {
  const supabase = getSupabaseAdminClient();
  const page = Math.max(1, Number(params.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));

  // 1. Fetch auth users list
  const { data: authData, error: authError } = await supabase.auth.admin.listUsers({
    page,
    perPage: limit,
  });

  if (authError) {
    throw new Error(`Không thể lấy danh sách người dùng từ hệ thống: ${authError.message}`);
  }

  const authUsers = authData.users || [];
  const userIds = authUsers.map((u) => u.id);

  // 2. Fetch profiles & user_roles in parallel
  const [profilesRes, rolesRes] = await Promise.all([
    supabase.from("profiles").select("id, username, full_name, created_at").in("id", userIds),
    supabase.from("user_roles").select("user_id, role").in("user_id", userIds),
  ]);

  const profileMap = new Map((profilesRes.data || []).map((p) => [p.id, p]));
  const roleMap = new Map((rolesRes.data || []).map((r) => [r.user_id, r.role as "user" | "admin"]));

  let users: AdminUserSummary[] = authUsers.map((u) => {
    const prof = profileMap.get(u.id);
    const role = roleMap.get(u.id) ?? "user";
    const isBanned = Boolean(u.banned_until && new Date(u.banned_until) > new Date());
    const status: "active" | "suspended" = isBanned ? "suspended" : "active";

    return {
      id: u.id,
      email: u.email ?? "",
      username: prof?.username ?? null,
      full_name: prof?.full_name ?? (u.user_metadata?.full_name as string) ?? "",
      role,
      status,
      email_verified: Boolean(u.email_confirmed_at),
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
    };
  });

  // Client-side filtering if search / status / role are provided
  if (params.search?.trim()) {
    const term = params.search.trim().toLowerCase();
    users = users.filter(
      (u) =>
        u.email.toLowerCase().includes(term) ||
        (u.username && u.username.toLowerCase().includes(term)) ||
        (u.full_name && u.full_name.toLowerCase().includes(term)),
    );
  }

  if (params.status && params.status !== "all") {
    users = users.filter((u) => u.status === params.status);
  }

  if (params.role && params.role !== "all") {
    users = users.filter((u) => u.role === params.role);
  }

  return {
    users,
    total: authData.total ?? users.length,
    page,
    limit,
  };
}

export async function getAdminUserDetail(userId: string): Promise<AdminUserDetail> {
  const supabase = getSupabaseAdminClient();

  const { data: authData, error: authError } = await supabase.auth.admin.getUserById(userId);
  if (authError || !authData?.user) {
    throw new Error("Không tìm thấy thông tin tài khoản người dùng.");
  }

  const u = authData.user;

  const [profileRes, roleRes] = await Promise.all([
    supabase.from("profiles").select("username, full_name, created_at, updated_at").eq("id", userId).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle(),
  ]);

  const prof = profileRes.data;
  const role = (roleRes.data?.role as "user" | "admin") ?? "user";
  const isBanned = Boolean(u.banned_until && new Date(u.banned_until) > new Date());
  const status: "active" | "suspended" = isBanned ? "suspended" : "active";

  return {
    id: u.id,
    email: u.email ?? "",
    username: prof?.username ?? null,
    full_name: prof?.full_name ?? (u.user_metadata?.full_name as string) ?? "",
    role,
    status,
    email_verified: Boolean(u.email_confirmed_at),
    created_at: u.created_at,
    updated_at: prof?.updated_at ?? u.updated_at ?? u.created_at,
    last_sign_in_at: u.last_sign_in_at ?? null,
    banned_until: u.banned_until ?? null,
  };
}

export async function suspendUser(
  adminId: string,
  userId: string,
  reason = "Tạm khóa bởi quản trị viên",
): Promise<void> {
  const supabase = getSupabaseAdminClient();

  // Ban user for 100 years
  const { error } = await supabase.auth.admin.updateUserById(userId, {
    ban_duration: "876000h",
  });

  if (error) {
    throw new Error(`Không thể khóa tài khoản: ${error.message}`);
  }

  await recordAdminAuditLog(adminId, "USER_SUSPENDED", "user", userId, {
    reason,
  });
}

export async function restoreUser(adminId: string, userId: string): Promise<void> {
  const supabase = getSupabaseAdminClient();

  const { error } = await supabase.auth.admin.updateUserById(userId, {
    ban_duration: "none",
  });

  if (error) {
    throw new Error(`Không thể mở khóa tài khoản: ${error.message}`);
  }

  await recordAdminAuditLog(adminId, "USER_RESTORED", "user", userId, {});
}

export async function sendUserPasswordReset(
  adminId: string,
  userId: string,
): Promise<{ resetLink?: string }> {
  const supabase = getSupabaseAdminClient();

  const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
  if (userError || !userData?.user?.email) {
    throw new Error("Không thể xác định email của người dùng để gửi liên kết đặt lại mật khẩu.");
  }

  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: "recovery",
    email: userData.user.email,
  });

  if (linkError) {
    throw new Error(`Không thể tạo liên kết đặt lại mật khẩu: ${linkError.message}`);
  }

  await recordAdminAuditLog(adminId, "PASSWORD_RESET_SENT", "user", userId, {
    email: userData.user.email,
  });

  return {
    resetLink: linkData.properties?.action_link,
  };
}
