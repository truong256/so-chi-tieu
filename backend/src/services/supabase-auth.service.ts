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

// In-memory cache for validated Supabase tokens (60s TTL) to prevent network flapping
const verifiedTokenCache = new Map<string, { user: VerifiedSupabaseUser; expiresAt: number }>();

export async function verifySupabaseAccessToken(
  token: string,
  config: SupabaseAuthConfig,
): Promise<VerifiedSupabaseUser> {
  const now = Date.now();
  const cached = verifiedTokenCache.get(token);
  if (cached && cached.expiresAt > now) {
    return cached.user;
  }

  const supabaseUrl = config.supabaseUrl.trim().replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
  const supabasePublishableKey = config.supabasePublishableKey.trim();
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new AuthenticationError("Cấu hình xác thực Supabase chưa đầy đủ.", 500);
  }

  let response: Response | null = null;
  let fetchError: unknown = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      response = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: {
          apikey: supabasePublishableKey,
          authorization: `Bearer ${token}`,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(12000),
      });
      break;
    } catch (err) {
      fetchError = err;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }

  if (!response) {
    void fetchError;
    throw new AuthenticationError("Không thể xác minh phiên đăng nhập lúc này.", 503);
  }

  if (!response.ok) {
    throw new AuthenticationError("Phiên đăng nhập không hợp lệ hoặc đã hết hạn.", 401);
  }

  const payload = await response.json() as unknown;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AuthenticationError("Phản hồi xác thực không hợp lệ.", 503);
  }

  const userRecord = payload as { id?: unknown; email?: unknown };
  if (typeof userRecord.id !== "string" || !userRecord.id) {
    throw new AuthenticationError("Phiên đăng nhập không hợp lệ hoặc đã hết hạn.", 401);
  }

  const verified: VerifiedSupabaseUser = {
    id: userRecord.id,
    email: typeof userRecord.email === "string" ? userRecord.email : undefined,
  };

  // Cache valid verification for 60 seconds
  verifiedTokenCache.set(token, {
    user: verified,
    expiresAt: now + 60_000,
  });

  return verified;
}
