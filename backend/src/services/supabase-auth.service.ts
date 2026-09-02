export interface SupabaseAuthConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
}

export interface VerifiedSupabaseUser {
  id: string;
  email?: string;
}

export class AuthenticationError extends Error {
  readonly status: 401 | 500 | 503;

  constructor(message: string, status: 401 | 500 | 503) {
    super(message);
    this.name = "AuthenticationError";
    this.status = status;
  }
}

export function extractBearerToken(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  const token = match?.[1] ?? "";
  if (!token || token.length > 4096) {
    throw new AuthenticationError("Phiên đăng nhập không hợp lệ hoặc đã hết hạn.", 401);
  }
  return token;
}

export async function verifySupabaseAccessToken(
  token: string,
  config: SupabaseAuthConfig,
): Promise<VerifiedSupabaseUser> {
  const supabaseUrl = config.supabaseUrl.trim().replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
  const supabasePublishableKey = config.supabasePublishableKey.trim();
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new AuthenticationError("Cấu hình xác thực Supabase chưa đầy đủ.", 500);
  }

  let response: Response;
  try {
    response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: supabasePublishableKey,
        authorization: `Bearer ${token}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(7000),
    });
  } catch {
    throw new AuthenticationError("Không thể xác minh phiên đăng nhập lúc này.", 503);
  }

  if (!response.ok) {
    throw new AuthenticationError("Phiên đăng nhập không hợp lệ hoặc đã hết hạn.", 401);
  }

  const payload = await response.json() as unknown;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AuthenticationError("Phản hồi xác thực không hợp lệ.", 503);
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.id !== "string" || !record.id) {
    throw new AuthenticationError("Phiên đăng nhập không hợp lệ hoặc đã hết hạn.", 401);
  }

  return {
    id: record.id,
    email: typeof record.email === "string" ? record.email : undefined,
  };
}
