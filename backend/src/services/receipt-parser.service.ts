/**
 * AI Receipt Parser Service — business logic for multimodal image receipt extraction.
 *
 * Provider: Ollama (local/self-hosted, vision models) — không dùng Gemini API.
 *
 * NOTE: Receipt/image parsing requires an Ollama vision model (e.g. llava:7b).
 * Pull with: ollama pull llava:7b
 */

import type { ParsedReceiptResult, ReceiptItem, TransactionType } from "@/frontend/types/finance.types";
import {
  cleanMoneyAmount,
  cleanText,
  normalizeIsoDate,
  normalizeTime,
  parseAiJsonObject,
} from "./ai-output-validation.service";
import { OLLAMA_VISION_MODELS, DEFAULT_OLLAMA_BASE_URL } from "./ollama-models";

export interface ParseReceiptOptions {
  ollamaBaseUrl?: string;
  base64Data: string;
  mimeType: string;
  categoriesList?: string[];
  walletsList?: string[];
}

export interface ParseReceiptResult {
  success: boolean;
  data?: ParsedReceiptResult;
  error?: string;
  status: number;
  modelUsed?: string;
}

export const RECEIPT_SYSTEM_PROMPT = `Bạn là hệ thống AI chuyên gia trích xuất dữ liệu từ hình ảnh hóa đơn, chứng từ thanh toán và phiếu thu chi (AI Receipt Parser) cho ứng dụng quản lý chi tiêu Sổ Chi Tiêu.

QUY TẮC BẮT BUỘC VÀ NGHIÊM NGẶT:
1. Chỉ sử dụng dữ liệu thực sự nhìn thấy trên hình ảnh. Tuyệt đối không tự bịa đặt hoặc suy đoán thông tin bị thiếu.
2. Nếu không xác định được trường nào (ví dụ: mờ, bị rách, bị che, không có trên hóa đơn), trả về null.
3. Không tự tạo tên cửa hàng (merchant). Lấy chính xác tên đơn vị bán hàng/thương hiệu hiển thị trên đầu hóa đơn.
4. Không tự tạo ngày (date) hoặc giờ (time).
   - date phải ở định dạng chuẩn "YYYY-MM-DD" (Ví dụ: "2026-08-15"). Nếu hóa đơn ghi "15/08/2026" thì chuyển thành "2026-08-15".
   - time phải ở định dạng "HH:mm" (Ví dụ: "19:42" hoặc "08:30").
   - Nếu không có năm, dùng năm hiện tại. Nếu hoàn toàn không thấy ngày, trả về null.
5. Không tự đoán phương thức thanh toán (payment_method). Chỉ nhận diện nếu có chữ rõ ràng như: "Tiền mặt", "Cash", "Thẻ VISA", "Mastercard", "Chuyển khoản", "QR", "MoMo", "ZaloPay", "VNPay", "ShopeePay".
6. Không tự đoán địa chỉ cửa hàng (merchant_address) nếu không nhìn thấy.
7. Trường "total" (Tổng tiền thanh toán cuối cùng của hóa đơn):
   - BẮT BUỘC lấy đúng số tiền cần thanh toán thực tế của hóa đơn (Total / DINE IN Total / Amount Due / Tổng cộng / Tiền phải trả).
   - TUYỆT ĐỐI KHÔNG lấy tiền khách đưa (CASH / Tiền khách trả) hoặc tiền thối lại (Change / Tiền thừa).
   - Lưu ý một số hóa đơn có in thêm 2 số 0 ở phần thập phân (Ví dụ: 160,000.00 thì số tiền thực tế là 160000).
   - Số tiền phải là NUMBER nguyên, KHÔNG chứa ký tự tiền tệ, dấu chấm hay dấu phẩy (Ví dụ: 160000, 45000, 1500000).
8. Nếu ảnh KHÔNG PHẢI là hóa đơn, chứng từ mua sắm hoặc biên lai thanh toán (ví dụ: ảnh phong cảnh, ảnh người, ảnh tài liệu khác không liên quan đến chi tiêu/thu nhập), bạn PHẢI đặt "is_receipt": false, "document_type": "other", và trả về các trường khác là null.
9. "transaction_type": mặc định là "expense" (khoản chi) khi tài liệu là hóa đơn mua sắm hàng hóa/dịch vụ. Chỉ đặt là "income" khi tài liệu rõ ràng là phiếu thu tiền, biên lai chuyển khoản vào tài khoản, hoàn tiền hoặc giấy báo có.
10. "currency": Với hóa đơn Việt Nam có ký hiệu ₫, đ, VNĐ, VND hoặc tiền tệ Việt Nam, đặt "currency": "VND".
11. DANH MỤC ("category"):
   - BẮT BUỘC CHỈ ĐƯỢC CHỌN TỪ DANH SÁCH DANH MỤC ĐƯỢC CUNG CẤP TRONG PHẦN USER_CATEGORIES.
   - Chọn danh mục phù hợp nhất với hàng hóa/dịch vụ trên hóa đơn.
   - Nếu không có danh mục nào trong danh sách thực sự phù hợp, hoặc không đủ dữ liệu để chắc chắn, BẮT BUỘC trả về null.
12. "description": Tóm tắt ngắn gọn 1 câu về nội dung giao dịch (Ví dụ: "Ăn uống tại Jollibee", "Mua hàng tại Circle K", "Đổ xăng Petrolimex").
13. "items": Danh sách các sản phẩm/dịch vụ mua được liệt kê trên hóa đơn. Mỗi item gồm:
    - "name": Tên sản phẩm/dịch vụ (chuỗi)
    - "quantity": Số lượng (number hoặc null)
    - "unit_price": Đơn giá (number hoặc null)
    - "total_price": Thành tiền của mặt hàng đó (number hoặc null)
    Nếu hóa đơn không có bảng chi tiết từng món hoặc bị mờ, trả về mảng rỗng [].

BẮT BUỘC CHỈ TRẢ VỀ DUY NHẤT 1 ĐỐI TƯỢNG JSON HỢP LỆ (không kèm markdown, không kèm giải thích):
{
  "document_type": "receipt" | "invoice" | "other" | "unknown",
  "is_receipt": true | false,
  "merchant": string | null,
  "merchant_address": string | null,
  "transaction_type": "expense" | "income",
  "date": string | null,
  "time": string | null,
  "currency": "VND",
  "subtotal": number | null,
  "discount": number | null,
  "tax": number | null,
  "total": number | null,
  "payment_method": string | null,
  "category": string | null,
  "description": string | null,
  "items": [
    {
      "name": string,
      "quantity": number | null,
      "unit_price": number | null,
      "total_price": number | null
    }
  ]
}`;

export async function parseReceiptWithAI(options: ParseReceiptOptions): Promise<ParseReceiptResult> {
  const { base64Data, mimeType, categoriesList = [], walletsList = [] } = options;
  const baseUrl = ((options.ollamaBaseUrl ?? "") || DEFAULT_OLLAMA_BASE_URL).replace(/\/$/, "");

  if (!base64Data) {
    return {
      success: false,
      error: "Dữ liệu hình ảnh trống.",
      status: 400,
    };
  }
  if (base64Data.length > 14_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64Data)) {
    return { success: false, error: "Dữ liệu hình ảnh không hợp lệ hoặc vượt quá giới hạn.", status: 413 };
  }

  // Build context instruction with User Categories & Wallets
  const safeCategories = categoriesList.flatMap((item) => {
    const text = cleanText(item, 100);
    return text ? [text] : [];
  }).slice(0, 100);
  const safeWallets = walletsList.flatMap((item) => {
    const text = cleanText(item, 100);
    return text ? [text] : [];
  }).slice(0, 50);

  const categoriesPromptText = safeCategories.length > 0
    ? `\nUSER_CATEGORIES (Danh mục người dùng hiện có trong hệ thống):\n${JSON.stringify(safeCategories, null, 2)}\nHãy chọn 1 danh mục chính xác từ danh sách trên nếu phù hợp, hoặc trả về null nếu không chắc chắn.`
    : "\nKhông có danh mục nào được cung cấp. Hãy trả về null cho trường category.";

  const walletsPromptText = safeWallets.length > 0
    ? `\nUSER_WALLETS (Danh sách ví của người dùng):\n${JSON.stringify(safeWallets, null, 2)}`
    : "";

  const userPromptText = `Hãy phân tích hình ảnh hóa đơn/biên lai được đính kèm và trích xuất dữ liệu theo đúng định dạng JSON yêu cầu.${categoriesPromptText}${walletsPromptText}\n\nChỉ trả về JSON thuần túy (không kèm giải thích hay văn bản phụ, không kèm markdown code block).`;

  let lastError = "";
  let usedModel = "";

  for (const modelName of OLLAMA_VISION_MODELS) {
    try {
      // Ollama vision models support images via /api/generate with images array,
      // or /api/chat with image content parts.
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelName,
          system: RECEIPT_SYSTEM_PROMPT,
          prompt: userPromptText,
          images: [base64Data],
          stream: false,
          format: "json",
          options: {
            num_predict: 2048,
            temperature: 0.1,
          },
        }),
        signal: AbortSignal.timeout(60000), // 60s for vision tasks
      });

      if (res.ok) {
        const data = (await res.json()) as {
          response?: string;
          done?: boolean;
          error?: string;
        };

        if (data.error) {
          lastError = data.error;
          console.error(`Ollama OCR error for model ${modelName}:`, data.error);
          continue;
        }

        const rawReply = data.response?.trim();

        if (!rawReply) {
          return {
            success: false,
            error: "AI không thể đọc được nội dung từ ảnh này. Vui lòng chụp lại ảnh rõ nét và đủ sáng hơn.",
            status: 422,
          };
        }

        const parsed = parseAiJsonObject(rawReply);
        if (!parsed) {
          console.error("Ollama receipt parser returned invalid JSON.");
          return {
            success: false,
            error: "Dữ liệu AI trả về không đúng cấu trúc. Vui lòng thử lại hoặc chọn ảnh khác.",
            status: 502,
          };
        }

        usedModel = modelName;

        const isReceipt = parsed.is_receipt === true || parsed.document_type === "receipt" || parsed.document_type === "invoice";
        const allowedDocumentTypes = new Set<ParsedReceiptResult["document_type"]>(["receipt", "invoice", "other", "unknown"]);
        const documentType: ParsedReceiptResult["document_type"] =
          typeof parsed.document_type === "string" && allowedDocumentTypes.has(parsed.document_type as ParsedReceiptResult["document_type"])
            ? parsed.document_type as ParsedReceiptResult["document_type"]
            : (isReceipt ? "receipt" : "other");

        const total = cleanMoneyAmount(parsed.total, false);
        const subtotal = cleanMoneyAmount(parsed.subtotal);
        const discount = cleanMoneyAmount(parsed.discount);
        const tax = cleanMoneyAmount(parsed.tax);
        const date = normalizeIsoDate(parsed.date);
        const time = normalizeTime(parsed.time);

        const items: ReceiptItem[] = [];
        if (Array.isArray(parsed.items)) {
          for (const rawItem of parsed.items.slice(0, 100)) {
            if (rawItem && typeof rawItem === "object" && !Array.isArray(rawItem)) {
              const item = rawItem as Record<string, unknown>;
              const name = cleanText(item.name, 200);
              if (!name) continue;
              items.push({
                name,
                quantity: cleanMoneyAmount(item.quantity),
                unit_price: cleanMoneyAmount(item.unit_price),
                total_price: cleanMoneyAmount(item.total_price),
              });
            }
          }
        }

        let category: string | null = null;
        if (typeof parsed.category === "string" && parsed.category.trim()) {
          const rawCat = parsed.category.trim().toLowerCase();
          const matched = safeCategories.find(
            (c) => c.toLowerCase() === rawCat || c.toLowerCase().includes(rawCat) || rawCat.includes(c.toLowerCase())
          );
          if (matched) category = matched;
        }

        const warnings: string[] = [];
        if (!total || total <= 0) {
          warnings.push("Không đọc được tổng tiền rõ ràng. Vui lòng kiểm tra và nhập lại số tiền.");
        }
        if (!date) {
          warnings.push("Chưa xác định được ngày giao dịch trên hóa đơn.");
        }
        if (!category) {
          warnings.push("AI chưa xác định được danh mục phù hợp. Vui lòng chọn danh mục.");
        }
        if (!parsed.merchant) {
          warnings.push("Chưa đọc được tên cửa hàng/đơn vị.");
        }

        const result: ParsedReceiptResult = {
          document_type: documentType,
          is_receipt: isReceipt,
          merchant: cleanText(parsed.merchant, 200),
          merchant_address: cleanText(parsed.merchant_address, 300),
          transaction_type: (parsed.transaction_type === "income" ? "income" : "expense") as TransactionType,
          date,
          time,
          currency: "VND",
          subtotal,
          discount,
          tax,
          total,
          payment_method: cleanText(parsed.payment_method, 100),
          category,
          description: cleanText(parsed.description, 300),
          items,
          warnings,
        };

        return {
          success: true,
          data: result,
          modelUsed: usedModel,
          status: 200,
        };
      }

      const errBody = await res.text().catch(() => "");
      console.error(`Ollama OCR HTTP error for model ${modelName}: ${res.status}`, errBody.slice(0, 300));
      lastError = errBody;

      // Model not found — try next
      if (res.status === 404) {
        continue;
      }
      if (res.status >= 500) {
        break;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Failed Ollama OCR request for model ${modelName}:`, msg);
      lastError = msg;

      if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
        break;
      }
    }
  }

  const isUnavailable = lastError.includes("ECONNREFUSED") || lastError.includes("fetch failed");

  if (isUnavailable) {
    return {
      success: false,
      error: "Dịch vụ AI nội bộ chưa khởi động. Vui lòng kiểm tra Ollama đang chạy trên máy chủ.",
      status: 502,
    };
  }

  if (lastError.includes("does not support vision") || lastError.includes("image")) {
    return {
      success: false,
      error: "Mô hình AI hiện tại không hỗ trợ phân tích ảnh. Vui lòng cài đặt model llava: ollama pull llava:7b",
      status: 503,
    };
  }

  return {
    success: false,
    error: "Không thể phân tích hóa đơn lúc này. Vui lòng thử lại hoặc nhập thủ công.",
    status: 502,
  };
}


