/**
 * backend/src/services/ai-router.service.ts
 * =========================================
 * AI Intent Router & Conversational Context Resolver.
 *
 * Supported Canonical Intent Categories:
 * 1. PERSONAL_FINANCE: User's personal financial numbers (balances, wallets, transactions, spending breakdown).
 * 2. FINANCIAL_ADVICE: Financial advice, affordability analysis (What-If), multi-day spending planning.
 * 3. SYSTEM_KNOWLEDGE: App guides, feature walkthroughs, UI operations, Excel import/export.
 * 4. GENERAL_KNOWLEDGE: General economics, finance definitions (inflation, compound interest, budget definition, richest person).
 * 5. REALTIME_INFORMATION: Up-to-date market rates, breaking economic news, currency exchange rates.
 * 6. GENERAL_CHAT: Greetings, conversational pleasantries, bot capabilities, bot identity.
 *
 * Capabilities:
 * - Multi-intent detection: Combines multiple intents (e.g. general knowledge + personal finance).
 * - Multi-turn conversational memory: Inherits context and pronouns (e.g. "Với số tiền đó, tôi nên tiết kiệm bao nhiêu?").
 * - Diacritic-insensitive & typo-tolerant Vietnamese text normalization.
 */

import { parsePurchaseQuery, type ParsedAffordabilityQuery, type QueryCategory } from "./financial-tools.service.ts";
import {
  parseBudgetPlanQuery,
  type ParsedBudgetPlanQuery,
} from "./budget-planning.service.ts";
import {
  detectMultiTurnReference,
  type MultiTurnReferenceResult,
} from "./financial-simulation.service.ts";
import { resolveEntityFromHistory } from "./system-rag.service.ts";
import {
  detectPermittedCrudIntent,
  type DetectedCrudIntent,
} from "./ai-crud-tools.service.ts";
import { parseVietnameseAmount } from "../../../frontend/utils/smart-parser.ts";
import type { ChatMessage } from "../types/ai.types.ts";

export type CanonicalIntent =
  | "SYSTEM_HELP"
  | "FINANCIAL_QUERY"
  | "FINANCIAL_ANALYSIS"
  | "FINANCIAL_ADVICE"
  | "ACTION_REQUEST"
  | "GENERAL_CHAT"
  | "SIMPLE_CALCULATION";

export type UserIntent =
  | CanonicalIntent
  | "PERSONAL_FINANCE"
  | "SYSTEM_KNOWLEDGE"
  | "GENERAL_KNOWLEDGE"
  | "REALTIME_INFORMATION"
  | "CONVERSATION_SUMMARY"
  | "SIMPLE_CALCULATION";

export type FinancialFocusType =
  | "TOTAL_ASSETS"
  | "TOTAL_AVAILABLE"
  | "TOTAL_ALLOCATED"
  | "WALLET_BALANCE"
  | "WALLET_AVAILABLE"
  | "WALLET_ALLOCATED"
  | "HIGHEST_WALLET";

export interface WalletTargetQuery {
  targetWalletKeyword?: string;
  targetWalletType?: "cash" | "bank" | "ewallet" | "other";
  focusType: FinancialFocusType;
}

export interface TransactionStatisticsQueryParams {
  period?: "current_month" | "previous_month" | "custom" | "all";
  startDate?: string;
  endDate?: string;
  month?: number;
  year?: number;
  category?: string;
  type?: "income" | "expense";
}

export interface TransactionListQueryParams {
  period?: "current_month" | "previous_month" | "custom" | "all";
  startDate?: string;
  endDate?: string;
  month?: number;
  year?: number;
  category?: string;
  type?: "income" | "expense" | "transfer";
  minAmount?: number;
  maxAmount?: number;
  limit?: number;
}

export interface SimpleCalculationResult {
  type:
    | "SAVINGS_ACCUMULATION"
    | "SAVINGS_TARGET_RATE"
    | "NET_CASH_FLOW"
    | "PERCENTAGE"
    | "ARITHMETIC_DIFF";
  amount?: number;
  periods?: number;
  periodUnit?: "ngày" | "tuần" | "tháng" | "năm";
  targetAmount?: number;
  income?: number;
  expense?: number;
  result: number;
  explanationVi: string;
}

export interface RoutingResult {
  primaryIntent: UserIntent;
  canonicalIntent: CanonicalIntent;
  intents: UserIntent[];
  category: QueryCategory; // Backward compatible mapping
  requiresPersonalData: boolean;
  requiresFinancialAnalysis: boolean;
  requiresSystemRag: boolean;
  requiresRealtimeSearch: boolean;
  extractedAffordability?: ParsedAffordabilityQuery | null;
  extractedBudgetPlan?: ParsedBudgetPlanQuery | null;
  transactionStatisticsQuery?: TransactionStatisticsQueryParams | null;
  transactionListQuery?: TransactionListQueryParams | null;
  walletTargetQuery?: WalletTargetQuery | null;
  crudIntent?: DetectedCrudIntent | null;
  simpleCalculation?: SimpleCalculationResult | null;
  multiTurnRef?: MultiTurnReferenceResult | null;
  multiTurnContext?: {
    referencedAmount?: number;
    referencedItem?: string;
    referencedTopic?: string;
    multiTurnRef?: MultiTurnReferenceResult;
  };
}

/**
 * Remove Vietnamese accents for typo-tolerant fuzzy matching.
 */
export function removeVietnameseAccents(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

/**
 * Extract numerical figures from recent model responses in chat history.
 */
function extractRecentNumbersFromHistory(
  history: Array<{ role: string; parts?: Array<{ text: string }> }>,
): number[] {
  const numbers: number[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role === "model" || msg.role === "assistant") {
      const text = msg.parts?.[0]?.text || "";
      const matches = text.matchAll(/(?:[\s\b]|^)(\d{1,3}(?:\.\d{3})+|\d{4,9})\s*(?:vnd|đ|đồng)?/gi);
      for (const m of matches) {
        const clean = m[1].replace(/\./g, "");
        const val = parseFloat(clean);
        if (!isNaN(val) && val > 0 && !numbers.includes(val)) {
          numbers.push(val);
        }
      }
      if (numbers.length > 0) break;
    }
  }
  return numbers;
}

/**
 * Helper to parse transaction count & statistics query parameters.
 */
export function parseTransactionStatisticsQuery(
  rawText: string,
): TransactionStatisticsQueryParams | null {
  const text = rawText.toLowerCase().trim();
  const unaccented = removeVietnameseAccents(rawText);

  // If query is specifically asking to view/list/find records, delegate to parseTransactionListQuery
  const isListViewIntent =
    /(?:xem|danh sách|liệt kê|tìm|lọc|hiển thị|cho xem|cho tôi xem)\s+(?:các\s+)?(?:khoản\s+)?(?:giao dịch|chi tiêu|khoản chi|khoản thu|chi|thu)/i.test(text) ||
    /(?:xem|danh sach|liet ke|tim|loc|hien thi)\s+(?:cac\s+)?(?:khoan\s+)?(?:giao dich|chi tieu|khoan chi|khoan thu|chi|thu)/i.test(unaccented);

  const hasExplicitCountWord =
    /(?:bao nhiêu|mấy|đếm|tổng số|số lượng)\s+(?:giao dịch|khoản chi|khoản thu)/i.test(text) ||
    /có bao nhiêu (?:giao dịch|khoản chi|khoản thu)/i.test(text) ||
    /(?:bao nhieu|may|dem|tong so|so luong)\s+(?:giao dich|khoan chi|khoan thu)/i.test(unaccented);

  if (isListViewIntent && !hasExplicitCountWord) {
    return null;
  }

  const isStats =
    hasExplicitCountWord ||
    /(?:bao nhiêu|mấy|đếm|tổng số|số lượng)\s+(?:giao dịch|khoản chi|khoản thu|giao dịch chi|giao dịch thu)/i.test(text) ||
    (/(?:giao dịch|khoản chi|khoản thu)\s+(?:trong|của)?\s*(?:tháng|tuần|hôm|kỳ|toàn bộ|tất cả)/i.test(text) && !isListViewIntent) ||
    /thống kê (?:giao dịch|chi tiêu)/i.test(text) ||
    /có bao nhiêu (?:giao dịch|khoản chi|khoản thu)/i.test(text) ||
    /(?:bao nhieu|may|dem|tong so|so luong)\s+(?:giao dich|khoan chi|khoan thu)/i.test(unaccented) ||
    /co bao nhieu (?:giao dich|khoan chi|khoan thu)/i.test(unaccented);

  if (!isStats) return null;

  const result: TransactionStatisticsQueryParams = {
    period: "current_month",
  };

  if (/khoản chi|giao dịch chi|khoan chi/i.test(text) || /khoan chi/i.test(unaccented)) {
    result.type = "expense";
  } else if (/khoản thu|giao dịch thu|khoan thu/i.test(text) || /khoan thu/i.test(unaccented)) {
    result.type = "income";
  }

  if (/tháng trước|tháng vừa qua|thang truoc|thang vua qua/i.test(text) || /thang truoc/i.test(unaccented)) {
    result.period = "previous_month";
  } else if (/tất cả|toàn bộ|từ trước đến nay|tat ca|toan bo/i.test(text) || /tat ca|toan bo/i.test(unaccented)) {
    result.period = "all";
  } else {
    // Check specific date range e.g. "từ 01/10/2026 đến 30/10/2026" or "từ ngày 01/10/2026 đến ngày 30/10/2026"
    const dateRangeMatch =
      text.match(/từ(?:\s+ngày)?\s+(\d{1,2}[/-]\d{1,2}(?:[/-]\d{4})?)\s+đến(?:\s+ngày)?\s+(\d{1,2}[/-]\d{1,2}(?:[/-]\d{4})?)/i) ||
      unaccented.match(/tu(?:\s+ngay)?\s+(\d{1,2}[/-]\d{1,2}(?:[/-]\d{4})?)\s+den(?:\s+ngay)?\s+(\d{1,2}[/-]\d{1,2}(?:[/-]\d{4})?)/i);

    if (dateRangeMatch) {
      result.period = "custom";
      result.startDate = dateRangeMatch[1];
      result.endDate = dateRangeMatch[2];
    } else {
      // Check specific month e.g. "tháng 10" or "tháng 10/2026"
      const monthMatch =
        text.match(/tháng\s+(\d{1,2})(?:\s*[/_-\s]\s*(\d{4}))?/i) ||
        unaccented.match(/thang\s+(\d{1,2})(?:\s*[/_-\s]\s*(\d{4}))?/i);
      if (monthMatch) {
        const m = parseInt(monthMatch[1], 10);
        if (m >= 1 && m <= 12) {
          result.period = "custom";
          result.month = m;
          if (monthMatch[2]) {
            result.year = parseInt(monthMatch[2], 10);
          }
        }
      }
    }
  }

  return result;
}

/**
 * Helper to parse transaction listing and filtering query parameters.
 */
export function parseTransactionListQuery(
  rawText: string,
): TransactionListQueryParams | null {
  const text = rawText.toLowerCase().trim();
  const unaccented = removeVietnameseAccents(rawText);

  // If asking to count or get statistics, let statistics parser handle it
  const isCountExplicit =
    /(?:bao nhiêu|mấy|đếm|tổng số|số lượng)\s+(?:giao dịch|khoản chi|khoản thu)/i.test(text) ||
    /có bao nhiêu (?:giao dịch|khoản chi|khoản thu)/i.test(text) ||
    /(?:bao nhieu|may|dem|tong so|so luong)\s+(?:giao dich|khoan chi|khoan thu)/i.test(unaccented);
  if (isCountExplicit) return null;

  const isList =
    /(?:xem|danh sách|liệt kê|tìm|lọc|hiển thị|cho xem|cho tôi xem)\s+(?:các\s+)?(?:khoản\s+)?(?:giao dịch|chi tiêu|khoản chi|khoản thu|chi|thu)/i.test(text) ||
    /(?:xem|danh sach|liet ke|tim|loc|hien thi|cho xem|cho toi xem)\s+(?:cac\s+)?(?:khoan\s+)?(?:giao dich|chi tieu|khoan chi|khoan thu|chi|thu)/i.test(unaccented) ||
    /(?:các\s+)?(?:khoản\s+)?(?:chi tiêu|chi)\s+trong\s+(?:một\s+tháng|tháng\s+\d+|tháng\s+này)/i.test(text) ||
    /(?:cac\s+)?(?:khoan\s+)?(?:chi tieu|chi)\s+trong\s+(?:mot\s+thang|thang\s+\d+|thang\s+nay)/i.test(unaccented) ||
    /giao dịch trong tháng này/i.test(text) ||
    /giao dich trong thang nay/i.test(unaccented) ||
    /lọc giao dịch/i.test(text) ||
    /loc giao dich/i.test(unaccented);

  if (!isList) return null;

  const result: TransactionListQueryParams = {
    period: "current_month",
    limit: 15,
  };

  if (
    /(?:khoản chi tiêu|khoản chi|chi tiêu|các khoản chi|giao dịch chi)\b/i.test(text) ||
    /(?:khoan chi tieu|khoan chi|chi tieu|cac khoan chi)\b/i.test(unaccented)
  ) {
    result.type = "expense";
  } else if (
    /(?:khoản thu nhập|khoản thu|thu nhập|các khoản thu|giao dịch thu)\b/i.test(text) ||
    /(?:khoan thu nhap|khoan thu|thu nhap|cac khoan thu)\b/i.test(unaccented)
  ) {
    result.type = "income";
  } else if (/chuyển tiền|chuyển khoản|transfer/i.test(text) || /chuyen tien/i.test(unaccented)) {
    result.type = "transfer";
  }

  if (/tháng trước|tháng vừa qua|thang truoc|thang vua qua/i.test(text) || /thang truoc/i.test(unaccented)) {
    result.period = "previous_month";
  } else if (/tất cả|toàn bộ|từ trước đến nay|tat ca|toan bo/i.test(text) || /tat ca|toan bo/i.test(unaccented)) {
    result.period = "all";
  } else {
    const dateRangeMatch =
      text.match(/từ(?:\s+ngày)?\s+(\d{1,2}[/-]\d{1,2}(?:[/-]\d{4})?)\s+đến(?:\s+ngày)?\s+(\d{1,2}[/-]\d{1,2}(?:[/-]\d{4})?)/i) ||
      unaccented.match(/tu(?:\s+ngay)?\s+(\d{1,2}[/-]\d{1,2}(?:[/-]\d{4})?)\s+den(?:\s+ngay)?\s+(\d{1,2}[/-]\d{1,2}(?:[/-]\d{4})?)/i);

    if (dateRangeMatch) {
      result.period = "custom";
      result.startDate = dateRangeMatch[1];
      result.endDate = dateRangeMatch[2];
    } else {
      const monthMatch =
        text.match(/tháng\s+(\d{1,2})(?:\s*[/_-\s]\s*(\d{4}))?/i) ||
        unaccented.match(/thang\s+(\d{1,2})(?:\s*[/_-\s]\s*(\d{4}))?/i);
      if (monthMatch) {
        const m = parseInt(monthMatch[1], 10);
        if (m >= 1 && m <= 12) {
          result.period = "custom";
          result.month = m;
          if (monthMatch[2]) {
            result.year = parseInt(monthMatch[2], 10);
          }
        }
      }
    }
  }

  // Detect min / max amount filtering (e.g. "trên 1 triệu", "lớn hơn 500k", "từ 100k đến 500k")
  const minMatch = text.match(/(?:trên|lớn hơn|từ|ít nhất)\s+(\d+(?:\.\d+)?)\s*(triệu|tr|k|nghìn|vnd|đ)?/i);
  if (minMatch) {
    let num = parseFloat(minMatch[1].replace(/\./g, ""));
    const unit = (minMatch[2] || "").toLowerCase();
    if (unit === "triệu" || unit === "tr") num *= 1_000_000;
    else if (unit === "k" || unit === "nghìn") num *= 1_000;
    if (!isNaN(num) && num > 0) result.minAmount = num;
  }

  const maxMatch = text.match(/(?:dưới|nhỏ hơn|tối đa|đến)\s+(\d+(?:\.\d+)?)\s*(triệu|tr|k|nghìn|vnd|đ)?/i);
  if (maxMatch) {
    let num = parseFloat(maxMatch[1].replace(/\./g, ""));
    const unit = (maxMatch[2] || "").toLowerCase();
    if (unit === "triệu" || unit === "tr") num *= 1_000_000;
    else if (unit === "k" || unit === "nghìn") num *= 1_000;
    if (!isNaN(num) && num > 0) result.maxAmount = num;
  }

  return result;
}

/**
 * Detect specific target wallet and financial focus type from user query.
 */

/**
 * Parses simple mathematical or hypothetical calculations.
 * (e.g. "Nếu mỗi ngày tiết kiệm 20.000đ sau 30 ngày có bao nhiêu?",
 *        "Cần tiết kiệm bao nhiêu mỗi ngày để đạt 1 triệu trong 20 ngày?",
 *        "Nếu thu nhập 3.124.000đ và chi tiêu 65.000đ thì chênh lệch bao nhiêu?")
 */
export function parseSimpleCalculationQuery(rawText: string): SimpleCalculationResult | null {
  const text = rawText.trim();
  const lower = text.toLowerCase();
  const unacc = removeVietnameseAccents(text);

  // Exclude explicit questions asking about user's personal existing balances or goals
  if (/^(?:tôi|mình)\s+(?:đã|dang|đang)\s+(?:tiết kiệm|tích lũy)/i.test(lower) || /tôi có bao nhiêu tiền tiết kiệm/i.test(lower)) {
    return null;
  }
  if (/(?:mục tiêu|laptop).*đã tích lũy|còn thiếu bao nhiêu/i.test(lower)) {
    return null;
  }
  if (/muốn tạo mục tiêu|thêm mục tiêu/i.test(lower)) {
    return null;
  }

  // 1. Savings target rate: "Cần tiết kiệm bao nhiêu mỗi ngày để đạt 1 triệu trong 20 ngày?"
  const rateMatch1 = lower.match(/(?:cần|muốn|phải)\s+(?:tiết kiệm|để dành|tích lũy|dành)\s+bao nhiêu\s+(?:mỗi\s+)?(ngày|tuần|tháng|năm)\s+để\s+(?:đạt|có|được)\s+([^?]+?)\s*(?:trong|sau)\s+(\d+)\s*(ngày|tuần|tháng|năm)/i);
  const rateMatch2 = lower.match(/(?:để|muốn)\s+(?:đạt|có|được)\s+([^,]+?)\s*(?:trong|sau)\s+(\d+)\s*(ngày|tuần|tháng|năm)\s*(?:thì|,)?\s*(?:mỗi\s+)?(ngày|tuần|tháng|năm)?\s*(?:cần|phải|nên)?\s*(?:tiết kiệm|để dành|dành)\s+bao nhiêu/i);
  const rateMatch3 = lower.match(/(?:cần|muốn|phải)\s+(?:tiết kiệm|để dành|tích lũy|dành)\s+bao nhiêu\s+(?:mỗi\s+)?(ngày|tuần|tháng|năm)\s+để\s+(?:sau|trong)\s+(\d+)\s*(ngày|tuần|tháng|năm)\s+(?:có|đạt|được)\s+([^?]+)/i);

  if (rateMatch1 || rateMatch3) {
    const unit = (rateMatch1 ? rateMatch1[1] : rateMatch3[1]) as "ngày" | "tuần" | "tháng" | "năm";
    const targetRaw = rateMatch1 ? rateMatch1[2] : rateMatch3[4];
    const days = parseInt(rateMatch1 ? rateMatch1[3] : rateMatch3[2], 10);
    const targetParsed = parseVietnameseAmount(targetRaw);
    if (targetParsed.amount && days > 0) {
      const rate = Math.ceil(targetParsed.amount / days);
      return {
        type: "SAVINGS_TARGET_RATE",
        targetAmount: targetParsed.amount,
        periods: days,
        periodUnit: unit,
        result: rate,
        explanationVi: `Để đạt mục tiêu **${targetParsed.amount.toLocaleString("vi-VN")} VND** trong ${days} ${unit}, mỗi ${unit} bạn cần tiết kiệm:\n\n**${targetParsed.amount.toLocaleString("vi-VN")} VND ÷ ${days} ${unit} = ${rate.toLocaleString("vi-VN")} VND/${unit}**.`,
      };
    }
  }

  if (rateMatch2) {
    const targetRaw = rateMatch2[1];
    const days = parseInt(rateMatch2[2], 10);
    const unit = (rateMatch2[3] || rateMatch2[4] || "ngày") as "ngày" | "tuần" | "tháng" | "năm";
    const targetParsed = parseVietnameseAmount(targetRaw);
    if (targetParsed.amount && days > 0) {
      const rate = Math.ceil(targetParsed.amount / days);
      return {
        type: "SAVINGS_TARGET_RATE",
        targetAmount: targetParsed.amount,
        periods: days,
        periodUnit: unit,
        result: rate,
        explanationVi: `Để đạt mục tiêu **${targetParsed.amount.toLocaleString("vi-VN")} VND** trong ${days} ${unit}, mỗi ${unit} bạn cần tiết kiệm:\n\n**${targetParsed.amount.toLocaleString("vi-VN")} VND ÷ ${days} ${unit} = ${rate.toLocaleString("vi-VN")} VND/${unit}**.`,
      };
    }
  }

  // 2. Savings accumulation:
  // "Nếu mỗi ngày tiết kiệm 20.000đ trong 30 ngày, tôi có bao nhiêu?"
  // "Tiết kiệm 20.000đ mỗi ngày trong 30 ngày"
  // "Nếu tiết kiệm 50.000đ mỗi ngày trong 7 ngày thì được bao nhiêu?"
  const accumMatch1 = lower.match(/(?:nếu\s+)?mỗi\s*(ngày|tuần|tháng|năm)\s*(?:tiết kiệm|để dành|tích lũy|dành dụm|chi|tiêu)\s+([^,]+?)[,\s]+(?:cả\s+(?:tháng|tuần|năm)\s+)?(?:trong|sau|được)?\s*(\d+)\s*(ngày|tuần|tháng|năm)/i);
  const accumMatch2 = lower.match(/(?:nếu\s+)?(?:tiết kiệm|để dành|tích lũy|dành dụm)\s+([^,]+?)[,\s]+(?:mỗi|hàng)\s*(ngày|tuần|tháng|năm)[,\s]*(?:trong|sau|được)\s+(\d+)\s*(ngày|tuần|tháng|năm)/i);
  const accumMatch3 = lower.match(/(?:nếu\s+)?(?:tiết kiệm|để dành|tích lũy|dành dụm)\s+([^,]+?)\s*(?:trong|sau)\s+(\d+)\s*(ngày|tuần|tháng|năm)/i);

  if (accumMatch1) {
    const unit = accumMatch1[1] as "ngày" | "tuần" | "tháng" | "năm";
    const amtRaw = accumMatch1[2];
    const days = parseInt(accumMatch1[3], 10);
    const amtParsed = parseVietnameseAmount(amtRaw);
    if (amtParsed.amount && days > 0) {
      const total = amtParsed.amount * days;
      return {
        type: "SAVINGS_ACCUMULATION",
        amount: amtParsed.amount,
        periods: days,
        periodUnit: unit,
        result: total,
        explanationVi: `Nếu mỗi ${unit} tiết kiệm **${amtParsed.amount.toLocaleString("vi-VN")} VND**, sau ${days} ${unit} bạn sẽ có:\n\n**${amtParsed.amount.toLocaleString("vi-VN")} VND × ${days} ${unit} = ${total.toLocaleString("vi-VN")} VND**.`,
      };
    }
  }

  if (accumMatch2) {
    const amtRaw = accumMatch2[1];
    const unit = accumMatch2[2] as "ngày" | "tuần" | "tháng" | "năm";
    const days = parseInt(accumMatch2[3], 10);
    const amtParsed = parseVietnameseAmount(amtRaw);
    if (amtParsed.amount && days > 0) {
      const total = amtParsed.amount * days;
      return {
        type: "SAVINGS_ACCUMULATION",
        amount: amtParsed.amount,
        periods: days,
        periodUnit: unit,
        result: total,
        explanationVi: `Nếu mỗi ${unit} tiết kiệm **${amtParsed.amount.toLocaleString("vi-VN")} VND**, sau ${days} ${unit} bạn sẽ có:\n\n**${amtParsed.amount.toLocaleString("vi-VN")} VND × ${days} ${unit} = ${total.toLocaleString("vi-VN")} VND**.`,
      };
    }
  }

  if (accumMatch3 && !accumMatch2 && !accumMatch1) {
    const amtRaw = accumMatch3[1];
    const days = parseInt(accumMatch3[2], 10);
    const unit = accumMatch3[3] as "ngày" | "tuần" | "tháng" | "năm";
    const amtParsed = parseVietnameseAmount(amtRaw);
    if (amtParsed.amount && days > 0) {
      const total = amtParsed.amount * days;
      return {
        type: "SAVINGS_ACCUMULATION",
        amount: amtParsed.amount,
        periods: days,
        periodUnit: unit,
        result: total,
        explanationVi: `Nếu tiết kiệm **${amtParsed.amount.toLocaleString("vi-VN")} VND** mỗi ${unit}, sau ${days} ${unit} bạn sẽ có:\n\n**${amtParsed.amount.toLocaleString("vi-VN")} VND × ${days} ${unit} = ${total.toLocaleString("vi-VN")} VND**.`,
      };
    }
  }

  // 3. Difference / Net Cash Flow calculation:
  // "Nếu thu nhập 3.124.000đ và chi tiêu 65.000đ thì chênh lệch bao nhiêu?"
  const diffMatch =
    lower.match(/(?:thu nhập|lương|thu)\s+([0-9.,]+\s*(?:k|triệu|tr|nghìn|đ|vnd)?)\s*(?:và|,)?\s*(?:chi tiêu|chi|tiêu)\s+([0-9.,]+\s*(?:k|triệu|tr|nghìn|đ|vnd)?)[,\s]*(?:thì\s+)?(?:tôi\s+)?(?:chênh lệch|còn lại|còn dư|còn|thặng dư)/i) ||
    lower.match(/(?:thu nhập|lương|thu)\s+([^,]+?)\s*(?:và|,)?\s*(?:chi tiêu|chi|tiêu)\s+([^,]+?)\s*(?:thì\s+)?(?:chênh lệch|còn lại|còn|thặng dư)/i) ||
    lower.match(/(?:chênh lệch|còn lại)\s+(?:khi|nếu)?\s*(?:thu nhập|lương|thu)\s+([^,]+?)\s*(?:và|,)?\s*(?:chi tiêu|chi|tiêu)\s+([^,]+)/i);

  if (diffMatch) {
    const incParsed = parseVietnameseAmount(diffMatch[1]);
    const expParsed = parseVietnameseAmount(diffMatch[2]);
    if (incParsed.amount && expParsed.amount) {
      const diff = incParsed.amount - expParsed.amount;
      return {
        type: "NET_CASH_FLOW",
        income: incParsed.amount,
        expense: expParsed.amount,
        result: diff,
        explanationVi:
          `Với thu nhập **${incParsed.amount.toLocaleString("vi-VN")} VND** và chi tiêu **${expParsed.amount.toLocaleString("vi-VN")} VND**:\n\n` +
          `- **Chênh lệch thu chi:** **${incParsed.amount.toLocaleString("vi-VN")} VND - ${expParsed.amount.toLocaleString("vi-VN")} VND = ${diff.toLocaleString("vi-VN")} VND**.\n` +
          `- **Ý nghĩa tài chính:** Đây là khoản thặng dư dòng tiền chưa chi trong kỳ, *không phải số tiền đã tự động được gửi vào mục tiêu tiết kiệm*.`,
      };
    }
  }

  // 4. Percentage calculation:
  // "2.650.000 trên 3.000.000 là bao nhiêu %?"
  const pctMatch = lower.match(/(?:chi\s+)?([0-9.,]+\s*(?:k|triệu|tr|nghìn|đ|vnd)?)\s*(?:trên|\/|trong tổng số)\s*(?:thu nhập\s+)?([0-9.,]+\s*(?:k|triệu|tr|nghìn|đ|vnd)?)\s*(?:chiếm|là|được)?\s*bao nhiêu\s*(?:%|phần trăm)/i);
  if (pctMatch) {
    const part = parseVietnameseAmount(pctMatch[1]);
    const whole = parseVietnameseAmount(pctMatch[2]);
    if (part.amount && whole.amount && whole.amount > 0) {
      const pct = (part.amount / whole.amount) * 100;
      const pctStr = pct.toFixed(1).replace(/\.0$/, "");
      return {
        type: "PERCENTAGE",
        amount: part.amount,
        targetAmount: whole.amount,
        result: pct,
        explanationVi: `Tỷ lệ của **${part.amount.toLocaleString("vi-VN")} VND** trên **${whole.amount.toLocaleString("vi-VN")} VND** là:\n\n**(${part.amount.toLocaleString("vi-VN")} ÷ ${whole.amount.toLocaleString("vi-VN")}) × 100% = ${pctStr}%**.`,
      };
    }
  }

  return null;
}

export function detectWalletTarget(rawText: string): WalletTargetQuery {
  const text = rawText.toLowerCase().trim();
  const unaccented = removeVietnameseAccents(rawText);

  // 1. Detect target wallet keyword & type
  let targetWalletKeyword: string | undefined;
  let targetWalletType: "cash" | "bank" | "ewallet" | "other" | undefined;

  if (
    /tiền\s+mặt|ví\s+tiền\s+mặt|trong\s+ví\s+tiền\s+mặt|bằng\s+tiền\s+mặt/i.test(text) ||
    /vi\s+tien\s+mat|trong\s+vi\s+tien\s+mat|bang\s+tien\s+mat|\btien\s+mat\b(?!\s*(?:gia|di|hut))/i.test(unaccented)
  ) {
    if (!/tiền\s+mất|tien\s+mat\s+gia/i.test(text) && !/tien\s+mat\s+gia/i.test(unaccented)) {
      targetWalletKeyword = "tiền mặt";
      targetWalletType = "cash";
    }
  } else if (
    /ngân hàng|tài khoản ngân hàng|trong ngân hàng|tiền ngân hàng|vcb|vietcombank|techcombank|tpbank|bidv|agribank|\bmb\b|\bacb\b/i.test(text) ||
    /ngan hang|tai khoan ngan hang|trong ngan hang|tien ngan hang/i.test(unaccented)
  ) {
    targetWalletKeyword = "ngân hàng";
    targetWalletType = "bank";
  } else if (
    /momo|zalopay|zalo pay|viettel money|shopeepay|shopee pay|ví điện tử/i.test(text) ||
    /vi dien tu/i.test(unaccented)
  ) {
    targetWalletKeyword = "ví điện tử";
    targetWalletType = "ewallet";
  }

  // 2. Detect Focus Type
  let focusType: FinancialFocusType = "TOTAL_ASSETS";

  if (
    /ví nào.*nhiều.*tiền nhất|nhiều tiền nhất|ví nào.*lớn nhất|ví.*nhiều nhất/i.test(text) ||
    /vi nao.*nhieu.*tien nhat|nhieu tien nhat|vi nao.*lon nhat/i.test(unaccented)
  ) {
    focusType = "HIGHEST_WALLET";
  } else if (
    /đã phân bổ|phân bổ bao nhiêu|giữ chỗ bao nhiêu/i.test(text) ||
    /da phan bo|phan bo bao nhieu/i.test(unaccented)
  ) {
    focusType = targetWalletKeyword ? "WALLET_ALLOCATED" : "TOTAL_ALLOCATED";
  } else if (
    /khả dụng|tiền khả dụng|dùng được bao nhiêu|chi tiêu được bao nhiêu/i.test(text) ||
    /kha dung|tien kha dung|dung duoc bao nhieu/i.test(unaccented)
  ) {
    focusType = targetWalletKeyword ? "WALLET_AVAILABLE" : "TOTAL_AVAILABLE";
  } else if (targetWalletKeyword) {
    focusType = "WALLET_BALANCE";
  } else if (
    /tổng tài sản|tổng số dư|tổng tiền|tôi có bao nhiêu tiền|tôi còn bao nhiêu tiền/i.test(text) ||
    /tong tai san|tong so du|tong tien|toi co bao nhieu tien|toi con bao nhieu tien/i.test(unaccented)
  ) {
    focusType = "TOTAL_ASSETS";
  }

  return {
    targetWalletKeyword,
    targetWalletType,
    focusType,
  };
}

/**
 * Intent Router: Classify incoming user query into canonical intents.
 */
export function routeUserIntent(
  message: string,
  history: Array<{ role: string; parts?: Array<{ text: string }> }> = [],
  userId?: string,
): RoutingResult {
  const rawText = message.trim();
  const text = rawText.toLowerCase();
  const unaccented = removeVietnameseAccents(rawText);

  // 0. Check Simple Math / Hypothetical Calculation (0ms, 100% deterministic, no DB needed)
  const simpleCalculation = parseSimpleCalculationQuery(rawText);
  if (simpleCalculation) {
    return {
      primaryIntent: "SIMPLE_CALCULATION",
      canonicalIntent: "SIMPLE_CALCULATION",
      intents: ["SIMPLE_CALCULATION"],
      category: "GENERAL_CHAT",
      requiresPersonalData: false,
      requiresFinancialAnalysis: false,
      requiresSystemRag: false,
      requiresRealtimeSearch: false,
      simpleCalculation,
    };
  }

  const intents: Set<UserIntent> = new Set();
  let multiTurnContext: RoutingResult["multiTurnContext"];
  const crudIntent = detectPermittedCrudIntent(rawText, history as ChatMessage[], userId);

  // -------------------------------------------------------------------------
  // 1. Check Multi-turn Conversational References ("Với số tiền đó", "Nếu mua điện thoại đó...", "Số tiền còn lại đó...")
  // -------------------------------------------------------------------------
  const multiTurnRef = detectMultiTurnReference(rawText, history);
  if (multiTurnRef.hasReference && history.length > 0) {
    intents.add("FINANCIAL_ADVICE");
    multiTurnContext = {
      referencedAmount: multiTurnRef.referencedPurchase?.price,
      referencedItem: multiTurnRef.referencedPurchase?.itemName,
      referencedTopic: multiTurnRef.referenceType,
      multiTurnRef,
    };
  }

  const isMultiTurnFollowUp =
    /với số tiền (đó|này|kia)|với số dư (đó|này)|tiết kiệm bao nhiêu|vậy có nên (mua|chi)|còn cái đó thì sao|sau đó thì sao/i.test(
      text,
    ) ||
    /voi so tien (do|nay)|voi so du (do|nay)|tiet kiem bao nhieu|vay co nen/i.test(unaccented);

  if (isMultiTurnFollowUp && history.length > 0) {
    const recentNums = extractRecentNumbersFromHistory(history);
    const lastNum = recentNums.length > 0 ? recentNums[recentNums.length - 1] : undefined;
    multiTurnContext = {
      ...multiTurnContext,
      referencedAmount: multiTurnContext?.referencedAmount ?? lastNum,
      referencedTopic: "savings_planning",
    };
    intents.add("FINANCIAL_ADVICE");
  }

  // -------------------------------------------------------------------------
  // 1b. Check CONVERSATION_SUMMARY ("Tóm tắt những điều chúng ta vừa trao đổi")
  // -------------------------------------------------------------------------
  const isSummaryQuery =
    /(?:tóm tắt|tong ket|tổng kết|nhắc lại|điểm lại|vừa trao đổi|vừa nói gì|nội dung vừa rồi|tóm tắt lại)/i.test(text) ||
    /(?:tom tat|tong ket|nhac lai|diem lai|vua trao doi|vua noi gi)/i.test(unaccented);

  if (isSummaryQuery && history.length > 0) {
    intents.add("CONVERSATION_SUMMARY");
  }

  // -------------------------------------------------------------------------
  // 2. Check GENERAL_CHAT (Greetings, bot identity, polite closing)
  // -------------------------------------------------------------------------
  const isGeneralChat =
    /\b(xin chào|chào bạn|chào em|chào bot|hello|hi|alo)\b/i.test(text) ||
    /\b(bạn là ai|bạn tên là gì|bạn có thể làm gì|bạn có thể giúp gì|bạn giúp được gì|giới thiệu bản thân)\b/i.test(text) ||
    /\b(cảm ơn|cảm ơn bạn|thanks|thank you|tạm biệt|bye)\b/i.test(text) ||
    /\b(xin chao|chao ban|chao em|ban la ai|ban ten la gi|ban co the giup gi|cam on|tam biet)\b/i.test(unaccented);

  // If general chat and doesn't contain explicit personal finance query, add GENERAL_CHAT
  if (isGeneralChat) {
    intents.add("GENERAL_CHAT");
  }

  // -------------------------------------------------------------------------
  // 3. Check REALTIME_INFORMATION (Realtime news, today's market, live gold/exchange rates)
  // -------------------------------------------------------------------------
  const isRealtimeQuery =
    /hôm nay có tin tức (kinh tế|tài chính|thị trường|gì)/i.test(text) ||
    /tin tức (kinh tế|tài chính|chứng khoán|thị trường|nổi bật) (hôm nay|mới nhất|hiện nay)/i.test(text) ||
    /giá vàng (hôm nay|hiện tại|ngày hôm nay|mới nhất)/i.test(text) ||
    /giá bitcoin (hôm nay|hiện tại)/i.test(text) ||
    /tỷ giá (usd|eur|ngoại tệ) (hôm nay|hiện tại)/i.test(text) ||
    /thị trường chứng khoán hôm nay/i.test(text) ||
    /tin tuc (kinh te|tai chinh|thi truong) (hom nay|moi nhat)/i.test(unaccented) ||
    /gia vang (hom nay|hien tai)/i.test(unaccented);

  if (isRealtimeQuery) {
    intents.add("REALTIME_INFORMATION");
  }

  // -------------------------------------------------------------------------
  // 4. Check GENERAL_KNOWLEDGE (Macroeconomics, financial definitions, famous figures)
  // -------------------------------------------------------------------------
  const isBillionaireQuery =
    /người giàu nhất (thế giới|việt nam|hành tinh)|ai là người giàu nhất|ai giàu nhất/i.test(text) ||
    /tài sản của (elon musk|warren buffett|jeff bezos|bill gates|mark zuckerberg|larry ellison|bernard arnault)/i.test(text) ||
    /nguoi giau nhat (the gioi|viet nam)|ai la nguoi giau nhat/i.test(unaccented) ||
    /tai san cua (elon musk|warren buffett|jeff bezos|bill gates|mark zuckerberg)/i.test(unaccented);

  if (isBillionaireQuery) {
    intents.add("REALTIME_INFORMATION");
  }

  const isGeneralKnowledge =
    isBillionaireQuery ||
    (/(?:khái niệm|định nghĩa|thế nào là)?\s*(?:ngân sách|lạm phát|lãi suất kép|chứng khoán|trái phiếu|cổ phiếu|etf|gdp|giảm phát|suy thoái|quỹ etf|tiền điện tử|tiền mã hóa)\s*(?:là gì|như thế nào|được hiểu là gì)\b/i.test(
      text,
    ) && !/khác biệt|so sánh|mục tiêu|quỹ phong bì/i.test(text)) ||
    (/(?:khai niem|dinh nghia|the nao la)?\s*(?:ngan sach|lam phat|lai suat kep|chung khoan|trai phieu|co phieu|gdp)\s*(?:la gi|nhu the nao)\b/i.test(
      unaccented,
    ) && !/khac biet|so sanh|muc tieu|quy phong bi/i.test(unaccented)) ||
    /quy tắc 50\/30\/20 là gì|quy tắc 6 chiếc lọ là gì/i.test(text) ||
    /lịch sử tiền tệ|tại sao lại có lạm phát/i.test(text);

  if (isGeneralKnowledge) {
    intents.add("GENERAL_KNOWLEDGE");
  }

  // -------------------------------------------------------------------------
  // 5. Check SYSTEM_KNOWLEDGE (App guides, how-to, features of Sổ Chi Tiêu)
  // -------------------------------------------------------------------------
  const resolvedSystemEntity = resolveEntityFromHistory(rawText, history);
  const isSystemFollowUp =
    Boolean(resolvedSystemEntity) ||
    /(?:vậy\s+)?(?:chức năng|tính năng)\s+(?:đó|này)\s+(?:hoạt động|dùng|thực hiện)\s+như thế nào/i.test(text) ||
    /(?:có\s+)?(?:tốn|mất)\s+phí\s+không/i.test(text) ||
    /nếu làm vậy.*thì số dư có bị trừ không/i.test(text) ||
    /làm sao để sử dụng nó/i.test(text) ||
    /vay chuc nang do hoat dong nhu the nao|co ton phi khong|co mat phi khong/i.test(unaccented);

  const isSystemKnowledge =
    isSystemFollowUp ||
    /hệ thống (sổ chi tiêu|này)?\s*(có những|có)?\s*(chức năng|tính năng|công dụng|dùng để làm gì)/i.test(text) ||
    /sổ chi tiêu có những chức năng/i.test(text) ||
    /sổ chi tiêu là gì|ứng dụng sổ chi tiêu/i.test(text) ||
    /(?:làm sao|làm thế nào|hướng dẫn)\s+để\s+(?:tạo|thêm|xóa|sửa|quét|nhập|xuất|chuyển)/i.test(text) ||
    /(?:cách|hướng dẫn)\s+(?:tạo|thêm|xóa|sửa|quét|nhập|xuất|chuyển|sử dụng)\s+(?:giao dịch|ngân sách|ví|mục tiêu|hóa đơn|excel|csv|tiền)/i.test(text) ||
    /(?:chức năng|tính năng)\s+.*(?:hoạt động như thế nào|dùng như thế nào|ra sao)/i.test(text) ||
    /(?:khác biệt|sự khác biệt|so sánh)\s+(?:giữa)?\s*ngân sách\s*(?:và|với)?\s*mục tiêu/i.test(text) ||
    /(?:tại sao|vì sao)?\s*(?:số dư\s+)?khả dụng\s*(?:lại)?\s*thấp hơn\s*(?:tổng)?\s*số dư ví/i.test(text) ||
    /xuất (?:toàn bộ dữ liệu|dữ liệu|báo cáo)?\s*(?:ra\s+)?excel\s*(?:thì\s+)?(?:làm\s+)?ở đâu/i.test(text) ||
    /tự động nhận diện giao dịch định kỳ/i.test(text) ||
    /admin có (?:thể\s+)?xem được chi tiêu/i.test(text) ||
    /(?:ứng dụng|hệ thống|app)\s+.*(?:công nghệ gì|tech stack|frontend và backend)/i.test(text) ||
    /cài đặt cảnh báo ngân sách|phân quyền admin|bảo mật hệ thống|quỹ phong bì là gì/i.test(text) ||
    /he thong so chi tieu|lam the nao de|cach (tao|them|xoa|sua|xuat|chuyen) (giao dich|ngan sach|vi|excel|tien)/i.test(
      unaccented,
    ) ||
    /su khac biet giua ngan sach va muc tieu/i.test(unaccented) ||
    /admin co the xem duoc chi tieu/i.test(unaccented) ||
    /chuc nang quet hoa don hoat dong nhu the nao/i.test(unaccented) ||
    /(?:hệ thống|app|ứng dụng)?\s*(?:có\s+)?(?:hỗ trợ|cho phép|nhập được|import được|tải lên được)?\s*(?:nhập|import|tải lên)?\s*(?:dữ liệu\s+)?(?:từ\s+)?(?:file\s+)?(?:excel|csv|sao kê)/i.test(text) ||
    /(?:có\s+thể|được|làm sao để)?\s*(?:chỉnh sửa|sửa|thay đổi|cập nhật)\s+(?:giao dịch|khoản chi|khoản thu)/i.test(text) ||
    /(?:nếu|khi)?\s*xóa\s+giao\s*dịch.*(?:số dư|tiền).*(?:thay đổi|ảnh hưởng|tính lại|như thế nào|ra sao)/i.test(text) ||
    /(?:hệ thống|app)?\s*(?:có\s+)?(?:chuyển đổi|quy đổi|đổi)\s*(?:giữa\s+)?(?:vnd|usd|ngoại tệ)/i.test(text) ||
    /(?:quy tắc|nguyên tắc)\s+(?:kế toán|ghi nhận|hoàn tác|cô lập tiền tệ)/i.test(text) ||
    /he thong (co ho tro|co cho phep|nhap duoc|co nhap duoc)?.*(excel|csv)/i.test(unaccented) ||
    /co the (chinh sua|sua) giao dich/i.test(unaccented) ||
    /xoa giao dich.*(so du|tien).*(thay doi|anh huong|nhu the nao|ra sao)/i.test(unaccented) ||
    /chuyen doi (vnd|usd)/i.test(unaccented);

  // Exclude personal queries from purely system queries
  const isAdminPrivacyQuery =
    /admin (?:có|co) (?:thể|the)?\s*(?:xem|nhìn|biết|truy cập)/i.test(text) ||
    /admin (?:có|co) (?:thể|the)?\s*(?:xem|nhin|biet|truy cap)/i.test(unaccented);

  const isPureSystemHowTo =
    /(?:làm sao|làm thế nào|hướng dẫn)\s+để\s+(?:tạo|thêm|xóa|sửa|quét|nhập|xuất|chuyển)/i.test(text) ||
    /xuất .*excel.* ở đâu/i.test(text) ||
    /tự động nhận diện giao dịch định kỳ/i.test(text) ||
    /chức năng quét hóa đơn hoạt động/i.test(text) ||
    /công nghệ gì/i.test(text) ||
    /sự khác biệt/i.test(text) ||
    /hỗ trợ.*(excel|csv)/i.test(text) ||
    /chỉnh sửa giao dịch/i.test(text) ||
    /xóa giao dịch/i.test(text) ||
    /chuyển đổi.*(vnd|usd)/i.test(text);

  const isPersonalQueryIndicator =
    !isAdminPrivacyQuery &&
    !isPureSystemHowTo &&
    (/của tôi|của mình|tôi có bao nhiêu|tôi đã chi|cho tôi biết số dư|ví của tôi còn|ngân sách của tôi còn|tôi còn bao nhiêu/i.test(text) ||
     /cua toi|cua minh|toi co bao nhieu|toi da chi|cho toi biet so du|toi con bao nhieu/i.test(unaccented));

  if (isSystemKnowledge && !isPersonalQueryIndicator) {
    intents.add("SYSTEM_KNOWLEDGE");
  }

  // -------------------------------------------------------------------------
  // 5b. Check ACTION_REQUEST (Permitted CRUD Create vs Unpermitted/Destructive)
  // -------------------------------------------------------------------------
  const isUnpermittedActionCommand =
    !isSystemKnowledge &&
    !crudIntent &&
    (/(?:hãy|giúp tôi|tự động|hộ tôi|làm giúp)?\s*(?:xóa|xoá|xoa|delete)\s+(?:giao dịch|khoản chi|khoản thu|ví|ngân sách|danh mục)/i.test(text) ||
     /(?:hãy|giúp tôi|tự động|hộ tôi|làm giúp)\s+(?:bớt|chuyển|sửa)\s+(?:giao dịch|khoản chi|khoản thu|tiền|ví)/i.test(text) ||
     /(?:xóa|xoá|chuyển)\s+(?:giao dịch|tiền)\s+.*(?:cho tôi|hộ tôi|giúp tôi)/i.test(text));

  const isActionCommand = Boolean(crudIntent) || isUnpermittedActionCommand;

  const isCreateGoal =
    /(?:tạo|thêm|lập|đặt)\s+(?:mới\s+)?(?:một\s+)?mục tiêu(?:\s+tiết kiệm)?/i.test(text) ||
    /muốn tạo mục tiêu tiết kiệm/i.test(text) ||
    /tao muc tieu tiet kiem/i.test(unaccented);
  if (isCreateGoal) {
    intents.add("ACTION_REQUEST");
    intents.add("SYSTEM_KNOWLEDGE");
  }

  if (crudIntent) {
    intents.add("ACTION_REQUEST");
  } else if (isUnpermittedActionCommand) {
    intents.add("ACTION_REQUEST");
    intents.add("SYSTEM_KNOWLEDGE");
  }

  // -------------------------------------------------------------------------
  // 6. Check PERSONAL_FINANCE (User's real balances, transactions, spending)
  // -------------------------------------------------------------------------
  const walletTargetQuery = detectWalletTarget(rawText);

  const isHypotheticalBalanceQuestion =
    /số dư.*(?:có bị trừ|có mất|thay đổi|ảnh hưởng|tính lại|như thế nào|ra sao)/i.test(text) ||
    /so du.*(?:co bi tru|co mat|thay doi|anh huong|tinh lai|nhu the nao|ra sao)/i.test(unaccented) ||
    /(?:nếu|khi)?\s*xóa\s+giao\s*dịch.*(?:số dư|tiền)/i.test(text) ||
    /xoa\s+giao\s*dich.*(?:so du|tien)/i.test(unaccented);

  const isBalanceQuery =
    !isHypotheticalBalanceQuestion &&
    (/tôi có (?:tổng cộng )?bao nhiêu tiền|tổng cộng bao nhiêu tiền|tôi có bao nhiêu tiền|tổng tài sản|tổng tiền|\bsố dư\b(?!.*(?:có bị trừ|có mất))|tôi còn bao nhiêu tiền|còn bao nhiêu tiền|trong ví có|tiền mặt.*còn bao nhiêu|tiền mặt.*có bao nhiêu|có bao nhiêu tiền mặt|trong ngân hàng.*bao nhiêu|tiền.*ngân hàng.*bao nhiêu|khả dụng|tiền khả dụng|đã phân bổ bao nhiêu|phân bổ bao nhiêu tiền|kiểm tra số dư|ví nào.*nhiều.*tiền|nhiều tiền nhất|ví nào.*lớn nhất|ví.*phân bổ bao nhiêu|bao nhiêu ví|mấy ví|danh sách ví|các ví của tôi/i.test(
      text,
    ) ||
    /tại sao.*còn.*khả dụng|sao.*chỉ còn|vì sao.*còn|tiền của tôi đi đâu/i.test(text) ||
    /toi co bao nhieu tien|tong tai san|tong tien|\bso du\b(?!.*(?:co bi tru|co mat))|con bao nhieu tien|trong vi|tien mat.*con bao nhieu|co bao nhieu tien mat|trong ngan hang.*bao nhieu|tien trong ngan hang.*bao nhieu|tien kha dung|phan bo bao nhieu|vi nao.*nhieu.*tien|bao nhieu vi|may vi|danh sach vi|cac vi cua toi/i.test(
      unaccented,
    ));

  const isSpendingAnalysisQuery =
    /(?:tôi\s+)?(?:đã\s+)?(?:chi|tiêu)\s+bao\s+nhiêu|tổng\s+chi\s+tiêu|chi\s+nhiều\s+(?:tiền\s+)?nhất|danh\s+mục.*nhiều\s+nhất|so\s+với\s+tháng\s+trước|tiết\s+kiệm\s+ròng/i.test(
      text,
    ) ||
    /(?:toi\s+)?(?:da\s+)?(?:chi|tieu)\s+bao\s+nhieu|tong\s+chi\s+tieu|chi\s+nhieu\s+nhat/i.test(
      unaccented,
    );

  const isRecentTransactionQuery =
    /giao dịch gần đây của tôi|lịch sử chi tiêu của tôi|khoản chi gần nhất|hôm qua tôi chi gì/i.test(
      text,
    ) ||
    /giao dich gan day|lich su chi tieu cua toi/i.test(unaccented);

  const isPersonalBudgetStatus =
    /ngân sách của tôi|vượt ngân sách|có vượt ngân sách|chi thêm.*vượt|bao nhiêu %.*ngân sách|chi.*% trên tổng.*ngân sách|ngân sách.*còn bao nhiêu|hạn mức.*còn bao nhiêu|tình hình ngân sách|mức cảnh báo|ngân sách.*(cảnh báo|vượt|hạn mức|đã chi|hết bao nhiêu|cấp vốn|phong bì|thiết lập|danh sách)|có ngân sách nào.*vượt|vượt hạn mức/i.test(
      text,
    ) ||
    /ngan sach cua toi|bao nhieu %.*ngan sach|ngan sach.*con bao nhieu|ngan sach.*canh bao|co ngan sach nao.*vuot/i.test(unaccented);

  const isPersonalSavingsGoal =
    !isSystemKnowledge &&
    (/mục tiêu tiết kiệm|tôi đã tích lũy|đã tích lũy bao nhiêu|tôi đã tiết kiệm|đã tiết kiệm được bao nhiêu|mục tiêu laptop|số tiền đã tiết kiệm|tiến độ tiết kiệm|tôi có bao nhiêu tiền tiết kiệm|cần thêm bao nhiêu.*đạt mục tiêu/i.test(
      text,
    ) ||
    /muc tieu tiet kiem|so tien da tiet kiem|tien do tiet kiem|da tiet kiem duoc bao nhieu|tich luy bao nhieu/i.test(unaccented));

  const listQuery = parseTransactionListQuery(rawText);
  const statsQuery = listQuery ? null : parseTransactionStatisticsQuery(rawText);

  if (
    isBalanceQuery ||
    isSpendingAnalysisQuery ||
    isRecentTransactionQuery ||
    isPersonalBudgetStatus ||
    isPersonalSavingsGoal ||
    listQuery !== null ||
    statsQuery !== null ||
    (Boolean(walletTargetQuery.targetWalletKeyword) && !isGeneralKnowledge) ||
    walletTargetQuery.focusType === "HIGHEST_WALLET" ||
    walletTargetQuery.focusType === "WALLET_ALLOCATED" ||
    walletTargetQuery.focusType === "WALLET_AVAILABLE"
  ) {
    intents.add("PERSONAL_FINANCE");
  }

  // -------------------------------------------------------------------------
  // 7. Check FINANCIAL_ADVICE (Affordability, multi-day spending plan, what-if)
  // -------------------------------------------------------------------------
  let affordabilityParsed = listQuery || crudIntent ? null : parsePurchaseQuery(text);
  if (!affordabilityParsed && multiTurnRef.hasReference && multiTurnRef.referencedPurchase && !listQuery && !crudIntent) {
    affordabilityParsed = {
      itemName: multiTurnRef.referencedPurchase.itemName,
      price: multiTurnRef.referencedPurchase.price,
      category: multiTurnRef.referencedPurchase.category || "Mua sắm",
      days: 1,
    };
  }

  const budgetPlanParsed = listQuery || crudIntent ? null : parseBudgetPlanQuery(text, history, multiTurnRef);

  const isAdviceQuery =
    !listQuery &&
    (affordabilityParsed !== null ||
      budgetPlanParsed !== null ||
      multiTurnRef.hasReference ||
      /tôi nên làm gì (với|cho) (tiền|số tiền)|làm gì với (tiền|số tiền)|quản lý số tiền hiện tại|tối ưu chi tiêu thế nào|kế hoạch tài chính/i.test(
        text,
      ) ||
      /có nên (mua|sắm|chi|đầu tư)|đủ tiền (mua|chi|tiêu)|nếu (mua|chi|tiêu|bỏ ra)|vượt ngân sách không|kế hoạch.*ngày.*ăn gì/i.test(
        text,
      ) ||
      /với số tiền đó.*nên tiết kiệm bao nhiêu/i.test(text) ||
      /co nen mua|du tien mua|du tien chi|ke hoach.*ngay.*an gi|nen lam gi voi tien/i.test(
        unaccented,
      ));

  if (isAdviceQuery) {
    intents.add("FINANCIAL_ADVICE");
  }

  // -------------------------------------------------------------------------
  // Fallback: If nothing matched, check if there's any financial intent
  // -------------------------------------------------------------------------
  if (intents.size === 0) {
    if (
      /\b(?:tiền|chi|tiêu|ví|ngân sách|thu nhập|tiết kiệm)\b/i.test(text) ||
      /\b(?:tien|chi|tieu|vi|ngan sach|thu nhap|tiet kiem)\b/i.test(unaccented)
    ) {
      intents.add("FINANCIAL_ADVICE");
    } else {
      intents.add("GENERAL_CHAT");
    }
  }

  // Determine Primary Intent
  const intentArray = Array.from(intents);
  let primaryIntent: UserIntent = intentArray[0];

  // Specific priority ordering for primaryIntent:
  if (isActionCommand || intents.has("ACTION_REQUEST")) {
    primaryIntent = "ACTION_REQUEST";
  } else if (intents.has("CONVERSATION_SUMMARY")) {
    primaryIntent = "CONVERSATION_SUMMARY";
  } else if (multiTurnRef.hasReference && (text.includes("mua") || text.includes("chi") || multiTurnRef.referencedPurchase)) {
    primaryIntent = "FINANCIAL_ADVICE";
  } else if (intents.has("GENERAL_KNOWLEDGE") && !intents.has("PERSONAL_FINANCE")) {
    primaryIntent = "GENERAL_KNOWLEDGE";
  } else if (intents.has("REALTIME_INFORMATION")) {
    primaryIntent = "REALTIME_INFORMATION";
  } else if (intents.has("SYSTEM_KNOWLEDGE") && !intents.has("PERSONAL_FINANCE")) {
    primaryIntent = "SYSTEM_KNOWLEDGE";
  } else if (listQuery !== null) {
    primaryIntent = "PERSONAL_FINANCE";
  } else if (intents.has("PERSONAL_FINANCE") && (isPersonalSavingsGoal || isPersonalBudgetStatus || isBalanceQuery || listQuery !== null || statsQuery !== null || isSpendingAnalysisQuery)) {
    primaryIntent = "PERSONAL_FINANCE";
  } else if (intents.has("FINANCIAL_ADVICE")) {
    primaryIntent = "FINANCIAL_ADVICE";
  } else if (intents.has("PERSONAL_FINANCE")) {
    primaryIntent = "PERSONAL_FINANCE";
  } else if (intents.has("GENERAL_CHAT")) {
    primaryIntent = "GENERAL_CHAT";
  }

  // Backward compatible QueryCategory mapping
  let category: QueryCategory = "GENERAL_CHAT";
  if (primaryIntent === "ACTION_REQUEST") {
    category = "SYSTEM_KNOWLEDGE";
  } else if (primaryIntent === "CONVERSATION_SUMMARY") {
    category = "GENERAL_CHAT";
  } else if (budgetPlanParsed !== null) {
    category = "BUDGET_PLANNING";
  } else if (primaryIntent === "PERSONAL_FINANCE") {
    if (listQuery !== null) category = "LIST_TRANSACTIONS";
    else if (isPersonalBudgetStatus) category = "BUDGET_ADVICE";
    else if (isPersonalSavingsGoal) category = "SAVINGS_PLANNING";
    else if (statsQuery !== null) category = "TRANSACTION_STATISTICS";
    else if (isSpendingAnalysisQuery) category = "SPENDING_ANALYSIS";
    else category = "USER_FINANCIAL_DATA";
  } else if (primaryIntent === "FINANCIAL_ADVICE") {
    if (affordabilityParsed || text.includes("mua") || text.includes("chi") || multiTurnRef.hasReference) {
      category = "AFFORDABILITY_WHATIF";
    } else {
      category = "GENERAL_FINANCIAL_ADVICE";
    }
  } else if (primaryIntent === "SYSTEM_KNOWLEDGE") {
    category = "SYSTEM_KNOWLEDGE";
  } else if (primaryIntent === "GENERAL_KNOWLEDGE") {
    category = "GENERAL_CHAT";
  } else if (primaryIntent === "REALTIME_INFORMATION") {
    category = "GENERAL_CHAT";
  }

  // Canonical Intent mapping (6 core categories)
  let canonicalIntent: CanonicalIntent = "GENERAL_CHAT";
  if (isActionCommand || intents.has("ACTION_REQUEST")) {
    canonicalIntent = "ACTION_REQUEST";
  } else if (primaryIntent === "SYSTEM_KNOWLEDGE" || intents.has("SYSTEM_KNOWLEDGE") || isSystemKnowledge) {
    canonicalIntent = "SYSTEM_HELP";
  } else if (primaryIntent === "FINANCIAL_ADVICE") {
    canonicalIntent = "FINANCIAL_ADVICE";
  } else if (primaryIntent === "PERSONAL_FINANCE") {
    if (category === "SPENDING_ANALYSIS" || category === "TRANSACTION_STATISTICS") {
      canonicalIntent = "FINANCIAL_ANALYSIS";
    } else {
      canonicalIntent = "FINANCIAL_QUERY";
    }
  } else {
    canonicalIntent = "GENERAL_CHAT";
  }

  const requiresPersonalData =
    Boolean(crudIntent) ||
    (primaryIntent !== "CONVERSATION_SUMMARY" &&
      canonicalIntent !== "ACTION_REQUEST" &&
      (intents.has("PERSONAL_FINANCE") ||
        (intents.has("FINANCIAL_ADVICE") && !isGeneralKnowledge && !isBillionaireQuery)));

  const requiresFinancialAnalysis =
    !crudIntent && primaryIntent !== "CONVERSATION_SUMMARY" && intents.has("FINANCIAL_ADVICE");
  const requiresSystemRag =
    !crudIntent &&
    (intents.has("SYSTEM_KNOWLEDGE") || canonicalIntent === "SYSTEM_HELP" || canonicalIntent === "ACTION_REQUEST");
  const requiresRealtimeSearch = !crudIntent && intents.has("REALTIME_INFORMATION");

  return {
    primaryIntent,
    canonicalIntent,
    intents: intentArray,
    category,
    requiresPersonalData,
    requiresFinancialAnalysis,
    requiresSystemRag,
    requiresRealtimeSearch,
    extractedAffordability: affordabilityParsed,
    extractedBudgetPlan: budgetPlanParsed,
    transactionStatisticsQuery: statsQuery,
    transactionListQuery: listQuery,
    walletTargetQuery,
    crudIntent,
    multiTurnRef,
    multiTurnContext,
  };
}
