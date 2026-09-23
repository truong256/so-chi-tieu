import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  AuthenticationError,
  verifySupabaseAccessToken,
} from "./supabase-auth.service.ts";

export interface VerifiedAdminUser {
  id: string;
  email?: string;
  role: "admin";
}

export class AuthorizationError extends Error {
  readonly status = 403;

  constructor(message = "Quyền truy cập bị từ chối. Chỉ dành cho quản trị viên.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

/**
 * Returns a server-only Supabase client with service role privileges.
 * NEVER expose this client or SUPABASE_SERVICE_ROLE_KEY to the browser runtime.
 */
export function getSupabaseAdminClient(): SupabaseClient {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")
    .trim()
    .replace(/\/rest\/v1\/?$/, "")
    .replace(/\/$/, "");
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

  if (!supabaseUrl) {
    throw new Error("Cấu hình NEXT_PUBLIC_SUPABASE_URL chưa được thiết lập.");
  }

  if (!serviceRoleKey) {
    throw new Error(
      "Chưa cấu hình SUPABASE_SERVICE_ROLE_KEY trên máy chủ cho các thao tác quản trị.",
    );
  }

  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/**
 * Verifies that the bearer token belongs to an authenticated user AND that
 * the user has the 'admin' role in the database.
 */
export async function verifyAdminUser(
  token: string,
  env?: {
    supabaseUrl?: string;
    supabasePublishableKey?: string;
    supabaseServiceRoleKey?: string;
  },
): Promise<VerifiedAdminUser> {
  if (!token || typeof token !== "string" || !token.trim()) {
    throw new AuthenticationError("Phiên đăng nhập không hợp lệ hoặc đã hết hạn.", 401);
  }

  const supabaseUrl = (env?.supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")
    .trim()
    .replace(/\/rest\/v1\/?$/, "")
    .replace(/\/$/, "");
  const publishableKey = (
    env?.supabasePublishableKey ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    ""
  ).trim();

  if (!supabaseUrl || !publishableKey) {
    throw new AuthenticationError("Cấu hình xác thực Supabase chưa đầy đủ.", 500);
  }

  // 1. Verify access token with Supabase Auth
  const verifiedUser = await verifySupabaseAccessToken(token, {
    supabaseUrl,
    supabasePublishableKey: publishableKey,
  });

  // 2. Query user_roles directly using user token or service role client
  const serviceRoleKey = (env?.supabaseServiceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  
  let role: string | null = null;

  if (serviceRoleKey) {
    // Fast server-side check with service role client
    const adminDb = createSupabaseClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await adminDb
      .from("user_roles")
      .select("role")
      .eq("user_id", verifiedUser.id)
      .maybeSingle();

    if (!error && data?.role) {
      role = data.role as string;
    }
  } else {
    // Fallback: check through user's own token (which has RLS select on their own row in user_roles)
    const userDb = createSupabaseClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await userDb
      .from("user_roles")
      .select("role")
      .eq("user_id", verifiedUser.id)
      .maybeSingle();

    if (!error && data?.role) {
      role = data.role as string;
    }
  }

  if (role !== "admin") {
    throw new AuthorizationError();
  }

  return {
    id: verifiedUser.id,
    email: verifiedUser.email,
    role: "admin",
  };
}

/**
 * Checks a user's role without requiring them to be admin.
 * Used for role routing.
 */
export async function getUserRole(
  token: string,
  env?: {
    supabaseUrl?: string;
    supabasePublishableKey?: string;
  },
): Promise<"admin" | "user"> {
  const supabaseUrl = (env?.supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")
    .trim()
    .replace(/\/rest\/v1\/?$/, "")
    .replace(/\/$/, "");
  const publishableKey = (
    env?.supabasePublishableKey ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    ""
  ).trim();

  if (!supabaseUrl || !publishableKey) {
    throw new AuthenticationError("Cấu hình xác thực Supabase chưa đầy đủ.", 500);
  }

  const verifiedUser = await verifySupabaseAccessToken(token, {
    supabaseUrl,
    supabasePublishableKey: publishableKey,
  });

  const userDb = createSupabaseClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data, error } = await userDb
    .from("user_roles")
    .select("role")
    .eq("user_id", verifiedUser.id)
    .maybeSingle();

  if (error || !data?.role) {
    // Safe fallback: default to 'user' for accounts without role record
    return "user";
  }

  return data.role === "admin" ? "admin" : "user";
}
