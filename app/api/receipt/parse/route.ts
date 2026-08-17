import { NextResponse } from "next/server";
import { parseReceiptWithAI } from "@/backend/src/services/receipt-parser.service";

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

    // Authenticate user header
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Yêu cầu đăng nhập để sử dụng tính năng này." }, { status: 401 });
    }

    let mimeType = "image/jpeg";
    let base64Data = "";
    let categoriesList: string[] = [];
    let walletsList: string[] = [];

    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
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

      const catsRaw = formData.get("categories");
      if (typeof catsRaw === "string") {
        try {
          categoriesList = JSON.parse(catsRaw);
        } catch {
          categoriesList = [];
        }
      }

      const walletsRaw = formData.get("wallets");
      if (typeof walletsRaw === "string") {
        try {
          walletsList = JSON.parse(walletsRaw);
        } catch {
          walletsList = [];
        }
      }
    } else if (contentType.includes("application/json")) {
      const body = (await request.json()) as {
        imageBase64?: string;
        mimeType?: string;
        categories?: string[];
        wallets?: string[];
      };

      if (!body.imageBase64) {
        return NextResponse.json({ error: "Không tìm thấy dữ liệu hình ảnh." }, { status: 400 });
      }

      let rawBase64 = body.imageBase64;
      const dataUrlMatch = rawBase64.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
      if (dataUrlMatch) {
        mimeType = dataUrlMatch[1];
        base64Data = dataUrlMatch[2];
      } else {
        base64Data = rawBase64;
        if (body.mimeType) mimeType = body.mimeType;
      }

      if (!ALLOWED_MIME_TYPES.has(mimeType.toLowerCase())) {
        mimeType = "image/jpeg";
      }

      const approxBytes = Math.ceil((base64Data.length * 3) / 4);
      if (approxBytes > MAX_IMAGE_BYTES) {
        return NextResponse.json({ error: "Kích thước ảnh quá lớn. Vui lòng chọn ảnh nhỏ hơn 10 MB." }, { status: 413 });
      }

      if (Array.isArray(body.categories)) categoriesList = body.categories;
      if (Array.isArray(body.wallets)) walletsList = body.wallets;
    } else {
      return NextResponse.json({ error: "Content-Type không được hỗ trợ." }, { status: 400 });
    }

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
