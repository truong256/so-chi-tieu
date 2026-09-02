import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

export type SupabaseBrowserConfig = {
  supabaseUrl: string;
  supabasePublishableKey: string;
};

let browserClient: SupabaseClient | undefined;
let browserConfig: SupabaseBrowserConfig | undefined = (() => {
  const envUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
  const envKey = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  if (envUrl && envKey) {
    return { supabaseUrl: envUrl, supabasePublishableKey: envKey };
  }
  return undefined;
})();

function clearLegacyPersistentStorage() {
  if (typeof window === "undefined") return;
  try {
    // Clear any persistent localStorage auth items from previous configurations
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith("sb-") || key.includes("supabase.auth.token")) {
        localStorage.removeItem(key);
      }
    });
    // Remove persistent cookies so sessions are not preserved across tab/browser exits
    if (typeof document !== "undefined" && document.cookie) {
      document.cookie.split(";").forEach((cookie) => {
        const eqPos = cookie.indexOf("=");
        const name = eqPos > -1 ? cookie.slice(0, eqPos).trim() : cookie.trim();
        if (name.startsWith("sb-") || name.includes("supabase")) {
          document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; max-age=0; SameSite=Lax`;
        }
      });
    }
  } catch {
    // Some privacy modes block browser storage and cookie access.
  }
}

export function configureClient(config: SupabaseBrowserConfig) {
  const supabaseUrl = config.supabaseUrl.trim().replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
  const supabasePublishableKey = config.supabasePublishableKey.trim();

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error("Cấu hình kết nối Supabase chưa đầy đủ.");
  }

  if (
    browserConfig &&
    (browserConfig.supabaseUrl !== supabaseUrl ||
      browserConfig.supabasePublishableKey !== supabasePublishableKey)
  ) {
    browserClient = undefined;
  }

  browserConfig = { supabaseUrl, supabasePublishableKey };
}

export function createClient(): SupabaseClient {
  if (!browserConfig) {
    const envUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
    const envKey = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
    if (envUrl && envKey) {
      browserConfig = { supabaseUrl: envUrl, supabasePublishableKey: envKey };
    } else {
      throw new Error("Kết nối Supabase chưa được khởi tạo.");
    }
  }

  if (!browserClient) {
    clearLegacyPersistentStorage();
    browserClient = createSupabaseClient(
      browserConfig.supabaseUrl,
      browserConfig.supabasePublishableKey,
      {
        auth: {
          storage: typeof window !== "undefined" ? window.sessionStorage : undefined,
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      }
    );
  }

  return browserClient;
}
