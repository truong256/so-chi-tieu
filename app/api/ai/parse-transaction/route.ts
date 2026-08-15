import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { AITransactionParseResult, TransactionType } from "@/app/finance-types";

export const maxDuration = 30; // 30s timeout

const AI_PARSE_SYSTEM_PROMPT = `Bạn là hệ thống AI phân tích giao dịch tài chính cá nhân cho ứng dụng "Sổ Chi Tiêu".

NHIỆM VỤ:
Chuyển đổi câu nhập bằng ngôn ngữ tự nhiên của người dùng thành dữ liệu giao dịch có cấu trúc (Structured JSON).

QUY TẮC BẮT BUỘC VÀ NGHIÊM NGẶT:
1. Chỉ sử dụng thông tin có trong câu người dùng và dữ liệu hệ thống (SYSTEM_CONTEXT, USER_WALLETS, USER_CATEGORIES).
2. Tuyệt đối KHÔNG tự tạo dữ liệu không có căn cứ hoặc suy đoán thông tin bị thiếu.
3. Nếu không xác định được trường nào (hoặc không chắc chắn), BẮT BUỘC trả về null.
4. Phân biệt rõ loại giao dịch:
   - "expense" (Khoản chi): các từ như ăn, uống, mua, trả, thanh toán, đổ xăng, xem phim, nạp tiền điện thoại, đi chợ, tip...
   - "income" (Khoản thu): các từ như lương, thưởng, nhận tiền, được chuyển tiền, được bạn trả lại, bán đồ, hoàn tiền, thu nhập...
   - null: Nếu chỉ nhập số tiền (ví dụ "50k") hoặc câu không rõ là thu hay chi, đặt "transaction_type": null.
5. Không được chỉ dựa vào một keyword nếu ngữ nghĩa toàn câu có ý nghĩa ngược lại (Ví dụ: "Được bạn trả tiền ăn trưa 50k" là income, chứ không phải expense).
6. Chuẩn hóa số tiền (amount):
   - "50k", "50 K", "50 nghìn", "50 ngàn", "50.000", "50,000" → 50000
   - "100k", "100 nghìn" → 100000
   - "1tr", "1 tr", "1 triệu", "1,000,000" → 1000000
   - "1.5 triệu", "1,5 triệu", "1tr5", "1 triệu rưỡi" → 1500000
   - "2 củ", "2 quả" → 2000000
   - "350k" → 350000
   - "amount" phải là kiểu NUMBER nguyên dương, KHÔNG chứa ký tự tiền tệ, dấu chấm hay dấu phẩy.
   - Tuyệt đối không chấp nhận amount âm.
   - Nếu câu không có số tiền (Ví dụ: "Ăn sáng"), đặt "amount": null.
7. Danh mục ("category_id" & "category_name"):
   - BẮT BUỘC CHỈ ĐƯỢC CHỌN TỪ DANH SÁCH USER_CATEGORIES ĐƯỢC CUNG CẤP.
   - Phải trả đúng "category_id" (chuỗi ID) và "category_name" từ danh sách.
   - Nếu câu người dùng không nhắc đến hoặc không có danh mục nào trong danh sách thực sự phù hợp, đặt "category_id": null và "category_name": null.
   - Tuyệt đối không tự tạo category mới.
8. Ví / Tài khoản thanh toán ("wallet_id" & "wallet_name"):
   - BẮT BUỘC CHỈ ĐƯỢC CHỌN TỪ DANH SÁCH USER_WALLETS ĐƯỢC CUNG CẤP.
   - Phải trả đúng "wallet_id" (chuỗi ID) và "wallet_name" từ danh sách.
   - Nhận diện các ví phổ biến khi người dùng nhắc đến: "tiền mặt", "cash", "momo", "zalopay", "vnpay", "vietcombank", "techcombank", "mb", "tpbank", "bidv", "vpbank", "acb", "agribank", "thẻ", "ngân hàng"...
   - Nếu người dùng KHÔNG nhắc đến ví/nguồn tiền cụ thể trong câu (Ví dụ: "Ăn trưa 50k", "Mua áo 350k"), BẮT BUỘC đặt "wallet_id": null và "wallet_name": null.
   - Tuyệt đối không tự chọn ví mặc định.
9. Thời gian ("date" & "time"):
   - Sử dụng CURRENT_DATE và CURRENT_TIME từ SYSTEM_CONTEXT để tính toán:
     - "hôm nay", "nay", "hôm nay lúc..." → dùng CURRENT_DATE.
     - "hôm qua", "qua" → ngày liền trước CURRENT_DATE (định dạng YYYY-MM-DD).
     - "ngày mai", "mai" → ngày liền sau CURRENT_DATE (định dạng YYYY-MM-DD).
     - "sáng nay" → CURRENT_DATE kèm time buổi sáng (hoặc null nếu không nói rõ giờ).
     - "chiều nay", "tối nay" → CURRENT_DATE.
     - Nếu có ngày cụ thể (Ví dụ: "ngày 12/8", "12-08"): tính toán thành "YYYY-MM-DD".
     - Nếu không nhắc gì đến thời gian, dùng CURRENT_DATE.
     - time: "HH:mm" (ví dụ "10:30", "19:00") nếu câu có nhắc đến giờ cụ thể, ngược lại trả về null.
10. Mô tả / Tiêu đề ("description"):
   - Tóm tắt ngắn gọn, giữ đúng nội dung giao dịch (Ví dụ: "Ăn trưa", "Đổ xăng", "Lương tháng này", "Mua áo", "Bạn trả lại tiền").
   - Nếu câu không có nội dung rõ ràng (chỉ có số tiền như "50k"), đặt description: null.
11. BẮT BUỘC CHỈ TRẢ VỀ DUY NHẤT 1 OBJECT JSON HỢP LỆ THEO SCHEMA SAU:
{
  "transaction_type": "expense" | "income" | null,
  "amount": number | null,
  "currency": "VND",
  "category_id": string | null,
  "category_name": string | null,
  "wallet_id": string | null,
  "wallet_name": string | null,
  "description": string | null,
  "date": string | null,
  "time": string | null,
  "confidence_notes": string[]
}`;

export async function POST(request: Request) {
  try {
    const geminiApiKey = process.env.GEMINI_API_KEY?.trim();
    if (!geminiApiKey || geminiApiKey === "your_gemini_api_key_here") {
      return NextResponse.json(
        { error: "Dịch vụ AI chưa được cấu hình. Vui lòng thiết lập GEMINI_API_KEY trên máy chủ." },
        { status: 503 }
      );
    }

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

    // Parse request payload
    let body: any = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Dữ liệu gửi lên không đúng định dạng JSON." }, { status: 400 });
    }

    const rawText = typeof body.text === "string" ? body.text.trim() : "";
    if (!rawText) {
      return NextResponse.json({ error: "Vui lòng nhập nội dung giao dịch để nhận diện." }, { status: 400 });
    }

    if (rawText.length > 500) {
      return NextResponse.json({ error: "Câu nhập quá dài. Vui lòng nhập ngắn gọn dưới 500 ký tự." }, { status: 400 });
    }

    // Fetch user's real wallets and categories directly from Supabase DB
    const [walletsRes, catsRes] = await Promise.all([
      supabase.from("wallets").select("id, name, type, icon").eq("user_id", user.id).order("name"),
      supabase.from("categories").select("id, name, kind, icon").eq("user_id", user.id).order("name"),
    ]);

    if (walletsRes.error) {
      console.error("Failed to fetch wallets for AI parsing:", walletsRes.error);
    }
    if (catsRes.error) {
      console.error("Failed to fetch categories for AI parsing:", catsRes.error);
    }

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

    // Current Date/Time calculation (Vietnam timezone: Asia/Ho_Chi_Minh)
    const now = new Date();
    const vnTimeFormatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const vnHourFormatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    const currentDate = body.client_date || vnTimeFormatter.format(now); // YYYY-MM-DD
    const currentTime = body.client_time || vnHourFormatter.format(now); // HH:mm
    const timezone = body.timezone || "Asia/Ho_Chi_Minh";

    const systemContext = {
      current_date: currentDate,
      current_time: currentTime,
      timezone: timezone,
    };

    const userPromptContent = `SYSTEM_CONTEXT:
${JSON.stringify(systemContext, null, 2)}

USER_WALLETS (Danh sách ví thực tế của người dùng):
${JSON.stringify(userWallets, null, 2)}

USER_CATEGORIES (Danh sách danh mục thực tế của người dùng):
${JSON.stringify(userCategories, null, 2)}

CÂU NGƯỜI DÙNG NHẬP:
"${rawText}"

Hãy phân tích câu trên và trả về đúng 1 JSON object.`;

    // Candidate Gemini models with fallback
    const candidateModels = [
      "gemini-2.5-flash",
      "gemini-1.5-flash",
      "gemini-2.0-flash",
      "gemini-3.6-flash",
      "gemini-2.5-pro",
    ];

    let geminiRes: Response | null = null;
    let usedModel = "";
    let lastErrorText = "";

    for (const modelName of candidateModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiApiKey}`;
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: `${AI_PARSE_SYSTEM_PROMPT}\n\n${userPromptContent}`,
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.1,
              responseMimeType: "application/json",
              maxOutputTokens: 8192,
            },
            safetySettings: [
              { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
            ],
          }),
          signal: AbortSignal.timeout(25000), // 25s timeout per attempt
        });

        if (res.ok) {
          geminiRes = res;
          usedModel = modelName;
          break;
        }

        const errBody = await res.text().catch(() => "");
        console.error(`Gemini Text Parse error for model ${modelName}:`, res.status, errBody);
        lastErrorText = errBody;

        if (res.status !== 404 && res.status !== 400 && res.status !== 503) {
          geminiRes = res;
          break;
        }
      } catch (err) {
        console.error(`Failed AI Text Parse request for model ${modelName}:`, err);
      }
    }

    if (!geminiRes || !geminiRes.ok) {
      let userErrorMsg = "Không thể phân tích giao dịch bằng AI lúc này. Bạn vẫn có thể nhập thủ công.";
      if (lastErrorText.includes("API_KEY_INVALID") || lastErrorText.includes("API key not valid")) {
        userErrorMsg = "Cấu hình API Key AI không hợp lệ. Vui lòng liên hệ quản trị viên.";
      } else if (geminiRes?.status === 429 || lastErrorText.includes("quota") || lastErrorText.includes("RESOURCE_EXHAUSTED")) {
        userErrorMsg = "Dịch vụ AI đang quá tải hạn mức (Quota exceeded). Vui lòng thử lại sau giây lát hoặc nhập thủ công.";
      }

      return NextResponse.json({ error: userErrorMsg }, { status: geminiRes ? geminiRes.status : 502 });
    }

    const geminiData = (await geminiRes.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
    };

    const rawReply = geminiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!rawReply) {
      return NextResponse.json(
        { error: "Không nhận được phản hồi hợp lệ từ AI. Vui lòng thử lại hoặc nhập thủ công." },
        { status: 502 }
      );
    }

    // Clean JSON markdown wrapper if present
    let jsonStr = rawReply;
    if (jsonStr.startsWith("```json")) {
      jsonStr = jsonStr.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    } else if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```\s*/, "").replace(/\s*```$/, "");
    }
    jsonStr = jsonStr.trim();

    let parsed: any;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error("JSON parse error from Gemini text parser output:", jsonStr, parseError);
      return NextResponse.json(
        { error: "Dữ liệu AI trả về không đúng cấu trúc. Vui lòng nhập rõ ràng hơn hoặc nhập thủ công." },
        { status: 502 }
      );
    }

    // Validate and sanitize parsed output
    // 1. Transaction Type
    let transactionType: TransactionType | null = null;
    if (parsed.transaction_type === "expense" || parsed.transaction_type === "income") {
      transactionType = parsed.transaction_type;
    }

    // 2. Amount sanitizer
    const cleanNumber = (val: any): number | null => {
      if (val === null || val === undefined || val === "") return null;
      if (typeof val === "number" && !isNaN(val) && isFinite(val) && val >= 0) return Math.round(val);
      if (typeof val === "string") {
        const digitsOnly = val.replace(/[^0-9]/g, "");
        if (!digitsOnly) return null;
        const num = parseInt(digitsOnly, 10);
        return !isNaN(num) && isFinite(num) && num >= 0 ? num : null;
      }
      return null;
    };

    const amount = cleanNumber(parsed.amount);

    // 3. Category Validation against DB list
    let categoryId: string | null = null;
    let categoryName: string | null = null;

    if (parsed.category_id && typeof parsed.category_id === "string") {
      const match = userCategories.find((c: any) => c.id === parsed.category_id);
      if (match) {
        categoryId = match.id;
        categoryName = match.name;
      }
    }

    if (!categoryId && parsed.category_name && typeof parsed.category_name === "string") {
      const nameMatch = userCategories.find(
        (c: any) => c.name.toLowerCase() === parsed.category_name.toLowerCase()
      );
      if (nameMatch) {
        categoryId = nameMatch.id;
        categoryName = nameMatch.name;
      }
    }

    // 4. Wallet Validation against DB list
    let walletId: string | null = null;
    let walletName: string | null = null;

    if (parsed.wallet_id && typeof parsed.wallet_id === "string") {
      const match = userWallets.find((w: any) => w.id === parsed.wallet_id);
      if (match) {
        walletId = match.id;
        walletName = match.name;
      }
    }

    if (!walletId && parsed.wallet_name && typeof parsed.wallet_name === "string") {
      const nameMatch = userWallets.find(
        (w: any) => w.name.toLowerCase() === parsed.wallet_name.toLowerCase()
      );
      if (nameMatch) {
        walletId = nameMatch.id;
        walletName = nameMatch.name;
      }
    }

    // 5. Date & Time Validation
    let date: string | null = null;
    if (typeof parsed.date === "string" && parsed.date.trim()) {
      const dStr = parsed.date.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(dStr)) {
        date = dStr;
      } else {
        const dMatch = dStr.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
        if (dMatch) {
          const day = dMatch[1].padStart(2, "0");
          const month = dMatch[2].padStart(2, "0");
          const year = dMatch[3];
          date = `${year}-${month}-${day}`;
        }
      }
    }
    if (!date) {
      date = currentDate;
    }

    let time: string | null = null;
    if (typeof parsed.time === "string" && parsed.time.trim()) {
      const tStr = parsed.time.trim();
      if (/^\d{1,2}:\d{2}$/.test(tStr)) {
        const parts = tStr.split(":");
        time = `${parts[0].padStart(2, "0")}:${parts[1]}`;
      }
    }

    // 6. Description
    const description = typeof parsed.description === "string" && parsed.description.trim() ? parsed.description.trim() : null;

    // 7. Check if AI could recognize anything meaningful
    const hasMeaningfulData = Boolean(amount || transactionType || categoryId || walletId || description);
    if (!hasMeaningfulData) {
      return NextResponse.json({
        success: false,
        error: "Không đủ thông tin để nhận diện giao dịch. Hãy nhập rõ số tiền và nội dung giao dịch.",
      });
    }

    const finalResult: AITransactionParseResult = {
      transaction_type: transactionType,
      amount: amount,
      currency: "VND",
      category_id: categoryId,
      category_name: categoryName,
      wallet_id: walletId,
      wallet_name: walletName,
      description: description,
      date: date,
      time: time,
      confidence_notes: Array.isArray(parsed.confidence_notes) ? parsed.confidence_notes : [],
    };

    return NextResponse.json({
      success: true,
      data: finalResult,
      meta: {
        model: usedModel,
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
