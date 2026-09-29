/**
 * backend/src/services/ai-parser.service.ts
 * ==========================================
 * AI Transaction Parser Service — NLP extraction for Vietnamese transactions.
 *
 * Provider: Ollama (local/self-hosted) via centralized ollama-client.
 * Capabilities:
 * - Structured JSON output validation.
 * - Multi-currency detection (VND, USD, etc. without auto-conversion).
 * - Transfer recognition (flags as internal transfer, not expense).
 * - Multi-transaction splitting into draft items.
 * - Fallback to deterministic smart-parser if Ollama service is unavailable.
 */

import type { AITransactionParseResult, TransactionType, Category, Wallet } from "@/frontend/types/finance.types";
import {
  cleanMoneyAmount,
  cleanText,
  normalizeIsoDate,
  normalizeTime,
  parseAiJsonObject,
} from "./ai-output-validation.service";
import { executeOllamaChat } from "./ollama-client.ts";
import { parseSmartTransaction } from "@/frontend/utils/smart-parser";

export interface UserWalletInfo {
  id: string;
  name: string;
  type: string;
  currency?: string;
  icon?: string;
}

export interface UserCategoryInfo {
  id: string;
  name: string;
  type: string;
  icon?: string;
}

export interface ParseTransactionOptions {
  ollamaBaseUrl?: string;
  rawText: string;
  userWallets: UserWalletInfo[];
  userCategories: UserCategoryInfo[];
  clientDate?: string;
  clientTime?: string;
  timezone?: string;
  signal?: AbortSignal;
}

export interface ParseTransactionResult {
  success: boolean;
  data?: AITransactionParseResult;
  error?: string;
  status: number;
  modelUsed?: string;
}

export const AI_PARSE_SYSTEM_PROMPT = `Bạn là hệ thống AI phân tích câu nhập giao dịch tài chính cho ứng dụng "Sổ Chi Tiêu".

NHIỆM VỤ:
Chuyển đổi câu nhập bằng tiếng Việt của người dùng thành dữ liệu giao dịch có cấu trúc (JSON).

QUY TẮC BẮT BUỘC:
1. "transaction_type":
   - "expense": Khoản chi (ăn, uống, mua, trả, đóng tiền, đổ xăng, xem phim, nạp game...)
   - "income": Khoản thu (nhận lương, thưởng, hoàn tiền, ba mẹ cho, bán đồ...)
   - "transfer": Chuyển tiền nội bộ giữa các ví/tài khoản (ví dụ: "chuyển 500k từ ví tiền mặt sang ngân hàng", "rút tiền ATM về ví")
   - null: Nếu không rõ
2. "amount":
   - Số tiền nguyên dương (number).
   - "35k" -> 35000, "70 nghìn" -> 70000, "12 triệu" -> 12000000, "1,5 triệu" / "1tr5" -> 1500000, "2 củ" -> 2000000.
3. "currency":
   - Mặc định là "VND".
   - Nếu câu nói rõ ngoại tệ (ví dụ "15 USD", "$15", "20 EUR"), giữ nguyên mã tiền tệ ("USD", "EUR"), TUYỆT ĐỐI KHÔNG tự quy đổi sang VND.
4. "category_id" & "category_name":
   - CHỈ ĐƯỢC CHỌN TỪ DANH SÁCH USER_CATEGORIES. Nếu không có danh mục phù hợp hoặc là transfer, đặt null.
5. "wallet_id" & "wallet_name":
   - CHỈ ĐƯỢC CHỌN TỪ DANH SÁCH USER_WALLETS nếu người dùng có nhắc đến ví cụ thể. Nếu không nhắc đến, đặt null.
6. Nếu là giao dịch chuyển tiền ("transfer"):
   - "is_transfer": true
   - "from_wallet_id" và "to_wallet_id" từ USER_WALLETS.
7. Nếu câu chứa nhiều giao dịch (ví dụ: "Ăn sáng 35k, cà phê 25k"):
   - Đặt "multiple_detected": true
   - "items": danh sách từng giao dịch con.

BẮT BUỘC TRẢ VỀ DUY NHẤT 1 OBJECT JSON HỢP LỆ:
{
  "transaction_type": "expense" | "income" | "transfer" | null,
  "amount": number | null,
  "currency": "VND" | "USD" | string,
  "category_id": string | null,
  "category_name": string | null,
  "wallet_id": string | null,
  "wallet_name": string | null,
  "is_transfer": boolean,
  "from_wallet_id": string | null,
  "to_wallet_id": string | null,
  "description": string | null,
  "date": "YYYY-MM-DD" | null,
  "time": "HH:mm" | null,
  "multiple_detected": boolean,
  "items": []
}`;

export async function parseTransactionWithAI(
  options: ParseTransactionOptions,
): Promise<ParseTransactionResult> {
  const { rawText, userWallets, userCategories } = options;

  if (!rawText || !rawText.trim()) {
    return {
      success: false,
      error: "Nội dung giao dịch không được để trống.",
      status: 400,
    };
  }

  const text = rawText.trim();
  const currentDate = options.clientDate || new Date().toISOString().slice(0, 10);
  const currentTime = options.clientTime || new Date().toTimeString().slice(0, 5);
  const timezone = options.timezone || "Asia/Ho_Chi_Minh";

  const systemContext = {
    current_date: currentDate,
    current_time: currentTime,
    timezone,
  };

  const userPromptContent = `SYSTEM_CONTEXT:
${JSON.stringify(systemContext, null, 2)}

USER_WALLETS:
${JSON.stringify(userWallets, null, 2)}

USER_CATEGORIES:
${JSON.stringify(userCategories, null, 2)}

CÂU NGƯỜI DÙNG NHẬP:
"${text}"`;

  // 1. Try Ollama AI first
  const chatRes = await executeOllamaChat({
    baseUrl: options.ollamaBaseUrl,
    messages: [
      { role: "system", content: AI_PARSE_SYSTEM_PROMPT },
      { role: "user", content: userPromptContent },
    ],
    format: "json",
    totalTimeoutMs: 25_000,
    signal: options.signal,
    temperature: 0.1,
  });

  if (chatRes.success && chatRes.content) {
    const parsed = parseAiJsonObject(chatRes.content);
    if (parsed) {
      const isTransfer = Boolean(parsed.is_transfer || parsed.transaction_type === "transfer");
      let transactionType: TransactionType | null = null;
      if (!isTransfer && (parsed.transaction_type === "expense" || parsed.transaction_type === "income")) {
        transactionType = parsed.transaction_type;
      }

      const amount = cleanMoneyAmount(parsed.amount, false);
      const currency = typeof parsed.currency === "string" ? parsed.currency.trim().toUpperCase() : "VND";

      // Verify category_id against real userCategories
      let categoryId: string | null = null;
      let categoryName: string | null = null;
      if (parsed.category_id && typeof parsed.category_id === "string") {
        const match = userCategories.find((c) => c.id === parsed.category_id);
        if (match) {
          categoryId = match.id;
          categoryName = match.name;
        }
      }

      // Verify wallet_id against real userWallets
      let walletId: string | null = null;
      let walletName: string | null = null;
      if (parsed.wallet_id && typeof parsed.wallet_id === "string") {
        const match = userWallets.find((w) => w.id === parsed.wallet_id);
        if (match) {
          walletId = match.id;
          walletName = match.name;
        }
      }

      const fromWalletId =
        typeof parsed.from_wallet_id === "string" && userWallets.some((w) => w.id === parsed.from_wallet_id)
          ? parsed.from_wallet_id
          : null;
      const toWalletId =
        typeof parsed.to_wallet_id === "string" && userWallets.some((w) => w.id === parsed.to_wallet_id)
          ? parsed.to_wallet_id
          : null;

      const date = normalizeIsoDate(parsed.date) ?? normalizeIsoDate(currentDate);
      const time = normalizeTime(parsed.time);
      const description = cleanText(parsed.description, 200) || text;

      const result: AITransactionParseResult = {
        transaction_type: isTransfer ? null : transactionType,
        amount,
        currency,
        category_id: categoryId,
        category_name: categoryName,
        wallet_id: walletId,
        wallet_name: walletName,
        description,
        date,
        time,
        is_draft: true,
        is_transfer: isTransfer,
        from_wallet_id: fromWalletId,
        to_wallet_id: toWalletId,
        needs_confirmation: !amount || (!isTransfer && !categoryId),
        confirmation_fields: [
          ...(!amount ? ["amount"] : []),
          ...(!isTransfer && !categoryId ? ["category_id"] : []),
          ...(!walletId && !fromWalletId ? ["wallet_id"] : []),
        ],
        confidence_notes: [`Phân tích bởi mô hình ${chatRes.modelUsed || "Ollama AI"}`],
      };

      return {
        success: true,
        data: result,
        modelUsed: chatRes.modelUsed,
        status: 200,
      };
    }
  }

  // 2. Fallback to deterministic SmartParser if Ollama is offline or returned bad output
  const smartResult = parseSmartTransaction(
    text,
    userCategories as unknown as Category[],
    userWallets as unknown as Wallet[],
  );

  const fallbackData: AITransactionParseResult = {
    transaction_type: smartResult.isTransfer ? null : smartResult.type,
    amount: smartResult.amount,
    currency: smartResult.currency || "VND",
    category_id: smartResult.categoryId,
    category_name: userCategories.find((c) => c.id === smartResult.categoryId)?.name ?? null,
    wallet_id: smartResult.walletId,
    wallet_name: userWallets.find((w) => w.id === smartResult.walletId)?.name ?? null,
    description: smartResult.name || text,
    date: smartResult.date ? smartResult.date.toISOString().slice(0, 10) : currentDate,
    time: null,
    is_draft: true,
    is_transfer: smartResult.isTransfer,
    from_wallet_id: smartResult.fromWalletId,
    to_wallet_id: smartResult.toWalletId,
    multiple_transactions_detected: smartResult.multipleDetected,
    needs_confirmation: !smartResult.amount || (!smartResult.isTransfer && !smartResult.categoryId),
    confirmation_fields: [
      ...(!smartResult.amount ? ["amount"] : []),
      ...(!smartResult.isTransfer && !smartResult.categoryId ? ["category_id"] : []),
    ],
    confidence_notes: ["Xử lý dự phòng bằng bộ phân tích thông minh nội bộ (Heuristic Fallback)"],
  };

  return {
    success: true,
    data: fallbackData,
    modelUsed: "smart_parser_fallback",
    status: 200,
  };
}
