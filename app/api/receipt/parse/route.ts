import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { parseReceiptWithAI } from "@/backend/src/services/receipt-parser.service";
import { asRecord, HttpInputError, readJsonBody } from "@/backend/src/services/http-input.service";
import {
  AuthenticationError,
  extractBearerToken,
  verifySupabaseAccessToken,
} from "@/backend/src/services/supabase-auth.service";

export const maxDuration = 35; // Allow up to 35 seconds for image analysis

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(request: Request) {
  try {
    const geminiApiKey = process.env.GEMINI_API_KEY?.trim() ?? "";

    const token = extractBearerToken(request);
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
    const verifiedUser = await verifySupabaseAccessToken(token, { supabaseUrl, supabasePublishableKey });

    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES + 128 * 1024) {
      return NextResponse.json({ error: "Dữ liệu ảnh vượt quá giới hạn cho phép." }, { status: 413 });
    }

    let mimeType = "image/jpeg";
    let base64Data = "";
    let categoriesList: string[] = [];
    let walletsList: string[] = [];

    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      if (!declaredLength) {
        return NextResponse.json({ error: "Yêu cầu tải ảnh phải có Content-Length." }, { status: 411 });
      }
      const formData = await request.formData();
      const file = formData.get("file") || formData.get("image");

      if (!file || !(file instanceof Blob)) {
        return NextResponse.json({ error: "Vui lòng chọn tệp hình ảnh hóa đơn hợp lệ." }, { status: 400 });
      }

      if (file.size > MAX_IMAGE_BYTES) {
        return NextResponse.json({ error: "Kích thước ảnh quá lớn. Vui lòng chọn ảnh nhỏ hơn 10 MB." }, { status: 413 });
      }

      const detectedMime = file.type || "image/jpeg";
      if (!ALLOWED_MIME_TYPES.has(detectedMime.toLowerCase())) {
        return NextResponse.json(
          { error: `Định dạng ảnh '${detectedMime}' không được hỗ trợ. Vui lòng dùng JPG, PNG hoặc WebP.` },
          { status: 400 }
        );
      }
      mimeType = detectedMime;

      const arrayBuffer = await file.arrayBuffer();
      base64Data = Buffer.from(arrayBuffer).toString("base64");

    } else if (contentType.includes("application/json")) {
      const body = asRecord(await readJsonBody(request, 14 * 1024 * 1024));

      if (typeof body.imageBase64 !== "string" || !body.imageBase64) {
        return NextResponse.json({ error: "Không tìm thấy dữ liệu hình ảnh." }, { status: 400 });
      }

      const rawBase64 = body.imageBase64;
      const dataUrlMatch = rawBase64.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
      if (dataUrlMatch) {
        mimeType = dataUrlMatch[1];
        base64Data = dataUrlMatch[2];
      } else {
        base64Data = rawBase64;
        if (typeof body.mimeType === "string") mimeType = body.mimeType;
      }

      if (!ALLOWED_MIME_TYPES.has(mimeType.toLowerCase())) {
        mimeType = "image/jpeg";
      }

      const approxBytes = Math.ceil((base64Data.length * 3) / 4);
      if (approxBytes > MAX_IMAGE_BYTES) {
        return NextResponse.json({ error: "Kích thước ảnh quá lớn. Vui lòng chọn ảnh nhỏ hơn 10 MB." }, { status: 413 });
      }

    } else {
      return NextResponse.json({ error: "Content-Type không được hỗ trợ." }, { status: 400 });
    }

    const supabase = createSupabaseClient(supabaseUrl, supabasePublishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const [categoriesResult, walletsResult] = await Promise.all([
      supabase.from("categories").select("name").eq("user_id", verifiedUser.id).order("name"),
      supabase.from("wallets").select("name").eq("user_id", verifiedUser.id).order("name"),
    ]);
    if (categoriesResult.error || walletsResult.error) {
      return NextResponse.json({ error: "Không thể tải danh mục và ví của tài khoản." }, { status: 503 });
    }
    categoriesList = (categoriesResult.data ?? []).map((item) => item.name).filter((name): name is string => typeof name === "string").slice(0, 100);
    walletsList = (walletsResult.data ?? []).map((item) => item.name).filter((name): name is string => typeof name === "string").slice(0, 50);

    const result = await parseReceiptWithAI({
      geminiApiKey,
      base64Data,
      mimeType,
      categoriesList,
      walletsList,
    });

    if (!result.success && result.error) {
      return NextResponse.json({ error: result.error, success: false }, { status: result.status });
    }

    return NextResponse.json(
      {
        success: true,
        data: result.data,
        modelUsed: result.modelUsed,
      },
      {
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch (err) {
    if (err instanceof AuthenticationError || err instanceof HttpInputError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof Error && err.name === "TimeoutError") {
      return NextResponse.json(
        { error: "Thời gian xử lý ảnh quá lâu (Timeout). Vui lòng thử lại với ảnh dung lượng nhỏ hơn." },
        { status: 504 }
      );
    }
    console.error("Receipt parse API error:", err);
    return NextResponse.json(
      { error: "Đã xảy ra lỗi trong quá trình xử lý hóa đơn. Vui lòng thử lại." },
      { status: 500 }
    );
  }
}
