import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { parseTransactionWithAI } from "@/backend/src/services/ai-parser.service";
import { asRecord, HttpInputError, readJsonBody } from "@/backend/src/services/http-input.service";
import { AuthenticationError, extractBearerToken, verifySupabaseAccessToken } from "@/backend/src/services/supabase-auth.service";

export const maxDuration = 30; // 30s timeout

export async function POST(request: Request) {
  try {
    const geminiApiKey = process.env.GEMINI_API_KEY?.trim() ?? "";

    const token = extractBearerToken(request);
    const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
    const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ error: "Lỗi cấu hình cơ sở dữ liệu Supabase." }, { status: 500 });
    }

    const supabase = createSupabaseClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const user = await verifySupabaseAccessToken(token, {
      supabaseUrl,
      supabasePublishableKey: supabaseAnonKey,
    });

    const body = asRecord(await readJsonBody(request, 8 * 1024));

    const rawText = typeof body.text === "string" ? body.text.trim() : "";

    // Fetch user's real wallets and categories directly from Supabase DB
    const [walletsRes, catsRes] = await Promise.all([
      supabase.from("wallets").select("id, name, type, icon").eq("user_id", user.id).order("name"),
      supabase.from("categories").select("id, name, kind, icon").eq("user_id", user.id).order("name"),
    ]);

    if (walletsRes.error || catsRes.error) {
      return NextResponse.json({ error: "Không thể tải dữ liệu ví và danh mục của tài khoản." }, { status: 503 });
    }

    const userWallets = (walletsRes.data || []).map((w) => ({
      id: w.id,
      name: w.name,
      type: w.type || "other",
      icon: w.icon || "",
    }));

    const userCategories = (catsRes.data || []).map((c) => ({
      id: c.id,
      name: c.name,
      type: c.kind || "expense",
      icon: c.icon || "",
    }));

    const result = await parseTransactionWithAI({
      geminiApiKey,
      rawText,
      userWallets,
      userCategories,
      clientDate: typeof body.client_date === "string" ? body.client_date : undefined,
      clientTime: typeof body.client_time === "string" ? body.client_time : undefined,
      timezone: typeof body.timezone === "string" ? body.timezone : undefined,
    });

    if (!result.success && result.error) {
      return NextResponse.json({ error: result.error, success: false }, { status: result.status });
    }

    return NextResponse.json({
      success: true,
      data: result.data,
      meta: {
        model: result.modelUsed,
      },
    });
  } catch (error: unknown) {
    if (error instanceof HttpInputError || error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("AI Parse Transaction route error:", error);
    return NextResponse.json(
      { error: "Đã xảy ra lỗi máy chủ trong quá trình xử lý AI." },
      { status: 500 }
    );
  }
}
