/**
 * backend/src/services/receipt-parser.service.ts
 * ===============================================
 * AI Receipt Parser Service — multimodal vision extraction for invoices/receipts.
 *
 * Provider: Ollama (local/self-hosted vision models, e.g. llava:7b) via centralized ollama-client.
 * Security & Accuracy:
 * - Never logs base64 images or customer PII to console/telemetry.
 * - Explicit error handling when vision models are not installed (503).
 * - Leaves fields empty with warnings when unclear; never invents totals.
 * - Enforces deadline and client request cancellation.
 */

import type { ParsedReceiptResult, ReceiptItem, TransactionType } from "@/frontend/types/finance.types";
import {
  cleanMoneyAmount,
  cleanText,
  normalizeIsoDate,
  normalizeTime,
  parseAiJsonObject,
} from "./ai-output-validation.service";
import { executeOllamaVision, type OllamaClientError } from "./ollama-client.ts";

export interface ParseReceiptOptions {
  ollamaBaseUrl?: string;
  base64Data: string;
  mimeType: string;
  categoriesList?: string[];
  walletsList?: string[];
  signal?: AbortSignal;
  totalTimeoutMs?: number;
}

export interface ParseReceiptResult {
  success: boolean;
  data?: ParsedReceiptResult;
  error?: string;
  status: number;
  modelUsed?: string;
}

export const RECEIPT_SYSTEM_PROMPT = `Bạn là hệ thống AI chuyên gia trích xuất dữ liệu từ hình ảnh hóa đơn, chứng từ thanh toán và phiếu thu chi (AI Receipt Parser) cho ứng dụng quản lý chi tiêu Sổ Chi Tiêu.

QUY TẮC BẮT BUỘC:
1. Chỉ sử dụng dữ liệu thực sự nhìn thấy trên hình ảnh. Tuyệt đối không tự bịa đặt hoặc suy đoán thông tin bị thiếu.
2. Nếu không xác định được trường nào (ví dụ: mờ, bị rách, bị che, không có trên hóa đơn), trả về null.
3. Không tự tạo tên cửa hàng (merchant). Lấy chính xác tên đơn vị bán hàng/thương hiệu hiển thị trên hóa đơn.
4. Không tự tạo ngày (date) hoặc giờ (time).
   - date phải ở định dạng chuẩn "YYYY-MM-DD" (Ví dụ: "2026-08-15").
   - time phải ở định dạng "HH:mm".
   - Nếu không thấy ngày, trả về null.
5. Tổng tiền thanh toán cuối cùng của hóa đơn ("total"):
   - Lấy đúng số tiền cần thanh toán thực tế của hóa đơn (Total / Amount Due / Tổng cộng / Tiền phải trả).
   - TUYỆT ĐỐI KHÔNG lấy tiền khách đưa hoặc tiền thừa thối lại.
   - TUYỆT ĐỐI KHÔNG tự ý cộng dồn các món nếu có giảm giá, phụ thu, thuế hoặc phí chưa rõ ràng.
   - Nếu không nhìn thấy rõ tổng tiền, đặt "total": null.
6. Nếu ảnh KHÔNG PHẢI là hóa đơn, chứng từ thanh toán, đặt "is_receipt": false, "document_type": "other" và trả về các trường khác là null.
7. "transaction_type": mặc định là "expense" đối với hóa đơn mua sắm/dịch vụ. Chỉ đặt "income" nếu là phiếu thu tiền/biên lai nhận tiền.
8. "currency": Đặt "VND" nếu là tiền Việt Nam, hoặc "USD", "EUR" nếu hóa đơn ngoại tệ.

BẮT BUỘC TRẢ VỀ DUY NHẤT 1 OBJECT JSON HỢP LỆ:
{
  "document_type": "receipt" | "invoice" | "other" | "unknown",
  "is_receipt": true | false,
  "merchant": string | null,
  "merchant_address": string | null,
  "transaction_type": "expense" | "income",
  "date": string | null,
  "time": string | null,
  "currency": "VND" | string,
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
  const { base64Data, categoriesList = [], walletsList = [] } = options;

  if (!base64Data) {
    return {
      success: false,
      error: "Không tìm thấy dữ liệu ảnh hóa đơn.",
      status: 400,
    };
  }

  // Sanitize base64 payload
  const cleanBase64 = base64Data.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, "").trim();

  // Build prompt with available categories
  const safeCategories = categoriesList.slice(0, 50).map((c) => c.replace(/["\\]/g, ""));
  const safeWallets = walletsList.slice(0, 20).map((w) => w.replace(/["\\]/g, ""));

  const userPrompt = `${RECEIPT_SYSTEM_PROMPT}

DANH SÁCH DANH MỤC CỦA NGƯỜI DÙNG (USER_CATEGORIES):
${JSON.stringify(safeCategories, null, 2)}

DANH SÁCH VÍ CỦA NGƯỜI DÙNG (USER_WALLETS):
${JSON.stringify(safeWallets, null, 2)}

Hãy phân tích hình ảnh hóa đơn đính kèm và trích xuất đúng 1 JSON object thuần túy.`;

  // Execute Vision call via centralized Ollama client
  const visionRes = await executeOllamaVision({
    baseUrl: options.ollamaBaseUrl,
    prompt: userPrompt,
    base64Images: [cleanBase64],
    format: "json",
    totalTimeoutMs: options.totalTimeoutMs || 60_000,
    signal: options.signal,
  });

  if (!visionRes.success || !visionRes.content) {
    const err: OllamaClientError | undefined = visionRes.error;
    return {
      success: false,
      error: err?.messageVi || "Không thể phân tích hóa đơn lúc này. Vui lòng thử lại hoặc nhập thủ công.",
      status: err?.statusCode || 502,
    };
  }

  const parsed = parseAiJsonObject(visionRes.content);
  if (!parsed) {
    return {
      success: false,
      error: "Mô hình AI không trả về dữ liệu đúng định dạng JSON. Vui lòng thử lại với ảnh rõ nét hơn.",
      status: 502,
    };
  }

  const isReceipt = Boolean(parsed.is_receipt ?? true);
  const documentType = (cleanText(parsed.document_type, 50) ?? (isReceipt ? "receipt" : "other")) as ParsedReceiptResult["document_type"];

  if (!isReceipt || documentType === "other") {
    return {
      success: true,
      data: {
        document_type: "other",
        is_receipt: false,
        merchant: null,
        merchant_address: null,
        transaction_type: "expense",
        date: null,
        time: null,
        currency: "VND",
        subtotal: null,
        discount: null,
        tax: null,
        total: null,
        payment_method: null,
        category: null,
        description: "Hình ảnh tải lên không phải là hóa đơn hoặc chứng từ mua sắm hợp lệ.",
        items: [],
        warnings: ["Hình ảnh không được nhận diện là hóa đơn mua sắm."],
      },
      modelUsed: visionRes.modelUsed,
      status: 200,
    };
  }

  const total = cleanMoneyAmount(parsed.total, false);
  const subtotal = cleanMoneyAmount(parsed.subtotal, false);
  const discount = cleanMoneyAmount(parsed.discount, true);
  const tax = cleanMoneyAmount(parsed.tax, true);
  const date = normalizeIsoDate(parsed.date);
  const time = normalizeTime(parsed.time);
  const currency = typeof parsed.currency === "string" ? parsed.currency.trim().toUpperCase() : "VND";

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
      (c) => c.toLowerCase() === rawCat || c.toLowerCase().includes(rawCat) || rawCat.includes(c.toLowerCase()),
    );
    if (matched) category = matched;
  }

  const warnings: string[] = [];
  if (!total || total <= 0) {
    warnings.push("Không đọc được tổng tiền rõ ràng. Vui lòng kiểm tra và nhập lại số tiền trước khi lưu.");
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
    currency,
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
    modelUsed: visionRes.modelUsed,
    status: 200,
  };
}
