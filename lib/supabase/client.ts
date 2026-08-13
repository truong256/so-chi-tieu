import { createBrowserClient } from "@supabase/ssr";

export type SupabaseBrowserConfig = {
  supabaseUrl: string;
  supabasePublishableKey: string;
};

let browserClient: ReturnType<typeof createBrowserClient> | undefined;
let browserConfig: SupabaseBrowserConfig | undefined;

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

export function createClient() {
  if (!browserConfig) {
    throw new Error("Kết nối Supabase chưa được khởi tạo.");
  }

  if (!browserClient) {
    browserClient = createBrowserClient(
      browserConfig.supabaseUrl,
      browserConfig.supabasePublishableKey,
    );
  }

  return browserClient;
}
