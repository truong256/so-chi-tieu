import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { parseTransactionWithAI } from "@/backend/src/services/ai-parser.service";

export const maxDuration = 30; // 30s timeout

export async function POST(request: Request) {
  try {
    const geminiApiKey = process.env.GEMINI_API_KEY?.trim() ?? "";

    // Authenticate user via Supabase Bearer token
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Yêu cầu đăng nhập để sử dụng tính năng này." }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
    const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ error: "Lỗi cấu hình cơ sở dữ liệu Supabase." }, { status: 500 });
    }

    const supabase = createSupabaseClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn." }, { status: 401 });
    }

    let body: any = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Dữ liệu gửi lên không đúng định dạng JSON." }, { status: 400 });
    }

    const rawText = typeof body.text === "string" ? body.text.trim() : "";

    // Fetch user's real wallets and categories directly from Supabase DB
    const [walletsRes, catsRes] = await Promise.all([
      supabase.from("wallets").select("id, name, type, icon").eq("user_id", user.id).order("name"),
      supabase.from("categories").select("id, name, kind, icon").eq("user_id", user.id).order("name"),
    ]);

    const userWallets = (walletsRes.data || []).map((w: any) => ({
      id: w.id,
      name: w.name,
      type: w.type || "other",
      icon: w.icon || "",
    }));

    const userCategories = (catsRes.data || []).map((c: any) => ({
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
      clientDate: body.client_date,
      clientTime: body.client_time,
      timezone: body.timezone,
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
  } catch (error: any) {
    console.error("AI Parse Transaction route error:", error);
    return NextResponse.json(
      { error: error?.message || "Đã xảy ra lỗi máy chủ trong quá trình xử lý AI." },
      { status: 500 }
    );
  }
}
