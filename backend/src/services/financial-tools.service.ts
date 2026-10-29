/**
 * backend/src/services/financial-tools.service.ts
 * ===============================================
 * Deterministic Financial Tool Calling & Analysis Engine for Financial Copilot.
 *
 * Security & Reliability Principles:
 * - Deterministic Computation: All balances, aggregations, percentages and comparisons
 *   are computed deterministically in TypeScript code, NEVER left to LLM guesswork.
 * - Strict User Isolation: All queries pass the user's verified Bearer token with RLS
 *   and explicitly filter by authenticated user_id.
 * - Multi-Currency Segregated: VND, USD, and other currencies are never naively added.
 * - Envelope vs Wallet Separation: Physical balances vs reserved funds vs spending limits
 *   are clearly delineated.
 */

import { createClient } from "@supabase/supabase-js";
import type { Wallet, Transaction, Budget, SavingsGoal, Transfer } from "../../../frontend/types/finance.types.ts";
import type { OllamaToolDefinition } from "./ollama-client.ts";
import {
  searchSystemKnowledge,
  formatRagContextForPrompt,
  getFeatureWorkflow,
  getBusinessRules,
  getFeatureInformation,
  normalizeVietnamese,
} from "./system-rag.service.ts";
import {
  buildAuthoritativeFinancialSnapshot,
  type AuthoritativeFinancialSnapshot,
  type ComputedWalletSummary,
} from "./financial-snapshot.service.ts";
import { getCachedUserFinancialContext } from "./financial-cache.service.ts";
import type { ServerFinancialContext } from "./financial-context.service.ts";
import {
  CRUD_ACTION_TOOLS,
  executeConfirmedCrudAction,
  handleChatCrudIntent,
} from "./ai-crud-tools.service.ts";
import type { CrudActionType } from "../types/ai.types.ts";

export interface ToolExecutionContext {
  supabaseUrl: string;
  supabaseKey: string;
  token: string;
  userId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase?: any;
  snapshot?: AuthoritativeFinancialSnapshot;
  serverContext?: ServerFinancialContext | null;
}

// ---------------------------------------------------------------------------
// Standardized Asia/Ho_Chi_Minh (UTC+7) Date Utilities
// ---------------------------------------------------------------------------

export const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

export interface VietnamTimeBounds {
  nowIso: string;
  year: number;
  month: number;
  currentMonthLabel: string;
  previousMonthLabel: string;
  currentStartIso: string;
  currentEndIso: string;
  previousStartIso: string;
  previousEndIso: string;
}

export function getVietnamTimeBounds(referenceDate: Date = new Date()): VietnamTimeBounds {
  const vnNow = new Date(referenceDate.getTime() + VN_OFFSET_MS);
  const year = vnNow.getUTCFullYear();
  const month = vnNow.getUTCMonth(); // 0-indexed (0 = Jan, 9 = Oct)

  // Current month bounds in UTC
  const currentStartUtc = new Date(Date.UTC(year, month, 1) - VN_OFFSET_MS);
  const currentEndUtc = new Date(Date.UTC(year, month + 1, 1) - VN_OFFSET_MS);

  // Previous month bounds in UTC
  const prevYear = month === 0 ? year - 1 : year;
  const prevMonth = month === 0 ? 11 : month - 1;
  const previousStartUtc = new Date(Date.UTC(prevYear, prevMonth, 1) - VN_OFFSET_MS);
  const previousEndUtc = currentStartUtc;

  const pad = (n: number) => String(n).padStart(2, "0");
  const currentMonthLabel = `Tháng ${pad(month + 1)}/${year}`;
  const previousMonthLabel = `Tháng ${pad(prevMonth + 1)}/${prevYear}`;

  const nowFormatted = `${year}-${pad(month + 1)}-${pad(vnNow.getUTCDate())} ${pad(vnNow.getUTCHours())}:${pad(vnNow.getUTCMinutes())}:${pad(vnNow.getUTCSeconds())} (UTC+7)`;

  return {
    nowIso: nowFormatted,
    year,
    month: month + 1,
    currentMonthLabel,
    previousMonthLabel,
    currentStartIso: currentStartUtc.toISOString(),
    currentEndIso: currentEndUtc.toISOString(),
    previousStartIso: previousStartUtc.toISOString(),
    previousEndIso: previousEndUtc.toISOString(),
  };
}

export function normalizeDateInput(d: string): { year: number; month: number; day: number } | null {
  if (!d) return null;
  const trimmed = d.trim();
  // YYYY-MM-DD
  const isoMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    return {
      year: parseInt(isoMatch[1], 10),
      month: parseInt(isoMatch[2], 10),
      day: parseInt(isoMatch[3], 10),
    };
  }
  // DD/MM/YYYY
  const vnMatch = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (vnMatch) {
    return {
      year: parseInt(vnMatch[3], 10),
      month: parseInt(vnMatch[2], 10),
      day: parseInt(vnMatch[1], 10),
    };
  }
  return null;
}

export function parseCustomDateRangeVn(
  startDateStr: string,
  endDateStr?: string,
): { startIso: string; endIso: string; label: string } {
  const s = normalizeDateInput(startDateStr);
  const e = endDateStr ? normalizeDateInput(endDateStr) : s;

  if (!s) {
    const fallback = getVietnamTimeBounds();
    return {
      startIso: fallback.currentStartIso,
      endIso: fallback.currentEndIso,
      label: fallback.currentMonthLabel,
    };
  }

  const startUtc = new Date(Date.UTC(s.year, s.month - 1, s.day, 0, 0, 0) - VN_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  const sFormatted = `${pad(s.day)}/${pad(s.month)}/${s.year}`;

  let endUtc: Date;
  let label: string;

  if (e) {
    endUtc = new Date(Date.UTC(e.year, e.month - 1, e.day + 1, 0, 0, 0) - VN_OFFSET_MS);
    const eFormatted = `${pad(e.day)}/${pad(e.month)}/${e.year}`;
    label = sFormatted === eFormatted ? `ngày ${sFormatted}` : `từ ${sFormatted} đến ${eFormatted}`;
  } else {
    endUtc = new Date(Date.UTC(s.year, s.month - 1, s.day + 1, 0, 0, 0) - VN_OFFSET_MS);
    label = `ngày ${sFormatted}`;
  }

  return {
    startIso: startUtc.toISOString(),
    endIso: endUtc.toISOString(),
    label,
  };
}

export function parseMonthRangeVn(year: number, month: number): { startIso: string; endIso: string; label: string } {
  const startUtc = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0) - VN_OFFSET_MS);
  const endUtc = new Date(Date.UTC(year, month, 1, 0, 0, 0) - VN_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    startIso: startUtc.toISOString(),
    endIso: endUtc.toISOString(),
    label: `Tháng ${pad(month)}/${year}`,
  };
}

// ---------------------------------------------------------------------------
// 1. Tool Definitions for Ollama / LLM Tool Calling
// ---------------------------------------------------------------------------

export const FINANCIAL_TOOLS: OllamaToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_wallet_balances",
      description:
        "Truy xuất số dư thực tế, tiền phân bổ (giữ chỗ ngân sách/tiết kiệm) và số dư khả dụng thực tế của tất cả ví, hoặc của một ví cụ thể (ví tiền mặt, ví ngân hàng), hoặc tìm ví nhiều tiền nhất.",
      parameters: {
        type: "object",
        properties: {
          wallet_query: {
            type: "string",
            description: "Từ khóa hoặc tên ví cụ thể cần truy vấn (ví dụ: 'tiền mặt', 'ngân hàng', 'vcb')",
          },
          wallet_id: {
            type: "string",
            description: "ID của ví cụ thể nếu đã xác định",
          },
          wallet_type: {
            type: "string",
            description: "Loại ví: 'cash' (tiền mặt), 'bank' (ngân hàng), 'ewallet' (ví điện tử)",
          },
          focus: {
            type: "string",
            enum: [
              "TOTAL_ASSETS",
              "TOTAL_AVAILABLE",
              "TOTAL_ALLOCATED",
              "WALLET_BALANCE",
              "WALLET_AVAILABLE",
              "WALLET_ALLOCATED",
              "HIGHEST_WALLET",
            ],
            description: "Mục tiêu trọng tâm: TOTAL_ASSETS, TOTAL_AVAILABLE, TOTAL_ALLOCATED, WALLET_BALANCE, WALLET_AVAILABLE, WALLET_ALLOCATED, hoặc HIGHEST_WALLET",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_spending_analysis",
      description:
        "Phân tích thu nhập, chi tiêu, tiết kiệm ròng, tỷ lệ tiết kiệm kỳ này, so sánh với tháng trước và danh mục chi tiêu lớn nhất.",
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "string",
            description: "Kỳ phân tích, ví dụ 'current' (mặc định) hoặc 'previous'.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_budget_status",
      description:
        "Lấy thông tin hạn mức ngân sách, chi tiêu thực tế, hạn mức còn lại có thể chi, tỷ lệ sử dụng %, trạng thái cảnh báo và quỹ phong bì cấp vốn.",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            description: "Tên danh mục ngân sách cần xem cụ thể (ví dụ: 'Ăn uống'). Bỏ trống để lấy tất cả.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_savings_goals",
      description:
        "Lấy danh sách các mục tiêu tiết kiệm, số tiền đã tích lũy, số tiền mục tiêu còn thiếu, hạn chót và tiến độ %.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recent_transactions",
      description:
        "Lấy danh sách các giao dịch gần đây của người dùng để tham khảo chi tiết (tối đa 30 giao dịch). LƯU Ý: Đây chỉ là danh sách mẫu trích xuất, KHÔNG dùng để đếm tổng số giao dịch của tháng hay của tài khoản.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Số lượng giao dịch tối đa hiển thị (mặc định: 10, tối đa 30).",
          },
          category: {
            type: "string",
            description: "Lọc theo danh mục cụ thể (ví dụ 'Ăn uống', 'Nhà ở').",
          },
          type: {
            type: "string",
            description: "Loại giao dịch: 'income', 'expense' hoặc 'transfer'.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_transaction_statistics",
      description:
        "Thống kê số lượng giao dịch và số tiền thu/chi của người dùng theo khoảng thời gian (tháng này, tháng trước, hoặc khoảng ngày tùy chọn). Phân biệt rõ: số giao dịch trong kỳ, tổng số giao dịch toàn tài khoản, số giao dịch sau lọc, và số bản ghi hiển thị trên một trang.",
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "string",
            description: "Kỳ thống kê: 'current_month' (tháng này - mặc định), 'previous_month' (tháng trước), 'custom' (tùy chọn theo ngày), hoặc 'all' (toàn bộ lịch sử).",
          },
          start_date: {
            type: "string",
            description: "Ngày bắt đầu (định dạng YYYY-MM-DD hoặc DD/MM/YYYY), dùng khi period là 'custom'.",
          },
          end_date: {
            type: "string",
            description: "Ngày kết thúc (định dạng YYYY-MM-DD hoặc DD/MM/YYYY), dùng khi period là 'custom'.",
          },
          month: {
            type: "number",
            description: "Số tháng cụ thể (1-12) nếu người dùng hỏi về một tháng cụ thể.",
          },
          year: {
            type: "number",
            description: "Năm (ví dụ 2026), mặc định theo năm hiện tại.",
          },
          category: {
            type: "string",
            description: "Lọc theo danh mục cụ thể (tùy chọn).",
          },
          type: {
            type: "string",
            description: "Lọc theo loại giao dịch: 'income' hoặc 'expense' (tùy chọn).",
          },
          wallet_id: {
            type: "string",
            description: "Lọc theo ID ví (tùy chọn).",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "evaluate_purchase_affordability",
      description:
        "Đánh giá khả năng chi trả (What-If): Kiểm tra xem người dùng có đủ số dư khả dụng và hạn mức ngân sách để mua món đồ giá X không, và tác động đến tài chính.",
      parameters: {
        type: "object",
        properties: {
          item_name: {
            type: "string",
            description: "Tên món đồ hoặc dịch vụ dự định mua (ví dụ: 'Điện thoại iPhone', 'Bữa tiệc').",
          },
          price: {
            type: "number",
            description: "Số tiền cần chi trả (ví dụ: 15000000 hoặc 500000).",
          },
          category: {
            type: "string",
            description: "Danh mục dự kiến của món đồ (ví dụ 'Mua sắm', 'Ăn uống', 'Công nghệ').",
          },
          days: {
            type: "number",
            description: "Số ngày phân bổ chi tiêu nếu là kế hoạch nhiều ngày (ví dụ: 7 ngày).",
          },
        },
        required: ["item_name", "price"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_financial_advice",
      description:
        "Tư vấn tài chính tổng hợp: Phân tích số dư hiện có, các khoản chi thiết yếu sắp tới, ngân sách còn lại và đưa ra lời khuyên người dùng nên làm gì với số tiền hiện tại.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_system_knowledge",
      description:
        "Tra cứu tài liệu hướng dẫn và kiến thức tính năng của ứng dụng Sổ Chi Tiêu qua cơ sở tri thức RAG.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Câu hỏi hoặc từ khóa tính năng cần tra cứu.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_system_knowledge",
      description:
        "Tìm kiếm thông tin chính thức về các tính năng, kiến trúc, quy tắc và hướng dẫn sử dụng của ứng dụng Sổ Chi Tiêu qua cơ sở tri thức RAG.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Câu hỏi hoặc từ khóa tính năng cần tra cứu.",
          },
          user_role: {
            type: "string",
            enum: ["user", "admin"],
            description: "Vai trò người dùng: 'user' hoặc 'admin'.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_feature_workflow",
      description:
        "Lấy hướng dẫn thao tác từng bước chi tiết (vị trí trên giao diện, các bước bấm, nhập liệu) cho một tính năng cụ thể trong Sổ Chi Tiêu.",
      parameters: {
        type: "object",
        properties: {
          feature_id: {
            type: "string",
            description: "ID tính năng: 'wallets', 'transactions', 'transfers', 'budgets_tracking', 'budgets_envelope', 'savings_goals', 'recurring_transactions', 'smart_input', 'receipt_ocr', 'excel_csv_import', 'excel_export', 'monthly_review', 'reports_charts', 'admin_rbac', 'admin_monitoring'.",
          },
        },
        required: ["feature_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_business_rules",
      description:
        "Lấy các quy tắc nghiệp vụ, logic kế toán, công thức tính toán và ràng buộc hệ thống của một tính năng cụ thể trong Sổ Chi Tiêu.",
      parameters: {
        type: "object",
        properties: {
          feature_id: {
            type: "string",
            description: "ID tính năng: 'wallets', 'transactions', 'transfers', 'budgets_tracking', 'budgets_envelope', 'savings_goals', 'recurring_transactions', 'smart_input', 'receipt_ocr', 'excel_csv_import', 'excel_export', 'monthly_review', 'reports_charts', 'admin_rbac', 'admin_monitoring'.",
          },
        },
        required: ["feature_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_feature_information",
      description:
        "Lấy thông tin tổng hợp toàn diện (mục đích, vị trí UI, trạng thái triển khai, quy tắc nghiệp vụ, bảng DB, bảo mật) của một tính năng trong Sổ Chi Tiêu.",
      parameters: {
        type: "object",
        properties: {
          feature_id: {
            type: "string",
            description: "ID tính năng cần tra cứu thông tin toàn diện.",
          },
        },
        required: ["feature_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_realtime_information",
      description:
        "Tra cứu thông tin thị trường cập nhật thời gian thực (tỷ giá ngoại tệ trực tiếp, tình trạng tin tức kinh tế).",
      parameters: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description: "Chủ đề thời gian thực cần tra cứu (ví dụ: 'exchange_rates', 'economic_news', 'gold_price').",
          },
        },
        required: ["topic"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_budget_constrained_plan",
      description:
        "Lập kế hoạch chi tiêu có ràng buộc ngân sách toán học: ăn sáng 7 ngày / 1 tuần, kế hoạch ăn uống cả tháng, mua sắm trong ngân sách, lập kế hoạch tiết kiệm mục tiêu, phân bổ thu nhập 50/30/20, hoặc điều chỉnh chi tiêu khi thu nhập giảm. Tự động kiểm tra ngân sách danh mục Supabase, tiền khả dụng và xác thực toán học 100%.",
      parameters: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            enum: [
              "BREAKFAST_PLAN",
              "MEALS_MONTHLY_PLAN",
              "SHOPPING_BUDGET_PLAN",
              "SAVINGS_GOAL_PLAN",
              "INCOME_ALLOCATION",
              "SPENDING_REDUCTION",
            ],
            description:
              "Phạm vi lập kế hoạch: BREAKFAST_PLAN (ăn sáng theo tuần/ngày), MEALS_MONTHLY_PLAN (ăn uống cả tháng), SHOPPING_BUDGET_PLAN (mua sắm trong ngân sách), SAVINGS_GOAL_PLAN (kế hoạch tiết kiệm), INCOME_ALLOCATION (phân bổ thu nhập 50/30/20), SPENDING_REDUCTION (cắt giảm chi tiêu khi thu nhập giảm).",
          },
          budget: {
            type: "number",
            description: "Số tiền ngân sách cho kế hoạch (nếu người dùng nêu rõ hoặc lấy từ tiền khả dụng / số tiền còn lại).",
          },
          days: {
            type: "number",
            description: "Số ngày áp dụng (ví dụ: 7 cho 1 tuần, 30 cho 1 tháng). Mặc định là 7 cho kế hoạch tuần.",
          },
          meal_type: {
            type: "string",
            enum: ["breakfast", "all_meals", "lunch", "dinner"],
            description: "Loại bữa ăn cần lập kế hoạch (mặc định 'breakfast' nếu người dùng chỉ hỏi ăn sáng).",
          },
          target_category: {
            type: "string",
            description: "Danh mục liên quan, ví dụ 'Ăn uống', 'Mua sắm'.",
          },
          use_remaining_funds: {
            type: "boolean",
            description: "Có sử dụng số tiền khả dụng còn lại từ ví hoặc lượt mua trước đó không.",
          },
          savings_mode: {
            type: "string",
            enum: [
              "TARGET_GOAL",
              "ADDITIONAL_SAVINGS",
              "SAVINGS_STATUS",
              "MAX_SAVINGS_CAPACITY",
              "GENERAL_PLAN",
            ],
            description:
              "Chế độ câu hỏi tiết kiệm: TARGET_GOAL (mục tiêu X), ADDITIONAL_SAVINGS (tiết kiệm thêm X), SAVINGS_STATUS (đã tiết kiệm được bao nhiêu), MAX_SAVINGS_CAPACITY (tối đa có thể tiết kiệm), GENERAL_PLAN (kế hoạch chung).",
          },
        },
        required: ["scope"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_wallets",
      description:
        "Lấy danh sách tất cả các ví của người dùng kèm thông tin chi tiết: tên ví, loại ví (tiền mặt, ngân hàng, ví điện tử), tiền tệ, số dư thực tế, số tiền đã phân bổ (giữ chỗ) và số dư khả dụng thực tế.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_wallet_balance",
      description:
        "Truy xuất số dư thực tế và số dư khả dụng của một ví cụ thể hoặc tổng số dư tài sản của người dùng.",
      parameters: {
        type: "object",
        properties: {
          wallet_name: {
            type: "string",
            description: "Tên hoặc từ khóa của ví cần tra cứu (ví dụ: 'tiền mặt', 'ngân hàng', 'vcb').",
          },
          wallet_id: {
            type: "string",
            description: "ID của ví nếu đã xác định.",
          },
          wallet_type: {
            type: "string",
            description: "Loại ví: 'cash' (tiền mặt), 'bank' (ngân hàng), 'ewallet' (ví điện tử).",
          },
          focus: {
            type: "string",
            enum: [
              "TOTAL_ASSETS",
              "TOTAL_AVAILABLE",
              "TOTAL_ALLOCATED",
              "WALLET_BALANCE",
              "WALLET_AVAILABLE",
              "WALLET_ALLOCATED",
              "HIGHEST_WALLET",
            ],
            description: "Trọng tâm cần lấy số liệu.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_transactions",
      description:
        "Truy xuất và hiển thị danh sách các giao dịch cụ thể của người dùng, hỗ trợ lọc theo thời gian (tháng này, tháng trước, khoảng ngày), loại giao dịch (chi tiêu/thu nhập/chuyển tiền), danh mục và khoảng số tiền (min_amount, max_amount). Tuyệt đối không thay thế danh sách bằng báo cáo tổng quan nếu người dùng yêu cầu xem/tìm giao dịch.",
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "string",
            description: "Kỳ thời gian: 'current_month' (mặc định), 'previous_month', 'custom', hoặc 'all'.",
          },
          start_date: {
            type: "string",
            description: "Ngày bắt đầu (định dạng YYYY-MM-DD hoặc DD/MM/YYYY).",
          },
          end_date: {
            type: "string",
            description: "Ngày kết thúc (định dạng YYYY-MM-DD hoặc DD/MM/YYYY).",
          },
          month: {
            type: "number",
            description: "Số tháng cụ thể (1-12).",
          },
          year: {
            type: "number",
            description: "Năm cụ thể (ví dụ: 2026).",
          },
          type: {
            type: "string",
            enum: ["income", "expense", "transfer"],
            description: "Loại giao dịch: 'income' (khoản thu), 'expense' (khoản chi), 'transfer' (chuyển tiền).",
          },
          category: {
            type: "string",
            description: "Tên danh mục cần lọc (ví dụ: 'Ăn uống', 'Mua sắm', 'Nhà ở').",
          },
          min_amount: {
            type: "number",
            description: "Số tiền tối thiểu.",
          },
          max_amount: {
            type: "number",
            description: "Số tiền tối đa.",
          },
          limit: {
            type: "number",
            description: "Số lượng giao dịch tối đa hiển thị (mặc định: 15, tối đa 50).",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_financial_summary",
      description:
        "Lấy báo cáo tổng quan tài chính cá nhân toàn diện: Tổng tài sản, tổng tiền khả dụng, tổng tiền đã phân bổ, thu nhập tháng, chi tiêu tháng, và khoản chi lớn nhất.",
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "string",
            description: "Kỳ báo cáo: 'current' (tháng hiện tại) hoặc 'previous' (tháng trước).",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_budgets",
      description:
        "Lấy danh sách các ngân sách chi tiêu của người dùng: tên danh mục, hạn mức ngân sách, số tiền đã chi thực tế, số tiền còn lại có thể chi, tỷ lệ đã sử dụng (%) và trạng thái cảnh báo.",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            description: "Lọc theo danh mục cụ thể nếu có.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_categories",
      description:
        "Lấy danh sách tất cả các danh mục thu và chi có sẵn trong hệ thống (gồm danh mục mặc định và danh mục tùy chỉnh của người dùng).",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["income", "expense"],
            description: "Loại danh mục: 'income' (thu nhập) hoặc 'expense' (chi tiêu). Bỏ trống để lấy cả hai.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_system_capabilities",
      description:
        "Tra cứu toàn bộ danh mục các chức năng của hệ thống Sổ Chi Tiêu và trạng thái triển khai thực tế (Quản lý ví, Giao dịch, Ngân sách, Mục tiêu, Báo cáo, Nhập/Xuất Excel, Quét hóa đơn AI, Phân quyền Admin).",
      parameters: {
        type: "object",
        properties: {
          feature_id: {
            type: "string",
            description: "ID chức năng cụ thể nếu muốn tra cứu chi tiết (tùy chọn).",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_feature_instructions",
      description:
        "Lấy hướng dẫn thao tác chi tiết từng bước trên giao diện thực tế (vị trí nút bấm, quy trình thực hiện, điều kiện hợp lệ) cho một chức năng bất kỳ trong Sổ Chi Tiêu.",
      parameters: {
        type: "object",
        properties: {
          feature_query: {
            type: "string",
            description: "Tên hoặc từ khóa của chức năng cần hướng dẫn (ví dụ: 'nhập excel', 'sửa giao dịch', 'tạo ngân sách', 'quét hóa đơn').",
          },
        },
        required: ["feature_query"],
      },
    },
  },
  ...CRUD_ACTION_TOOLS,
];

// ---------------------------------------------------------------------------
// 2. Query Classification
// ---------------------------------------------------------------------------

export type QueryCategory =
  | "USER_FINANCIAL_DATA"
  | "SPENDING_ANALYSIS"
  | "BUDGET_ADVICE"
  | "SAVINGS_PLANNING"
  | "AFFORDABILITY_WHATIF"
  | "BUDGET_PLANNING"
  | "GENERAL_FINANCIAL_ADVICE"
  | "SYSTEM_KNOWLEDGE"
  | "GENERAL_CHAT"
  | "TRANSACTION_STATISTICS"
  | "LIST_TRANSACTIONS";

export interface ParsedAffordabilityQuery {
  itemName: string;
  price: number;
  category?: string;
  days?: number;
  targetWalletKeyword?: string;
  targetWalletType?: "cash" | "bank" | "ewallet" | "other";
}

export function parsePurchaseQuery(text: string): ParsedAffordabilityQuery | null {
  const normalized = text.toLowerCase().trim();

  // If this is an explanatory or inquiry question about existing balance, NOT a purchase query
  if (/^(?:tại sao|sao|vì sao)\b.*(?:còn|khả dụng|số dư)/i.test(normalized)) {
    return null;
  }
  if (/^(?:tôi có bao nhiêu tiền|tổng tài sản|số dư|trong ví còn|có bao nhiêu)\b/i.test(normalized)) {
    return null;
  }

  // Extract days if asking for multi-day plan (e.g. "trong 7 ngày", "cho 7 ngày", "7 ngày")
  let days: number | undefined;
  const daysMatch = normalized.match(/(\d+)\s*(?:ngày|hôm)\b/i);
  if (daysMatch) {
    days = parseInt(daysMatch[1], 10);
  }

  // Check patterns like: "200k", "200.000", "15 triệu", "15tr"
  const pricePatterns = [
    /(\d+(?:[.,]\d+)?)\s*(triệu|tr|m)\b/i,
    /(\d+(?:[.,]\d+)?)\s*(nghìn|ngàn|k)\b/i,
    /(\d{1,3}(?:\.\d{3})+|\d{4,9})\s*(?:đ|vnd|đồng)?\b/i,
    /\$?\s*(\d+(?:[.,]\d+)?)\s*(usd|đô|dollar)\b/i,
  ];

  let price: number | null = null;
  for (const pat of pricePatterns) {
    const match = normalized.match(pat);
    if (match) {
      const numStr = match[1].replace(",", ".");
      const unit = match[2]?.toLowerCase();
      if (unit === "triệu" || unit === "tr" || unit === "m") {
        price = parseFloat(numStr) * 1_000_000;
      } else if (unit === "nghìn" || unit === "ngàn" || unit === "k") {
        price = parseFloat(numStr) * 1_000;
      } else if (unit === "usd" || unit === "đô" || unit === "dollar") {
        price = parseFloat(numStr);
      } else {
        const cleanDigits = match[1].replace(/\./g, "");
        price = parseFloat(cleanDigits);
      }
      break;
    }
  }

  if (!price || isNaN(price) || price <= 0) {
    return null;
  }

  // Determine category & item name intelligently
  let category: string | undefined;
  let itemName = "khoản chi này";

  if (/ăn sáng|bữa sáng/i.test(normalized)) {
    category = "ăn uống";
    itemName = days ? `ăn sáng trong ${days} ngày` : "bữa ăn sáng";
  } else if (/ăn|uống|cơm|phở|tiệc|nhà hàng|thực phẩm/i.test(normalized)) {
    category = "ăn uống";
    itemName = days ? `chi tiêu ăn uống trong ${days} ngày` : "ăn uống";
  } else if (/xăng|xe|đi lại|grab|be|vé/i.test(normalized)) {
    category = "di chuyển";
    itemName = "chi phí đi lại";
  } else {
    // Extract candidate item name from "mua [item]" or "chi cho [item]"
    const itemMatch = text.match(/(?:mua|sắm|chi cho|đầu tư vào)\s+([^?.,!]+?)(?:\s+(?:giá|hết|mất|\d)|$|[?.,!])/i);
    if (itemMatch && itemMatch[1]) {
      const candidate = itemMatch[1].trim();
      if (candidate.length > 1 && !/^\d+/.test(candidate)) {
        itemName = candidate;
      }
    } else if (normalized.includes("chi")) {
      itemName = `khoản chi ${price.toLocaleString("vi-VN")} VND`;
    }
  }

  // Detect if specific wallet is mentioned in the purchase query
  let targetWalletKeyword: string | undefined;
  let targetWalletType: "cash" | "bank" | "ewallet" | "other" | undefined;
  if (/tiền mặt|ví tiền mặt|bằng tiền mặt/i.test(normalized)) {
    targetWalletKeyword = "tiền mặt";
    targetWalletType = "cash";
  } else if (/ngân hàng|trong ngân hàng|chuyển khoản|vcb|vietcombank|techcombank/i.test(normalized)) {
    targetWalletKeyword = "ngân hàng";
    targetWalletType = "bank";
  } else if (/momo|zalopay|ví điện tử/i.test(normalized)) {
    targetWalletKeyword = "ví điện tử";
    targetWalletType = "ewallet";
  }

  return { itemName, price, category, days, targetWalletKeyword, targetWalletType };
}

export function classifyFinancialQuery(
  message: string,
  history: Array<{ role: string; parts?: Array<{ text: string }> }> = [],
): { category: QueryCategory; extractedAffordability?: ParsedAffordabilityQuery | null } {
  const text = message.toLowerCase().trim();

  // 0. Transaction statistics and count inquiries ("Tháng này tôi có bao nhiêu giao dịch?", "Có mấy giao dịch?")
  if (
    /(?:bao nhiêu|mấy|đếm|tổng số|số lượng)\s+(?:giao dịch|khoản chi|khoản thu|giao dịch chi|giao dịch thu)/i.test(text) ||
    /(?:giao dịch|khoản chi|khoản thu)\s+(?:trong|của)?\s*(?:tháng|tuần|hôm|kỳ|toàn bộ|tất cả)/i.test(text) ||
    /thống kê (?:giao dịch|chi tiêu)/i.test(text) ||
    /có bao nhiêu giao dịch/i.test(text)
  ) {
    return { category: "TRANSACTION_STATISTICS" };
  }

  // 1. Balance explanation and wallet inquiries ("Tại sao tôi chỉ còn 335k khả dụng?", "Tôi có bao nhiêu tiền?", "Số dư các ví")
  if (
    /tại sao.*còn|vì sao.*còn|sao lại.*còn|sao.*chỉ còn/i.test(text) ||
    /tôi có bao nhiêu tiền|tổng tiền của tôi|tổng tài sản|số dư (ví|tài khoản|hiện tại)|còn bao nhiêu tiền|trong ví có|tiền mặt còn|khả dụng là bao nhiêu|kiểm tra số dư/i.test(text)
  ) {
    return { category: "USER_FINANCIAL_DATA" };
  }

  // 2. Affordability / What-If / Multi-day plan ("Tôi có đủ tiền chi 200k không?", "Tôi có 200k ăn sáng trong 7 ngày, nên ăn gì?", "Có nên mua X...")
  const affordabilityParsed = parsePurchaseQuery(text);
  if (
    affordabilityParsed ||
    /có nên (mua|sắm|chi|đầu tư)|đủ tiền (mua|chi|tiêu)|nếu (mua|chi|tiêu|bỏ ra)|vượt ngân sách không|kế hoạch.*ngày.*ăn gì/i.test(text)
  ) {
    return { category: "AFFORDABILITY_WHATIF", extractedAffordability: affordabilityParsed };
  }

  // 3. General Financial Advice ("Tôi nên làm gì với số tiền hiện tại?", "Tư vấn tài chính")
  if (
    /tôi nên làm gì (với|cho) (tiền|số tiền)|làm gì với (tiền|số tiền)|quản lý số tiền hiện tại|tối ưu chi tiêu thế nào|kế hoạch tài chính/i.test(text)
  ) {
    return { category: "GENERAL_FINANCIAL_ADVICE" };
  }

  // 4. Budget ("Ngân sách của tôi", "Tôi đã dùng bao nhiêu % ngân sách", "Hạn mức còn lại")
  if (
    /ngân sách|hạn mức|cảnh báo ngân sách|vượt hạn mức|tiền phân bổ|quỹ phong bì|hạn mức còn/i.test(text)
  ) {
    return { category: "BUDGET_ADVICE" };
  }

  // 5. Savings Goals ("Mục tiêu tiết kiệm", "Tiến độ mua laptop", "Còn thiếu bao nhiêu để đạt mục tiêu")
  if (
    /mục tiêu tiết kiệm|tích lũy|tiết kiệm cho|kế hoạch tiết kiệm|bao giờ đạt được mục tiêu/i.test(text)
  ) {
    return { category: "SAVINGS_PLANNING" };
  }

  // 6. Spending Analysis ("Tháng này tôi đã chi bao nhiêu?", "Tôi chi nhiều nhất cho cái gì?", "So với tháng trước")
  if (
    /chi bao nhiêu|đã tiêu bao nhiêu|tổng chi tiêu|khoản chi lớn nhất|chi nhiều nhất|so với tháng trước|tăng hay giảm|tiết kiệm ròng/i.test(text)
  ) {
    return { category: "SPENDING_ANALYSIS" };
  }

  // 7. System Knowledge / How-to ("Làm thế nào", "Cách tạo", "Tính năng gì", "Xuất Excel ở đâu")
  if (
    /làm sao để|làm thế nào|cách (tạo|xóa|sửa|xuất|nhập)|tính năng|hướng dẫn|sổ chi tiêu là gì|chức năng/i.test(text)
  ) {
    return { category: "SYSTEM_KNOWLEDGE" };
  }

  // Multi-turn context resolution: Check if previous turn was asking about budget or purchase
  if (history.length > 0) {
    const lastMsg = history[history.length - 1];
    const lastText = lastMsg.parts?.[0]?.text?.toLowerCase() || "";
    if (/(mua|giá|tiền|chi|ngân sách)/i.test(lastText) && /vậy (có nên|còn|sao)/i.test(text)) {
      return { category: "AFFORDABILITY_WHATIF", extractedAffordability: affordabilityParsed };
    }
  }

  return { category: "GENERAL_CHAT" };
}

// ---------------------------------------------------------------------------
// 3. Deterministic Tool Execution Engine
// ---------------------------------------------------------------------------

interface RawBudgetRecord {
  id?: string;
  name?: string;
  amount?: number | string;
  allocated_amount?: number | string;
  remaining_amount?: number | string;
  category_id?: string;
  alert_percent?: number | string;
  period?: string;
  status?: string;
  source_wallet_id?: string;
}

interface RawSavingsGoalRecord {
  id?: string;
  title?: string;
  target_amount?: number | string;
  current_amount?: number | string;
  deadline?: string;
  created_at?: string;
  source_wallet_id?: string;
  reserved_in_wallet?: number | string;
}

export async function executeFinancialTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<{ toolName: string; success: boolean; data: unknown; summaryVi: string }> {
  const client =
    ctx.client ||
    ctx.supabase ||
    (ctx.supabaseUrl && ctx.supabaseKey
      ? createClient(ctx.supabaseUrl, ctx.supabaseKey, {
          global: { headers: { Authorization: `Bearer ${ctx.token}` } },
          auth: { persistSession: false },
        })
      : null);

  try {
    switch (toolName) {
      case "get_wallet_balances": {
        let snapshot = ctx.snapshot;
        if (!snapshot && ctx.userId) {
          const cachedCtx = getCachedUserFinancialContext(ctx.userId);
          if (cachedCtx?.snapshot) {
            snapshot = cachedCtx.snapshot;
          }
        }

        if (!snapshot) {
          const [walletsRes, budgetsRes, goalsRes, transfersRes, allTxsRes] = await Promise.all([
            client
              .from("wallets")
              .select("id, name, type, balance, currency, reserved_amount")
              .eq("user_id", ctx.userId),
            client
              .from("budgets")
              .select("id, name, amount, remaining_amount, allocated_amount, status, source_wallet_id")
              .eq("user_id", ctx.userId),
            client
              .from("savings_goals")
              .select("id, title, target_amount, current_amount, source_wallet_id, reserved_in_wallet")
              .eq("user_id", ctx.userId),
            client
              .from("transfers")
              .select("id, from_wallet_id, to_wallet_id, amount")
              .eq("user_id", ctx.userId),
            client
              .from("transactions")
              .select("id, title, amount, type, category, category_id, occurred_at, wallet_id, payment_source_type, budget_id")
              .eq("user_id", ctx.userId),
          ]);

          if (walletsRes.error) throw walletsRes.error;
          if (budgetsRes.error) throw budgetsRes.error;
          if (goalsRes.error) throw goalsRes.error;
          if (transfersRes.error) throw transfersRes.error;
          if (allTxsRes.error) throw allTxsRes.error;

          const walletList = (walletsRes.data || []) as unknown as Wallet[];
          const budgetList = (budgetsRes.data || []) as unknown as Budget[];
          const goalList = (goalsRes.data || []) as unknown as SavingsGoal[];
          const transferList = (transfersRes.data || []) as unknown as Transfer[];
          const txList = (allTxsRes.data || []) as unknown as Transaction[];

          // Compute authoritative financial snapshot (identical to Dashboard)
          snapshot = buildAuthoritativeFinancialSnapshot(
            walletList,
            txList,
            transferList,
            budgetList,
            goalList,
          );
        }

        const enrichedWallets = snapshot.enrichedWallets;
        const balancesByCurrency: Record<
          string,
          {
            totalAssets: number;
            totalAllocated: number;
            totalAvailable: number;
            totalBalance: number;
            totalReserved: number;
            availableBalance: number;
          }
        > = {};
        for (const [cur, stats] of Object.entries(snapshot.byCurrency)) {
          balancesByCurrency[cur] = {
            totalAssets: stats.totalAssets,
            totalAllocated: stats.totalAllocated,
            totalAvailable: stats.totalAvailable,
            totalBalance: stats.totalAssets,
            totalReserved: stats.totalAllocated,
            availableBalance: stats.totalAvailable,
          };
        }

        // Helper to remove accents for fuzzy matching
        const cleanAccents = (str: string) =>
          str
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/đ/g, "d")
            .replace(/Đ/g, "D")
            .toLowerCase()
            .trim();

        const walletQuery = typeof args.wallet_query === "string" ? args.wallet_query.trim().toLowerCase() : undefined;
        const walletId = typeof args.wallet_id === "string" ? args.wallet_id.trim() : undefined;
        const walletType = typeof args.wallet_type === "string" ? args.wallet_type.trim().toLowerCase() : undefined;
        const focus = typeof args.focus === "string" ? args.focus.trim().toUpperCase() : undefined;

        let targetWallet: ComputedWalletSummary | undefined;
        if (walletId) {
          targetWallet = enrichedWallets.find((w) => w.id === walletId);
        }
        if (!targetWallet && walletType) {
          targetWallet = enrichedWallets.find((w) => w.type.toLowerCase() === walletType);
        }
        if (!targetWallet && walletQuery) {
          const unaccQuery = cleanAccents(walletQuery);
          if (walletQuery.includes("tiền mặt") || unaccQuery.includes("tien mat")) {
            targetWallet = enrichedWallets.find((w) => w.type === "cash" || w.name.toLowerCase().includes("tiền mặt"));
          } else if (
            walletQuery.includes("ngân hàng") ||
            unaccQuery.includes("ngan hang") ||
            /vcb|vietcombank|techcombank|mb|tpbank|bidv|acb/i.test(walletQuery)
          ) {
            targetWallet = enrichedWallets.find(
              (w) => w.type === "bank" || w.name.toLowerCase().includes("ngân hàng") || /ngân hàng|bank/i.test(w.name),
            );
          } else {
            targetWallet = enrichedWallets.find((w) => {
              const nameLower = w.name.toLowerCase();
              const nameUnacc = cleanAccents(w.name);
              return nameLower.includes(walletQuery) || nameUnacc.includes(unaccQuery);
            });
          }
        }

        const sortedByBalance = [...enrichedWallets].sort((a, b) => b.balance - a.balance);
        const highestWallet = sortedByBalance.length > 0 ? sortedByBalance[0] : undefined;

        const lines: string[] = [];

        if (focus === "HIGHEST_WALLET" && highestWallet) {
          lines.push("BÁO CÁO VÍ CÓ NHIỀU TIỀN NHẤT (THEO SỐ DƯ THỰC TẾ):");
          lines.push(
            `- Ví "${highestWallet.name}" (${highestWallet.type}) hiện đang có NHIỀU TIỀN NHẤT trong hệ thống với tổng số dư là ${highestWallet.balance.toLocaleString("vi-VN")} ${highestWallet.currency} (Đã phân bổ: ${highestWallet.reservedAmount.toLocaleString("vi-VN")} ${highestWallet.currency} => Số dư khả dụng chi tiêu: ${highestWallet.availableBalance.toLocaleString("vi-VN")} ${highestWallet.currency}).`,
          );
          lines.push(
            `\nCHỈ THỊ BẮT BUỘC CHO AI: Người dùng đang hỏi ví nào có nhiều tiền nhất. BẮT BUỘC khẳng định rõ ví "${highestWallet.name}" là ví có nhiều tiền nhất với số dư ${highestWallet.balance.toLocaleString("vi-VN")} ${highestWallet.currency}.`,
          );
          lines.push("\nSo sánh với các ví khác trong tài khoản:");
          for (const w of enrichedWallets) {
            lines.push(
              `- Ví "${w.name}" (${w.type}): Số dư ${w.balance.toLocaleString("vi-VN")} ${w.currency} | Đã phân bổ: ${w.reservedAmount.toLocaleString("vi-VN")} ${w.currency} | Khả dụng: ${w.availableBalance.toLocaleString("vi-VN")} ${w.currency}`,
            );
          }
        } else if (targetWallet) {
          lines.push(`BÁO CÁO SỐ LIỆU VÍ "${targetWallet.name.toUpperCase()}" (${targetWallet.type.toUpperCase()}):`);
          lines.push(`- Tên ví: ${targetWallet.name} (Loại: ${targetWallet.type})`);
          lines.push(`- Tổng số dư ví: ${targetWallet.balance.toLocaleString("vi-VN")} ${targetWallet.currency}`);
          lines.push(`- Tiền đã phân bổ từ ví này: ${targetWallet.reservedAmount.toLocaleString("vi-VN")} ${targetWallet.currency}`);
          lines.push(`- Số dư khả dụng của ví này: ${targetWallet.availableBalance.toLocaleString("vi-VN")} ${targetWallet.currency}`);

          if (focus === "WALLET_ALLOCATED") {
            lines.push(
              `\nCHỈ THỊ BẮT BUỘC CHO AI: Người dùng đang hỏi số tiền ĐÃ PHÂN BỔ của ví "${targetWallet.name}". Bạn BẮT BUỘC trả lời chính xác số tiền đã phân bổ từ ví này là ${targetWallet.reservedAmount.toLocaleString("vi-VN")} ${targetWallet.currency} (Số dư ví: ${targetWallet.balance.toLocaleString("vi-VN")} ${targetWallet.currency}, Khả dụng: ${targetWallet.availableBalance.toLocaleString("vi-VN")} ${targetWallet.currency}). TUYỆT ĐỐI KHÔNG lấy tổng số tiền phân bổ của toàn bộ tài khoản (${snapshot.totalAllocated.toLocaleString("vi-VN")} ${targetWallet.currency}) để trả lời cho ví này.`,
            );
          } else if (focus === "WALLET_AVAILABLE") {
            lines.push(
              `\nCHỈ THỊ BẮT BUỘC CHO AI: Người dùng đang hỏi số dư KHẢ DỤNG của ví "${targetWallet.name}". Bạn BẮT BUỘC trả lời chính xác số dư khả dụng của ví này là ${targetWallet.availableBalance.toLocaleString("vi-VN")} ${targetWallet.currency} (Số dư ví: ${targetWallet.balance.toLocaleString("vi-VN")} ${targetWallet.currency}, Đã phân bổ: ${targetWallet.reservedAmount.toLocaleString("vi-VN")} ${targetWallet.currency}). TUYỆT ĐỐI KHÔNG lấy tổng khả dụng của toàn bộ tài khoản (${snapshot.totalAvailable.toLocaleString("vi-VN")} ${targetWallet.currency}) để trả lời cho ví này.`,
            );
          } else {
            lines.push(
              `\nCHỈ THỊ BẮT BUỘC CHO AI: Người dùng đang hỏi cụ thể về ví "${targetWallet.name}". Bạn BẮT BUỘC phải trả lời chính xác số dư của ví này là ${targetWallet.balance.toLocaleString("vi-VN")} ${targetWallet.currency} (Khả dụng: ${targetWallet.availableBalance.toLocaleString("vi-VN")} ${targetWallet.currency}, Đã phân bổ: ${targetWallet.reservedAmount.toLocaleString("vi-VN")} ${targetWallet.currency}). TUYỆT ĐỐI KHÔNG lấy Tổng tài sản (${snapshot.totalAssets.toLocaleString("vi-VN")} ${targetWallet.currency}) hay Tổng khả dụng toàn bộ tài khoản (${snapshot.totalAvailable.toLocaleString("vi-VN")} ${targetWallet.currency}) để thay thế cho ví này!`,
            );
          }

          lines.push(
            `\n(Thông tin tham khảo thêm: Tổng tài sản toàn bộ các ví là ${snapshot.totalAssets.toLocaleString("vi-VN")} ${targetWallet.currency}, Tổng đã phân bổ: ${snapshot.totalAllocated.toLocaleString("vi-VN")} ${targetWallet.currency}, Tổng khả dụng: ${snapshot.totalAvailable.toLocaleString("vi-VN")} ${targetWallet.currency}).`,
          );
          lines.push("\nChi tiết các ví khác trong hệ thống:");
          for (const w of enrichedWallets) {
            if (w.id !== targetWallet.id) {
              lines.push(
                `- Ví "${w.name}" (${w.type}): Số dư ${w.balance.toLocaleString("vi-VN")} ${w.currency} | Đã phân bổ: ${w.reservedAmount.toLocaleString("vi-VN")} ${w.currency} => Khả dụng: ${w.availableBalance.toLocaleString("vi-VN")} ${w.currency}`,
              );
            }
          }
        } else if (focus === "TOTAL_AVAILABLE") {
          lines.push("BÁO CÁO TỔNG SỐ DƯ KHẢ DỤNG CHI TIÊU (ĐỒNG BỘ 100% DASHBOARD & GIAO DIỆN VÍ):");
          for (const [cur, stats] of Object.entries(balancesByCurrency)) {
            lines.push(
              `- Tiền tệ ${cur}: Tổng số dư khả dụng chi tiêu là ${stats.totalAvailable.toLocaleString("vi-VN")} ${cur}.`,
            );
            lines.push(
              `  Công thức: Số dư khả dụng = Tổng tài sản (${stats.totalAssets.toLocaleString("vi-VN")} ${cur}) - Đã phân bổ (${stats.totalAllocated.toLocaleString("vi-VN")} ${cur}) = ${stats.totalAvailable.toLocaleString("vi-VN")} ${cur}.`,
            );
          }
          lines.push("\nChi tiết từng ví/tài khoản:");
          for (const w of enrichedWallets) {
            lines.push(
              `- Ví "${w.name}" (${w.type}): Khả dụng ${w.availableBalance.toLocaleString("vi-VN")} ${w.currency} (Số dư: ${w.balance.toLocaleString("vi-VN")} ${w.currency}, Đã phân bổ: ${w.reservedAmount.toLocaleString("vi-VN")} ${w.currency})`,
            );
          }
        } else if (focus === "TOTAL_ALLOCATED") {
          lines.push("BÁO CÁO TỔNG TIỀN ĐÃ PHÂN BỔ (GIỮ CHỖ NGÂN SÁCH & MỤC TIÊU TIẾT KIỆM):");
          for (const [cur, stats] of Object.entries(balancesByCurrency)) {
            lines.push(
              `- Tiền tệ ${cur}: Tổng tiền đã phân bổ là ${stats.totalAllocated.toLocaleString("vi-VN")} ${cur} (trên tổng tài sản ${stats.totalAssets.toLocaleString("vi-VN")} ${cur}).`,
            );
            lines.push(
              `- Tiền đã phân bổ không hề mất đi mà được giữ trong các hạn mức ngân sách chi tiêu và mục tiêu tiết kiệm nhằm bảo toàn tài chính.`,
            );
          }
          lines.push("\nChi tiết phân bổ theo từng ví:");
          for (const w of enrichedWallets) {
            lines.push(
              `- Ví "${w.name}" (${w.type}): Đã phân bổ ${w.reservedAmount.toLocaleString("vi-VN")} ${w.currency} (Số dư: ${w.balance.toLocaleString("vi-VN")} ${w.currency}, Khả dụng: ${w.availableBalance.toLocaleString("vi-VN")} ${w.currency})`,
            );
          }
        } else {
          lines.push("BÁO CÁO TỔNG TÀI SẢN & SỐ DƯ KHẢ DỤNG (ĐỒNG BỘ 100% DASHBOARD & GIAO DIỆN VÍ):");
          for (const [cur, stats] of Object.entries(balancesByCurrency)) {
            lines.push(
              `- Tiền tệ ${cur}: Tổng tài sản ${stats.totalAssets.toLocaleString("vi-VN")} ${cur} (Tổng số dư: ${stats.totalAssets.toLocaleString("vi-VN")} ${cur}) | Đã phân bổ: ${stats.totalAllocated.toLocaleString("vi-VN")} ${cur} => Số dư khả dụng chi tiêu: ${stats.totalAvailable.toLocaleString("vi-VN")} ${cur}`,
            );
          }

          lines.push("\nChi tiết từng ví/tài khoản:");
          for (const w of enrichedWallets) {
            lines.push(
              `- Ví "${w.name}" (${w.type}): Tổng số dư ${w.balance.toLocaleString("vi-VN")} ${w.currency} | Đã phân bổ: ${w.reservedAmount.toLocaleString("vi-VN")} ${w.currency} => Khả dụng: ${w.availableBalance.toLocaleString("vi-VN")} ${w.currency}`,
            );
          }

          for (const [cur, stats] of Object.entries(balancesByCurrency)) {
            if (stats.totalAllocated > 0) {
              lines.push(
                `\nGIẢI THÍCH LÝ DO SỐ DƯ KHẢ DỤNG LÀ ${stats.totalAvailable.toLocaleString("vi-VN")} ${cur}:`,
              );
              lines.push(
                `- Người dùng có tổng tài sản là ${stats.totalAssets.toLocaleString("vi-VN")} ${cur}.`,
              );
              lines.push(
                `- Trong đó, ${stats.totalAllocated.toLocaleString("vi-VN")} ${cur} đã được phân bổ (giữ chỗ) vào các ngân sách chi tiêu và mục tiêu tiết kiệm nhằm đảm bảo tiền không bị tiêu lạm.`,
              );
              lines.push(
                `- Số tiền khả dụng thực tế để chi tiêu tự do hiện tại là ${stats.totalAvailable.toLocaleString("vi-VN")} ${cur} (${stats.totalAssets.toLocaleString("vi-VN")} - ${stats.totalAllocated.toLocaleString("vi-VN")} = ${stats.totalAvailable.toLocaleString("vi-VN")} ${cur}). Tiền đã phân bổ không hề mất đi mà được giữ trong các hạn mức ngân sách/tiết kiệm.`,
              );
            }
          }
        }

        return {
          toolName,
          success: true,
          data: {
            targetWallet: targetWallet
              ? {
                  id: targetWallet.id,
                  walletId: targetWallet.id,
                  name: targetWallet.name,
                  walletName: targetWallet.name,
                  type: targetWallet.type,
                  currency: targetWallet.currency,
                  balance: targetWallet.balance,
                  rawBalance: targetWallet.rawBalance,
                  reservedAmount: targetWallet.reservedAmount,
                  allocated: targetWallet.reservedAmount,
                  availableBalance: targetWallet.availableBalance,
                  available: targetWallet.availableBalance,
                }
              : undefined,
            highestWallet: highestWallet
              ? {
                  id: highestWallet.id,
                  walletId: highestWallet.id,
                  name: highestWallet.name,
                  walletName: highestWallet.name,
                  type: highestWallet.type,
                  currency: highestWallet.currency,
                  balance: highestWallet.balance,
                  rawBalance: highestWallet.rawBalance,
                  reservedAmount: highestWallet.reservedAmount,
                  allocated: highestWallet.reservedAmount,
                  availableBalance: highestWallet.availableBalance,
                  available: highestWallet.availableBalance,
                }
              : undefined,
            wallets: enrichedWallets.map((w) => ({
              id: w.id,
              walletId: w.id,
              name: w.name,
              walletName: w.name,
              type: w.type,
              currency: w.currency,
              balance: w.balance,
              rawBalance: w.rawBalance,
              reservedAmount: w.reservedAmount,
              allocated: w.reservedAmount,
              availableBalance: w.availableBalance,
              available: w.availableBalance,
            })),
            balancesByCurrency,
            totalAssets: snapshot.totalAssets,
            totalAllocated: snapshot.totalAllocated,
            totalAvailable: snapshot.totalAvailable,
            focus,
          },
          summaryVi: lines.join("\n"),
        };
      }

      case "get_spending_analysis": {
        const timeBounds = getVietnamTimeBounds();
        const curStart = timeBounds.currentStartIso;
        const curEnd = timeBounds.currentEndIso;
        const prevStart = timeBounds.previousStartIso;
        const prevEnd = timeBounds.previousEndIso;
        const curMonth = timeBounds.month - 1;
        const curYear = timeBounds.year;
        const prevMonth = curMonth === 0 ? 11 : curMonth - 1;
        const prevYear = curMonth === 0 ? curYear - 1 : curYear;

        const [curTxsRes, prevTxsRes, walletsRes] = await Promise.all([
          client.from("transactions").select("amount, type, category, wallet_id").eq("user_id", ctx.userId).gte("occurred_at", curStart).lt("occurred_at", curEnd),
          client.from("transactions").select("amount, type, category, wallet_id").eq("user_id", ctx.userId).gte("occurred_at", prevStart).lt("occurred_at", prevEnd),
          client.from("wallets").select("id, currency").eq("user_id", ctx.userId),
        ]);

        const walletCurMap = new Map<string, string>();
        for (const w of walletsRes.data || []) {
          walletCurMap.set(w.id, (w.currency || "VND").toUpperCase());
        }

        let curIncome = 0;
        let curExpense = 0;
        const curCatSpend = new Map<string, number>();

        for (const tx of curTxsRes.data || []) {
          const amt = Number(tx.amount) || 0;
          if (tx.type === "income") {
            curIncome += amt;
          } else if (tx.type === "expense") {
            curExpense += amt;
            const cat = (tx.category || "Khác").trim();
            curCatSpend.set(cat, (curCatSpend.get(cat) || 0) + amt);
          }
        }

        let prevExpense = 0;
        for (const tx of prevTxsRes.data || []) {
          if (tx.type === "expense") {
            prevExpense += Number(tx.amount) || 0;
          }
        }

        const curExpenseTxCount = (curTxsRes.data || []).filter((tx: { type?: string }) => tx.type === "expense").length;
        const hasRecordedExpenses = curExpenseTxCount > 0;
        const netSavings = curIncome - curExpense;
        const savingsRate = hasRecordedExpenses && curIncome > 0 ? Math.round((netSavings / curIncome) * 100) : null;
        const expenseDiff = curExpense - prevExpense;
        const expensePercentChange = prevExpense > 0 ? Math.round(((curExpense - prevExpense) / prevExpense) * 1000) / 10 : null;

        const sortedCats = Array.from(curCatSpend.entries())
          .map(([category, amount]) => ({
            category,
            amount,
            percentage: curExpense > 0 ? Math.round((amount / curExpense) * 1000) / 10 : 0,
          }))
          .sort((a, b) => b.amount - a.amount);

        const savingsRateStr = savingsRate !== null
          ? `(Tỷ lệ tiết kiệm: ${savingsRate}%)`
          : `(Chưa có giao dịch chi tiêu được ghi nhận trong kỳ, không thể kết luận tỷ lệ tiết kiệm đạt 100%)`;

        const lines = [
          `TỔNG KẾT CHI TIÊU THÁNG ${curMonth + 1}/${curYear}:`,
          `- Tổng thu nhập: ${curIncome.toLocaleString("vi-VN")} VND`,
          `- Tổng chi tiêu: ${curExpense.toLocaleString("vi-VN")} VND`,
          `- Tiết kiệm ròng: ${netSavings.toLocaleString("vi-VN")} VND ${savingsRateStr}`,
          `- So với tháng trước (${prevMonth + 1}/${prevYear}): ${prevExpense === 0 ? "Tháng trước không có chi tiêu" : `Chi tiêu ${expenseDiff >= 0 ? "tăng" : "giảm"} ${Math.abs(expenseDiff).toLocaleString("vi-VN")} VND (${expensePercentChange !== null ? (expensePercentChange >= 0 ? "+" : "") + expensePercentChange + "%" : ""})`}`,
        ];

        if (sortedCats.length > 0) {
          lines.push(`- Khoản chi nhiều nhất: Danh mục "${sortedCats[0].category}" với ${sortedCats[0].amount.toLocaleString("vi-VN")} VND (${sortedCats[0].percentage}% tổng chi).`);
          lines.push("Chi tiết các danh mục hàng đầu:");
          for (const c of sortedCats.slice(0, 5)) {
            lines.push(`  + ${c.category}: ${c.amount.toLocaleString("vi-VN")} VND (${c.percentage}%)`);
          }
        }

        return {
          toolName,
          success: true,
          data: { curIncome, curExpense, netSavings, savingsRate, prevExpense, expenseDiff, expensePercentChange, topCategories: sortedCats },
          summaryVi: lines.join("\n"),
        };
      }

      case "get_budget_status": {
        const timeBounds = getVietnamTimeBounds();
        const curStart = timeBounds.currentStartIso;
        const curEnd = timeBounds.currentEndIso;

        const [budgetsRes, categoriesRes, currentTxsRes] = await Promise.all([
          client.from("budgets").select("id, name, amount, allocated_amount, remaining_amount, category_id, period, alert_percent, source_wallet_id").eq("user_id", ctx.userId),
          client.from("categories").select("id, name").eq("user_id", ctx.userId),
          client.from("transactions").select("amount, type, category, category_id").eq("user_id", ctx.userId).eq("type", "expense").gte("occurred_at", curStart).lt("occurred_at", curEnd),
        ]);

        const catNameMap = new Map<string, string>();
        for (const c of categoriesRes.data || []) {
          catNameMap.set(c.id, c.name);
        }

        const catSpendMap = new Map<string, number>();
        for (const tx of currentTxsRes.data || []) {
          const amt = Number(tx.amount) || 0;
          const catName = (tx.category_id && catNameMap.get(tx.category_id)) || tx.category || "Khác";
          const normCat = catName.trim().toLowerCase();
          catSpendMap.set(normCat, (catSpendMap.get(normCat) || 0) + amt);
        }

        const targetCatFilter = typeof args.category === "string" ? args.category.trim().toLowerCase() : null;

        const budgetSummaries = (budgetsRes.data || [])
          .filter((b: RawBudgetRecord) => {
            if (!targetCatFilter) return true;
            const bName = (b.name || "").toLowerCase();
            const catName = (b.category_id && catNameMap.get(b.category_id) || "").toLowerCase();
            return bName.includes(targetCatFilter) || catName.includes(targetCatFilter);
          })
          .map((b: RawBudgetRecord) => {
            const catName = (b.category_id ? catNameMap.get(b.category_id) || b.name : b.name) || "Khác";
            const limit = Number(b.amount) || 0;
            const actualSpent = catSpendMap.get(catName.trim().toLowerCase()) || 0;
            const limitRemaining = Math.max(0, limit - actualSpent);
            const percentUsed = limit > 0 ? Math.round((actualSpent / limit) * 1000) / 10 : 0;
            const allocated = Number(b.allocated_amount) || 0;
            const fundedRemaining = Number(b.remaining_amount) || 0;
            const alertThreshold = Number(b.alert_percent) || 80;

            let status = "normal";
            let statusText = "An toàn (< 80%)";
            if (actualSpent > limit) {
              status = "exceeded_limit";
              statusText = "VƯỢT HẠN MỨC CHI TIÊU";
            } else if (actualSpent === limit) {
              status = "reached_limit";
              statusText = "ĐÃ ĐẠT 100% HẠN MỨC";
            } else if (percentUsed >= alertThreshold) {
              status = "near_limit";
              statusText = `CẢNH BÁO: SẮP ĐẠT HẠN MỨC (>= ${alertThreshold}%)`;
            }

            return {
              budgetName: b.name,
              categoryName: catName,
              limit,
              actualSpent,
              limitRemaining,
              percentUsed,
              allocated,
              fundedRemaining,
              isFunded: allocated > 0,
              status,
              statusText,
            };
          });

        const lines = ["TÌNH TRẠNG NGÂN SÁCH CHI TIÊU:"];
        if (budgetSummaries.length === 0) {
          lines.push("- Bạn chưa thiết lập ngân sách nào (hoặc không tìm thấy ngân sách phù hợp).");
        } else {
          for (const bs of budgetSummaries) {
            lines.push(
              `- "${bs.budgetName}": Hạn mức ${bs.limit.toLocaleString("vi-VN")} VND | Đã chi thực tế ${bs.actualSpent.toLocaleString("vi-VN")} VND (${bs.percentUsed}%) | Còn được phép chi: ${bs.limitRemaining.toLocaleString("vi-VN")} VND [${bs.statusText}]${bs.isFunded ? ` | Quỹ phong bì cấp vốn còn: ${bs.fundedRemaining.toLocaleString("vi-VN")} VND` : ""}`,
            );
          }
        }

        return {
          toolName,
          success: true,
          data: { budgets: budgetSummaries },
          summaryVi: lines.join("\n"),
        };
      }

      case "get_savings_goals": {
        const { data: goals, error } = await client
          .from("savings_goals")
          .select("id, title, target_amount, current_amount, deadline, created_at")
          .eq("user_id", ctx.userId);

        if (error) throw error;
        const goalList = (goals || []).map((g: RawSavingsGoalRecord) => {
          const target = Number(g.target_amount) || 0;
          const current = Number(g.current_amount) || 0;
          const remaining = Math.max(0, target - current);
          const percent = target > 0 ? Math.round((current / target) * 100) : 0;
          return {
            id: g.id,
            title: g.title,
            targetAmount: target,
            currentAmount: current,
            remainingAmount: remaining,
            progressPercent: percent,
            deadline: g.deadline,
          };
        });

        const lines = ["TIẾN ĐỘ CÁC MỤC TIÊU TIẾT KIỆM:"];
        if (goalList.length === 0) {
          lines.push("- Bạn chưa tạo mục tiêu tiết kiệm nào.");
        } else {
          for (const g of goalList) {
            lines.push(
              `- Mục tiêu "${g.title}": Đã tích lũy ${g.currentAmount.toLocaleString("vi-VN")} VND / ${g.targetAmount.toLocaleString("vi-VN")} VND (${g.progressPercent}%). Còn thiếu ${g.remainingAmount.toLocaleString("vi-VN")} VND${g.deadline ? ` (Hạn chót: ${g.deadline})` : ""}`,
            );
          }
        }

        return {
          toolName,
          success: true,
          data: { savingsGoals: goalList },
          summaryVi: lines.join("\n"),
        };
      }

      case "get_recent_transactions": {
        const limitCount = Math.min(30, Math.max(1, Number(args.limit) || 10));
        let query = client
          .from("transactions")
          .select("id, title, amount, type, category, occurred_at, wallet_id, note")
          .eq("user_id", ctx.userId)
          .order("occurred_at", { ascending: false })
          .limit(limitCount);

        if (typeof args.category === "string" && args.category.trim()) {
          query = query.ilike("category", `%${args.category.trim()}%`);
        }
        if (typeof args.type === "string" && (args.type === "income" || args.type === "expense")) {
          query = query.eq("type", args.type);
        }

        const { data: txs, error } = await query;
        if (error) throw error;

        const txList = txs || [];
        const lines = [
          `DANH SÁCH ${txList.length} GIAO DỊCH GẦN ĐÂY ĐỂ THAM KHẢO (ĐÂY CHỈ LÀ DANH SÁCH MẪU TRÍCH XUẤT TỐI ĐA ${limitCount} BẢN GHI, TUYỆT ĐỐI KHÔNG PHẢI LÀ TỔNG SỐ GIAO DỊCH TRONG THÁNG HAY TOÀN TÀI KHOẢN):`,
        ];
        for (const t of txList) {
          const typeLabel = t.type === "income" ? "[Thu]" : "[Chi]";
          const dateStr = t.occurred_at ? t.occurred_at.split("T")[0] : "";
          lines.push(`- ${typeLabel} ${t.title}: ${Number(t.amount).toLocaleString("vi-VN")} VND (${t.category || "Khác"}, ngày ${dateStr})`);
        }

        return {
          toolName,
          success: true,
          data: { transactions: txList },
          summaryVi: lines.join("\n"),
        };
      }

      case "get_transaction_statistics": {
        try {
          // 1. Determine period & date range in Asia/Ho_Chi_Minh (UTC+7)
          const periodArg = typeof args.period === "string" ? args.period.trim().toLowerCase() : "current_month";
          const startDateArg = typeof args.start_date === "string" ? args.start_date.trim() : (typeof args.startDate === "string" ? args.startDate.trim() : undefined);
          const endDateArg = typeof args.end_date === "string" ? args.end_date.trim() : (typeof args.endDate === "string" ? args.endDate.trim() : undefined);
          const monthArg = typeof args.month === "number" ? args.month : (typeof args.month === "string" ? parseInt(args.month, 10) : undefined);
          const yearArg = typeof args.year === "number" ? args.year : (typeof args.year === "string" ? parseInt(args.year, 10) : undefined);
          const categoryFilter = typeof args.category === "string" && args.category.trim() ? args.category.trim() : undefined;
          const typeFilter = typeof args.type === "string" && (args.type === "income" || args.type === "expense") ? args.type : undefined;
          const walletIdFilter = typeof args.wallet_id === "string" && args.wallet_id.trim() ? args.wallet_id.trim() : undefined;

          const timeBounds = getVietnamTimeBounds();
          let startIso: string;
          let endIso: string;
          let periodLabel: string;
          let isAllTime = false;

          if (periodArg === "all") {
            isAllTime = true;
            startIso = "1970-01-01T00:00:00.000Z";
            endIso = "2099-12-31T23:59:59.999Z";
            periodLabel = "Toàn bộ thời gian (Toàn bộ tài khoản)";
          } else if (periodArg === "previous_month") {
            startIso = timeBounds.previousStartIso;
            endIso = timeBounds.previousEndIso;
            periodLabel = timeBounds.previousMonthLabel;
          } else if (monthArg && monthArg >= 1 && monthArg <= 12) {
            const targetYear = yearArg && yearArg >= 2000 ? yearArg : timeBounds.year;
            const range = parseMonthRangeVn(targetYear, monthArg);
            startIso = range.startIso;
            endIso = range.endIso;
            periodLabel = range.label;
          } else if (startDateArg) {
            const range = parseCustomDateRangeVn(startDateArg, endDateArg);
            startIso = range.startIso;
            endIso = range.endIso;
            periodLabel = range.label;
          } else {
            // Default: current_month
            startIso = timeBounds.currentStartIso;
            endIso = timeBounds.currentEndIso;
            periodLabel = timeBounds.currentMonthLabel;
          }

          // 2. Concurrently fetch:
          // - All transactions of this user (for total account count)
          // - Period transactions
          // - Period transfers
          // - Recurring templates
          const [allTxsRes, periodTxsRes, transfersRes, recurringRes] = await Promise.all([
            client
              .from("transactions")
              .select("id, type, amount, category, wallet_id, occurred_at")
              .eq("user_id", ctx.userId),
            isAllTime
              ? null
              : client
                  .from("transactions")
                  .select("id, title, amount, type, category, category_id, occurred_at, wallet_id, note")
                  .eq("user_id", ctx.userId)
                  .gte("occurred_at", startIso)
                  .lt("occurred_at", endIso)
                  .order("occurred_at", { ascending: false }),
            client
              .from("transfers")
              .select("id, from_wallet_id, to_wallet_id, amount, occurred_at")
              .eq("user_id", ctx.userId)
              .gte("occurred_at", startIso)
              .lt("occurred_at", endIso),
            client
              .from("recurring_transactions")
              .select("id, title, amount, type, active, auto_create")
              .eq("user_id", ctx.userId),
          ]);

          if (allTxsRes?.error) throw allTxsRes.error;
          if (periodTxsRes?.error) throw periodTxsRes.error;
          if (transfersRes?.error) throw transfersRes.error;

          const allTransactions = (allTxsRes?.data ?? []) as Array<{ id: string; type: string; amount: number; category?: string; wallet_id?: string; occurred_at?: string }>;
          const totalAccountTransactions = allTransactions.length;

          const rawPeriodTxs = isAllTime
            ? allTransactions
            : ((periodTxsRes?.data ?? []) as Array<{ id: string; title?: string; amount: number; type: string; category?: string; category_id?: string; occurred_at: string; wallet_id?: string; note?: string }>);

          const periodTransactionCount = rawPeriodTxs.length;

          // Apply filters if provided
          let filteredTxs = rawPeriodTxs;
          if (categoryFilter) {
            const normCat = categoryFilter.toLowerCase();
            filteredTxs = filteredTxs.filter((t) => (t.category || "").toLowerCase().includes(normCat));
          }
          if (typeFilter) {
            filteredTxs = filteredTxs.filter((t) => t.type === typeFilter);
          }
          if (walletIdFilter) {
            filteredTxs = filteredTxs.filter((t) => t.wallet_id === walletIdFilter);
          }

          const filteredTransactionCount = filteredTxs.length;

          // Breakdown counts and totals
          let totalIncome = 0;
          let totalExpense = 0;
          let incomeCount = 0;
          let expenseCount = 0;

          for (const t of rawPeriodTxs) {
            const amt = Number(t.amount) || 0;
            if (t.type === "income") {
              incomeCount++;
              totalIncome += amt;
            } else if (t.type === "expense") {
              expenseCount++;
              totalExpense += amt;
            }
          }

          const transfers = (transfersRes?.data ?? []) as Array<{ id: string; amount: number }>;
          const transfersCount = transfers.length;
          const totalTransfersAmount = transfers.reduce((sum, tr) => sum + (Number(tr.amount) || 0), 0);

          const recurringTemplates = (recurringRes?.data ?? []) as Array<{ id: string; active: boolean; auto_create: boolean }>;
          const activeRecurringCount = recurringTemplates.filter((r) => r.active).length;

          const netDifference = totalIncome - totalExpense;

          // Build deterministic summaryVi
          const lines: string[] = [
            `THỐNG KÊ GIAO DỊCH (XÁC THỰC TỪ SERVER - MÚI GIỜ ASIA/HO_CHI_MINH UTC+7):`,
            `- Kỳ thống kê: ${periodLabel}`,
            `- Số lượng giao dịch trong kỳ: ${periodTransactionCount} giao dịch (${expenseCount} khoản chi tiêu, ${incomeCount} khoản thu nhập)`,
            `- Tổng chi tiêu trong kỳ: ${totalExpense.toLocaleString("vi-VN")} VND`,
            `- Tổng thu nhập trong kỳ: ${totalIncome.toLocaleString("vi-VN")} VND`,
            `- Chênh lệch thu - chi: ${netDifference >= 0 ? "+" : ""}${netDifference.toLocaleString("vi-VN")} VND`,
            `- Giao dịch chuyển tiền giữa các ví: ${transfersCount} lượt (tổng ${totalTransfersAmount.toLocaleString("vi-VN")} VND - không tính vào thu/chi)`,
            `- Tổng số giao dịch toàn tài khoản (mọi thời điểm): ${totalAccountTransactions} giao dịch`,
          ];

          if (categoryFilter || typeFilter || walletIdFilter) {
            const filterParts = [
              categoryFilter && `Danh mục "${categoryFilter}"`,
              typeFilter && `Loại "${typeFilter}"`,
              walletIdFilter && `Ví "${walletIdFilter}"`,
            ].filter(Boolean);
            lines.push(`- Số giao dịch sau bộ lọc (${filterParts.join(", ")}): ${filteredTransactionCount} giao dịch`);
          }

          lines.push(`- NGUYÊN TẮC PHÂN BIỆT BẮT BUỘC:`);
          lines.push(`  + Số giao dịch thực tế trong kỳ được hỏi là ĐÚNG: ${periodTransactionCount} giao dịch.`);
          lines.push(`  + KHÔNG nhầm lẫn số giao dịch trong kỳ (${periodTransactionCount}) với tổng số giao dịch toàn tài khoản (${totalAccountTransactions}).`);
          lines.push(`  + KHÔNG nhầm lẫn với số bản ghi hiển thị trên một trang (ví dụ danh sách trang hiển thị 10 hoặc 20 bản ghi chỉ là phân trang, không phải tổng số).`);
          lines.push(`  + ${activeRecurringCount} lịch giao dịch định kỳ chỉ là thiết lập hẹn giờ tự động, chưa tính vào giao dịch thực tế nếu chưa phát sinh.`);

          if (periodTransactionCount === 0) {
            lines.push(`  + Người dùng KHÔNG CÓ giao dịch nào trong khoảng thời gian ${periodLabel}. BẮT BUỘC trả lời rõ ràng là 0 giao dịch.`);
          }

          return {
            toolName,
            success: true,
            data: {
              period: periodLabel,
              timezone: "Asia/Ho_Chi_Minh (UTC+7)",
              startIso,
              endIso,
              periodTransactionCount,
              expenseCount,
              incomeCount,
              totalExpense,
              totalIncome,
              netDifference,
              transfersCount,
              totalTransfersAmount,
              totalAccountTransactions,
              filteredTransactionCount,
              activeRecurringCount,
            },
            summaryVi: lines.join("\n"),
          };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          return {
            toolName,
            success: false,
            data: null,
            summaryVi: `LỖI TRUY XUẤT CƠ SỞ DỮ LIỆU: Không thể truy xuất thống kê giao dịch từ máy chủ (${errMsg}). Hệ thống KHÔNG THỂ XÁC MINH số lượng giao dịch của bạn lúc này. Tuyệt đối không tự bịa đặt hay giả định con số.`,
          };
        }
      }

      case "evaluate_purchase_affordability": {
        const itemName = typeof args.item_name === "string" ? args.item_name.trim() : "Khoản chi này";
        const price = Math.max(0, Number(args.price) || 0);
        const days = Number(args.days) > 0 ? Number(args.days) : undefined;

        const timeBounds = getVietnamTimeBounds();
        const curStart = timeBounds.currentStartIso;
        const curEnd = timeBounds.currentEndIso;

        // Concurrently fetch wallets, budgets, categories, goals, transfers, and transactions
        const [walletsRes, budgetsRes, categoriesRes, goalsRes, transfersRes, allTxsRes, periodExpenseTxsRes] = await Promise.all([
          client
            .from("wallets")
            .select("id, name, type, balance, currency, reserved_amount")
            .eq("user_id", ctx.userId),
          client
            .from("budgets")
            .select("id, name, amount, remaining_amount, allocated_amount, status, category_id, source_wallet_id")
            .eq("user_id", ctx.userId),
          client
            .from("categories")
            .select("id, name")
            .eq("user_id", ctx.userId),
          client
            .from("savings_goals")
            .select("id, title, target_amount, current_amount, source_wallet_id, reserved_in_wallet")
            .eq("user_id", ctx.userId),
          client
            .from("transfers")
            .select("id, from_wallet_id, to_wallet_id, amount")
            .eq("user_id", ctx.userId),
          client
            .from("transactions")
            .select("id, title, amount, type, category, category_id, occurred_at, wallet_id, payment_source_type, budget_id")
            .eq("user_id", ctx.userId),
          client
            .from("transactions")
            .select("amount, category, category_id")
            .eq("user_id", ctx.userId)
            .eq("type", "expense")
            .gte("occurred_at", curStart)
            .lt("occurred_at", curEnd),
        ]);

        if (walletsRes.error) throw walletsRes.error;
        if (budgetsRes.error) throw budgetsRes.error;
        if (categoriesRes.error) throw categoriesRes.error;
        if (transfersRes.error) throw transfersRes.error;
        if (allTxsRes.error) throw allTxsRes.error;

        const walletList = (walletsRes.data || []) as unknown as Wallet[];
        const budgetList = (budgetsRes.data || []) as unknown as Budget[];
        const goalList = (goalsRes.data || []) as unknown as SavingsGoal[];
        const transferList = (transfersRes.data || []) as unknown as Transfer[];
        const txList = (allTxsRes.data || []) as unknown as Transaction[];
        const catList = categoriesRes.data || [];

        const catNameMap = new Map<string, string>();
        for (const c of catList) {
          catNameMap.set(c.id, c.name);
        }

        // Authoritative Snapshot for true wallet balances and reserved funds
        const snapshot = buildAuthoritativeFinancialSnapshot(
          walletList,
          txList,
          transferList,
          budgetList,
          goalList,
        );

        const totalBalanceVnd = snapshot.byCurrency["VND"]?.totalAssets ?? 0;
        const totalReservedVnd = snapshot.byCurrency["VND"]?.totalAllocated ?? 0;
        const totalAvailableVnd = snapshot.byCurrency["VND"]?.totalAvailable ?? 0;

        const walletEvaluations = snapshot.enrichedWallets.map((w) => {
          const canCoverIndividually = w.availableBalance >= price;
          const remainingAfter = w.availableBalance - price;

          return {
            id: w.id,
            name: w.name,
            type: w.type,
            balance: w.balance,
            reservedAmount: w.reservedAmount,
            availableBalance: w.availableBalance,
            currency: w.currency,
            canCoverIndividually,
            remainingAfter,
          };
        });

        // Determine target category
        const explicitCategory = typeof args.category === "string" ? args.category.trim().toLowerCase() : "";
        const itemLower = itemName.toLowerCase();
        let targetCategory = explicitCategory;
        if (!targetCategory) {
          if (/ăn|tiệc|uống|cơm|phở|nhà hàng|thực phẩm|siêu thị|bữa sáng|ăn sáng/i.test(itemLower)) targetCategory = "ăn uống";
          else if (/xăng|xe|đi lại|vé máy bay|grab|be/i.test(itemLower)) targetCategory = "di chuyển";
          else if (/nhà|thuê|trọ|điện|nước|internet/i.test(itemLower)) targetCategory = "nhà ở";
        }

        // Evaluate matching budget
        let matchingBudget: { name: string; limit: number; actualSpent: number; remaining: number } | null = null;
        if (targetCategory && budgetList.length > 0) {
          const matchedB = budgetList.find((b) => {
            const bName = (b.name || "").toLowerCase();
            const cName = (b.category_id && catNameMap.get(b.category_id) || "").toLowerCase();
            return bName.includes(targetCategory) || cName.includes(targetCategory);
          });

          if (matchedB) {
            const bLimit = Number(matchedB.amount) || 0;
            const matchedCatName = matchedB.category_id ? catNameMap.get(matchedB.category_id) || matchedB.name : matchedB.name;
            let spent = 0;
            for (const t of periodExpenseTxsRes.data || []) {
              const tCat = (t.category_id && catNameMap.get(t.category_id)) || t.category || "";
              if (tCat.trim().toLowerCase() === (matchedCatName || "").trim().toLowerCase()) {
                spent += Number(t.amount) || 0;
              }
            }
            matchingBudget = {
              name: matchedB.name || "Ngân sách",
              limit: bLimit,
              actualSpent: spent,
              remaining: Math.max(0, bLimit - spent),
            };
          }
        }

        const canAffordCash = totalAvailableVnd >= price;
        const cashRemainingAfter = totalAvailableVnd - price;
        const budgetRemainingAfter = matchingBudget ? matchingBudget.remaining - price : null;
        const wouldExceedBudget = budgetRemainingAfter !== null && budgetRemainingAfter < 0;

        // Multi-day calculation
        let dailyBudget: number | undefined;
        let suggestedMeals: string[] = [];
        if (days && days > 0) {
          dailyBudget = Math.round(price / days);
          if (targetCategory === "ăn uống" || /ăn/i.test(itemLower)) {
            suggestedMeals = [
              "Bánh mì pate / chả / trứng: ~15.000 - 25.000 VND/bữa",
              "Xôi xéo / xôi gà / xôi ngô nóng: ~15.000 - 20.000 VND/bữa",
              "Bánh bao nóng (nhân thịt, trứng cút): ~15.000 - 20.000 VND/bữa",
              "Bánh cuốn / bún xào bình dân: ~20.000 - 28.000 VND/bữa",
              "Tự chuẩn bị tại nhà (trứng ốp la, bánh mì sandwich, sữa): ~15.000 - 20.000 VND/bữa",
            ];
          }
        }

        // Target wallet evaluation if specified
        const targetWalletQuery = typeof args.target_wallet === "string" ? args.target_wallet.trim().toLowerCase() : undefined;
        const targetWalletType = typeof args.target_wallet_type === "string" ? args.target_wallet_type.trim().toLowerCase() : undefined;

        let targetWallet: ComputedWalletSummary | undefined;
        if (targetWalletType) {
          targetWallet = snapshot.enrichedWallets.find((w) => w.type.toLowerCase() === targetWalletType);
        }
        if (!targetWallet && targetWalletQuery) {
          const cleanAccents = (str: string) =>
            str
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .replace(/đ/g, "d")
              .replace(/Đ/g, "D")
              .toLowerCase()
              .trim();
          const unacc = cleanAccents(targetWalletQuery);
          if (targetWalletQuery.includes("tiền mặt") || unacc.includes("tien mat")) {
            targetWallet = snapshot.enrichedWallets.find((w) => w.type === "cash" || w.name.toLowerCase().includes("tiền mặt"));
          } else if (targetWalletQuery.includes("ngân hàng") || unacc.includes("ngan hang")) {
            targetWallet = snapshot.enrichedWallets.find((w) => w.type === "bank" || w.name.toLowerCase().includes("ngân hàng"));
          } else {
            targetWallet = snapshot.enrichedWallets.find((w) => w.name.toLowerCase().includes(targetWalletQuery));
          }
        }

        let verdict: "AFFORDABLE_SAFE" | "WARNING_BUDGET" | "WARNING_BALANCE" = "AFFORDABLE_SAFE";
        let verdictSummary = "";

        if (targetWallet) {
          const canAffordTarget = targetWallet.availableBalance >= price;
          const targetRemainingAfter = targetWallet.availableBalance - price;

          if (!canAffordTarget) {
            verdict = "WARNING_BALANCE";
            verdictSummary = `KHÔNG ĐỦ TIỀN MẶT / KHÔNG ĐỦ TIỀN TỪ VÍ "${targetWallet.name}": Bạn cần ${price.toLocaleString("vi-VN")} VND nhưng ví "${targetWallet.name}" hiện chỉ còn khả dụng ${targetWallet.availableBalance.toLocaleString("vi-VN")} VND (thiếu ${Math.abs(targetRemainingAfter).toLocaleString("vi-VN")} VND). (Lưu ý: Nếu xét tổng khả dụng của toàn bộ ví thì bạn có ${totalAvailableVnd.toLocaleString("vi-VN")} VND nhờ ví khác như ví ngân hàng).`;
          } else if (wouldExceedBudget) {
            verdict = "WARNING_BUDGET";
            verdictSummary = `CÓ THỂ CHI TRẢ TỪ VÍ "${targetWallet.name}" NHƯNG VƯỢT NGÂN SÁCH: Ví "${targetWallet.name}" có đủ ${targetWallet.availableBalance.toLocaleString("vi-VN")} VND khả dụng để chi trả (sau khi chi còn ${targetRemainingAfter.toLocaleString("vi-VN")} VND), nhưng khoản chi này sẽ làm ngân sách "${matchingBudget?.name}" bị VƯỢT ${Math.abs(budgetRemainingAfter!).toLocaleString("vi-VN")} VND.`;
          } else {
            verdict = "AFFORDABLE_SAFE";
            verdictSummary = `AN TOÀN ĐỂ MUA BẰNG VÍ "${targetWallet.name}": Ví "${targetWallet.name}" hiện có ${targetWallet.availableBalance.toLocaleString("vi-VN")} VND khả dụng, đủ để chi ${price.toLocaleString("vi-VN")} VND (sau khi chi ví này còn lại ${targetRemainingAfter.toLocaleString("vi-VN")} VND khả dụng)${matchingBudget ? ` và ngân sách vẫn an toàn (còn ${budgetRemainingAfter?.toLocaleString("vi-VN")} VND)` : ""}.`;
          }
        } else if (!canAffordCash) {
          verdict = "WARNING_BALANCE";
          verdictSummary = `KHÔNG ĐỦ TIỀN MẶT / KHÔNG ĐỦ TIỀN KHẢ DỤNG: Bạn cần ${price.toLocaleString("vi-VN")} VND nhưng tổng số dư khả dụng hiện chỉ có ${totalAvailableVnd.toLocaleString("vi-VN")} VND (thiếu ${Math.abs(cashRemainingAfter).toLocaleString("vi-VN")} VND).`;
        } else if (wouldExceedBudget) {
          verdict = "WARNING_BUDGET";
          verdictSummary = `CÓ THỂ CHI TRẢ NHƯNG VƯỢT NGÂN SÁCH: Bạn có đủ ${totalAvailableVnd.toLocaleString("vi-VN")} VND khả dụng để chi trả (sau khi chi còn ${cashRemainingAfter.toLocaleString("vi-VN")} VND), nhưng khoản chi này sẽ làm ngân sách "${matchingBudget?.name}" bị VƯỢT ${Math.abs(budgetRemainingAfter!).toLocaleString("vi-VN")} VND.`;
        } else {
          verdict = "AFFORDABLE_SAFE";
          verdictSummary = `AN TOÀN ĐỂ MUA / HOÀN TOÀN ĐỦ TIỀN: Tổng số dư khả dụng hiện có ${totalAvailableVnd.toLocaleString("vi-VN")} VND, đủ để chi ${price.toLocaleString("vi-VN")} VND (sau khi chi còn lại ${cashRemainingAfter.toLocaleString("vi-VN")} VND khả dụng)${matchingBudget ? ` và ngân sách vẫn an toàn (còn ${budgetRemainingAfter?.toLocaleString("vi-VN")} VND)` : ""}.`;
        }

        const lines = [
          `ĐÁNH GIÁ KHẢ NĂNG CHI TRẢ "${itemName}" (GIÁ ${price.toLocaleString("vi-VN")} VND)${targetWallet ? ` BẰNG VÍ "${targetWallet.name.toUpperCase()}"` : ""}:`,
          `- Kết luận: ${verdictSummary}`,
          `- Tổng tài sản hiện có: ${totalBalanceVnd.toLocaleString("vi-VN")} VND (Đã phân bổ: ${totalReservedVnd.toLocaleString("vi-VN")} VND)`,
          `- Tổng số dư khả dụng: ${totalAvailableVnd.toLocaleString("vi-VN")} VND => Sau khi chi còn: ${cashRemainingAfter.toLocaleString("vi-VN")} VND`,
        ];

        if (targetWallet) {
          const canAffordTarget = targetWallet.availableBalance >= price;
          lines.push(
            `\nCHỈ THỊ BẮT BUỘC CHO AI: Người dùng đang hỏi có đủ tiền chi trả bằng ví "${targetWallet.name}" (${targetWallet.type}) không. Bạn BẮT BUỘC khẳng định rõ ví "${targetWallet.name}" ${canAffordTarget ? "ĐỦ" : "KHÔNG ĐỦ"} khả dụng để chi trả (Khả dụng ví: ${targetWallet.availableBalance.toLocaleString("vi-VN")} VND vs Cần chi: ${price.toLocaleString("vi-VN")} VND). TUYỆT ĐỐI KHÔNG dùng tổng khả dụng toàn bộ tài khoản để kết luận ví "${targetWallet.name}" là đủ!`,
          );
        }

        lines.push("\nKiểm tra nguồn ví chi trả cụ thể:");
        for (const w of walletEvaluations) {
          if (w.currency === "VND") {
            if (w.canCoverIndividually) {
              lines.push(
                `- Ví "${w.name}": Khả dụng ${w.availableBalance.toLocaleString("vi-VN")} VND => ĐỦ ĐỂ CHI TRẢ (sau khi chi còn dư ${w.remainingAfter.toLocaleString("vi-VN")} VND)`,
              );
            } else {
              lines.push(
                `- Ví "${w.name}": Khả dụng ${w.availableBalance.toLocaleString("vi-VN")} VND => KHÔNG ĐỦ nếu chỉ dùng riêng ví này (thiếu ${Math.abs(w.remainingAfter).toLocaleString("vi-VN")} VND)`,
              );
            }
          }
        }

        if (days && days > 0 && dailyBudget) {
          lines.push(`\nKẾ HOẠCH CHI TIÊU TRONG ${days} NGÀY:`);
          lines.push(`- Ngân sách mỗi ngày: ~${dailyBudget.toLocaleString("vi-VN")} VND/ngày (${price.toLocaleString("vi-VN")} VND chia đều cho ${days} ngày).`);
          lines.push(`- Đánh giá tính khả thi: Rất khả thi và an toàn vì số dư khả dụng hiện tại (${totalAvailableVnd.toLocaleString("vi-VN")} VND) vượt trên mức ${price.toLocaleString("vi-VN")} VND cần chi.`);
          if (suggestedMeals.length > 0) {
            lines.push("- Gợi ý thực đơn ăn uống phù hợp với ngân sách ~" + dailyBudget.toLocaleString("vi-VN") + " VND/ngày:");
            for (const m of suggestedMeals) {
              lines.push(`  + ${m}`);
            }
          }
        }

        if (matchingBudget) {
          lines.push(`\nTÁC ĐỘNG ĐẾN NGÂN SÁCH "${matchingBudget.name}":`);
          lines.push(
            `- Hạn mức còn lại hiện tại: ${matchingBudget.remaining.toLocaleString("vi-VN")} VND => Sau khi chi còn: ${budgetRemainingAfter?.toLocaleString("vi-VN")} VND ${wouldExceedBudget ? "(VƯỢT HẠN MỨC NGÂN SÁCH!)" : "(Vẫn nằm trong hạn mức an toàn)"}`,
          );
        }

        return {
          toolName,
          success: true,
          data: {
            itemName,
            price,
            days,
            dailyBudget,
            totalAvailableVnd,
            totalBalanceVnd,
            totalReservedVnd,
            canAffordCash,
            cashRemainingAfter,
            walletEvaluations,
            matchingBudget,
            budgetRemainingAfter,
            wouldExceedBudget,
            suggestedMeals,
            verdict,
          },
          summaryVi: lines.join("\n"),
        };
      }

      case "get_financial_advice": {
        // Collect wallets, budgets, goals, and monthly stats
        const [walletsTool, budgetsTool, goalsTool, analysisTool] = await Promise.all([
          executeFinancialTool("get_wallet_balances", {}, ctx),
          executeFinancialTool("get_budget_status", {}, ctx),
          executeFinancialTool("get_savings_goals", {}, ctx),
          executeFinancialTool("get_spending_analysis", {}, ctx),
        ]);

        const lines = [
          "TỔNG HỢP BỨC TRANH TÀI CHÍNH TOÀN DIỆN CHO LỜI KHUYÊN:",
          walletsTool.summaryVi,
          "",
          analysisTool.summaryVi,
          "",
          budgetsTool.summaryVi,
          "",
          goalsTool.summaryVi,
          "",
          "QUY TẮC TƯ VẤN CÁ NHÂN HÓA (3 BƯỚC):",
          "1. Bước 1 - Đảm bảo chi tiêu thiết yếu: Giữ lại đủ tiền cho ngân sách sinh hoạt đến hết tháng.",
          "2. Bước 2 - Đóng góp mục tiêu tiết kiệm: Ưu tiên trích vào các mục tiêu có hạn chót gần nhất.",
          "3. Bước 3 - Sử dụng tiền nhàn rỗi: Chỉ dùng phần thặng dư còn lại cho chi tiêu tùy ý hoặc đầu tư.",
        ];

        return {
          toolName,
          success: true,
          data: {
            wallets: walletsTool.data,
            budgets: budgetsTool.data,
            goals: goalsTool.data,
            analysis: analysisTool.data,
          },
          summaryVi: lines.join("\n"),
        };
      }

      case "create_budget_constrained_plan": {
        const { createBudgetConstrainedPlan } = await import("./budget-planning.service.ts");
        const scope = (typeof args.scope === "string" ? args.scope : "BREAKFAST_PLAN") as
          | "BREAKFAST_PLAN"
          | "MEALS_MONTHLY_PLAN"
          | "SHOPPING_BUDGET_PLAN"
          | "SAVINGS_GOAL_PLAN"
          | "INCOME_ALLOCATION"
          | "SPENDING_REDUCTION";
        const budget = typeof args.budget === "number" ? args.budget : undefined;
        const days = typeof args.days === "number" ? args.days : scope === "BREAKFAST_PLAN" ? 7 : 30;
        const mealType = typeof args.meal_type === "string" ? (args.meal_type as "breakfast" | "all_meals" | "lunch" | "dinner") : scope === "BREAKFAST_PLAN" ? "breakfast" : "all_meals";
        const targetCategory = typeof args.target_category === "string" ? args.target_category : "Ăn uống";
        const useRemainingFunds = Boolean(args.use_remaining_funds);
        const savingsMode = typeof args.savings_mode === "string" ? (args.savings_mode as import("./budget-planning.service.ts").SavingsQueryMode) : undefined;

        const planResult = createBudgetConstrainedPlan(
          {
            scope,
            budget,
            days,
            mealType,
            targetCategory,
            useRemainingFunds,
            rawText: "",
            savingsMode,
          },
          {
            snapshot: ctx.snapshot || ctx.serverContext?.snapshot,
            serverContext: ctx.serverContext || (ctx.userId ? getCachedUserFinancialContext(ctx.userId) : null),
          },
        );

        return {
          toolName,
          success: true,
          data: planResult,
          summaryVi: planResult.summaryMarkdown,
        };
      }

      case "get_system_knowledge": {
        const query = typeof args.query === "string" ? args.query : "";
        const results = searchSystemKnowledge(query);
        const ragContext = formatRagContextForPrompt(results);

        return {
          toolName,
          success: true,
          data: { query, resultsCount: results.length },
          summaryVi: ragContext || "Không tìm thấy tài liệu hướng dẫn phù hợp.",
        };
      }

      case "search_system_knowledge": {
        const query = typeof args.query === "string" ? args.query : "";
        const userRole = args.user_role === "admin" ? "admin" : "user";
        const results = searchSystemKnowledge(query, { userRole });
        const ragContext = formatRagContextForPrompt(results);

        return {
          toolName,
          success: true,
          data: { query, resultsCount: results.length },
          summaryVi: ragContext || "Không tìm thấy tài liệu hướng dẫn phù hợp.",
        };
      }

      case "get_feature_workflow": {
        const featureId = typeof args.feature_id === "string" ? args.feature_id : "";
        const workflowText = getFeatureWorkflow(featureId);
        return {
          toolName,
          success: true,
          data: { featureId },
          summaryVi: workflowText,
        };
      }

      case "get_business_rules": {
        const featureId = typeof args.feature_id === "string" ? args.feature_id : "";
        const rulesText = getBusinessRules(featureId);
        return {
          toolName,
          success: true,
          data: { featureId },
          summaryVi: rulesText,
        };
      }

      case "get_feature_information": {
        const featureId = typeof args.feature_id === "string" ? args.feature_id : "";
        const infoText = getFeatureInformation(featureId);
        return {
          toolName,
          success: true,
          data: { featureId },
          summaryVi: infoText,
        };
      }

      case "get_realtime_information": {
        const queryStr =
          (typeof args.query === "string" ? args.query : "") ||
          (typeof args.topic === "string" ? args.topic : "") ||
          "thông tin kinh tế";
        const topicLower = queryStr.toLowerCase();
        const nowIso = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });

        // 1. Foreign exchange rates
        if (topicLower.includes("rate") || topicLower.includes("tỷ giá") || topicLower.includes("ngoại tệ") || topicLower.includes("usd")) {
          try {
            const { getExchangeRates } = await import("./exchange-rate.service.ts");
            const ratesData = await getExchangeRates();
            const usdRate = ratesData.rates?.USD ? Math.round(1 / ratesData.rates.USD) : 25450;
            const lines = [
              `THÔNG TIN TỶ GIÁ NGOẠI TỆ THỜI GIAN THỰC (Cập nhật: ${nowIso} UTC+7):`,
              `- Nguồn kiểm chứng: ${ratesData.source || "Hệ thống tỷ giá chính thức"}`,
              `- Tỷ giá tham chiếu USD/VND: 1 USD ≈ ${usdRate.toLocaleString("vi-VN")} VND`,
              `- Tỷ giá tham chiếu VND/USD: 1.000.000 VND ≈ ${(1000000 / usdRate).toFixed(2)} USD`,
              `- Phạm vi quy đổi: Hệ thống chỉ hỗ trợ chuyển đổi qua lại giữa Tiền Việt (VND) và Tiền Đô (USD).`,
              `- Thời điểm cập nhật: ${new Date(ratesData.timestamp).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}`,
            ];
            return {
              toolName,
              success: true,
              data: ratesData,
              summaryVi: lines.join("\n"),
            };
          } catch {
            // fallback below
          }
        }

        // 2. Billionaires / Richest Person / Wealth rankings
        if (
          topicLower.includes("giàu nhất") ||
          topicLower.includes("tài sản của") ||
          topicLower.includes("tỷ phú") ||
          topicLower.includes("billionaire") ||
          topicLower.includes("elon musk") ||
          topicLower.includes("richest")
        ) {
          try {
            const { getVerifiedBillionaireWealthInfo } = await import("./web-search.service.ts");
            const wealthInfo = await getVerifiedBillionaireWealthInfo(queryStr);
            return {
              toolName,
              success: true,
              data: wealthInfo,
              summaryVi: wealthInfo.summaryVi,
            };
          } catch {
            // fallback below
          }
        }

        // 3. Live Web Search for news & economic events (when explicit search query or live flag is provided)
        if (args.query || args.live) {
          try {
            const { performLiveWebSearch } = await import("./web-search.service.ts");
            const searchResult = await performLiveWebSearch(queryStr, 4, 5000);
            if (searchResult.success && searchResult.items.length > 0) {
              const lines = [
                `KẾT QUẢ TÌM KIẾM THỜI GIAN THỰC (Cập nhật: ${searchResult.asOf} UTC+7):`,
                `- Nguồn tìm kiếm: ${searchResult.source}`,
                `- Truy vấn: "${queryStr}"`,
                ...searchResult.items.map(
                  (item) => `- [${item.source}]: ${item.snippet} (${item.link})`,
                ),
                "\nQUY TẮC BẮT BUỘC: Trả lời trung thực dựa trên các nguồn tìm kiếm trên, trích dẫn nguồn uy tín và thời điểm kiểm chứng. Không tự bịa đặt tin tức.",
              ];
              return {
                toolName,
                success: true,
                data: searchResult,
                summaryVi: lines.join("\n"),
              };
            }
          } catch {
            // fallback below
          }
        }

        const lines = [
          `THÔNG TIN THỜI GIAN THỰC (Thời điểm kiểm tra: ${nowIso} UTC+7):`,
          `- Trạng thái: Hệ thống hiện chưa kết nối trực tiếp đến công cụ tìm kiếm tin tức Internet tự động thời gian thực.`,
          `- Nguyên tắc minh bạch: Trợ lý AI KHÔNG tự bịa đặt sự kiện, tin tức hay số liệu thị trường hôm nay.`,
          `- Khuyến nghị: Bạn có thể cập nhật diễn biến kinh tế và giá cả mới nhất trong ngày trên các kênh thông tin tài chính uy tín như VnExpress Kinh Doanh, Báo Đầu Tư, CafeF hoặc Vietstock.`,
        ];

        return {
          toolName,
          success: true,
          data: { topic: queryStr, timestamp: nowIso, searchConfigured: false },
          summaryVi: lines.join("\n"),
        };
      }

      case "get_wallets": {
        const walletRes = await executeFinancialTool(
          "get_wallet_balances",
          { focus: "TOTAL_ASSETS" },
          ctx,
        );
        return {
          toolName,
          success: walletRes.success,
          data: walletRes.data,
          summaryVi: walletRes.summaryVi,
        };
      }

      case "get_wallet_balance": {
        const walletQuery =
          typeof args.wallet_name === "string"
            ? args.wallet_name
            : typeof args.wallet_query === "string"
              ? args.wallet_query
              : undefined;
        const walletRes = await executeFinancialTool(
          "get_wallet_balances",
          {
            ...args,
            wallet_query: walletQuery,
          },
          ctx,
        );
        return {
          toolName,
          success: walletRes.success,
          data: walletRes.data,
          summaryVi: walletRes.summaryVi,
        };
      }

      case "list_transactions": {
        try {
          const timeBounds = getVietnamTimeBounds();
          const limitCount = Math.min(50, Math.max(1, Number(args.limit) || 15));
          let startIso: string | undefined;
          let endIso: string | undefined;
          let periodLabel = timeBounds.currentMonthLabel;

          const period = typeof args.period === "string" ? args.period : "current_month";

          if (period === "previous_month") {
            startIso = timeBounds.previousStartIso;
            endIso = timeBounds.previousEndIso;
            periodLabel = timeBounds.previousMonthLabel;
          } else if (period === "all") {
            startIso = undefined;
            endIso = undefined;
            periodLabel = "Toàn bộ lịch sử";
          } else if (period === "custom") {
            if (args.start_date && args.end_date) {
              const parsedRange = parseCustomDateRangeVn(String(args.start_date), String(args.end_date));
              startIso = parsedRange.startIso;
              endIso = parsedRange.endIso;
              periodLabel = parsedRange.label;
            } else if (args.month) {
              const y = Number(args.year) || timeBounds.year;
              const m = Number(args.month);
              const parsedMonth = parseMonthRangeVn(y, m);
              startIso = parsedMonth.startIso;
              endIso = parsedMonth.endIso;
              periodLabel = parsedMonth.label;
            } else {
              startIso = timeBounds.currentStartIso;
              endIso = timeBounds.currentEndIso;
              periodLabel = timeBounds.currentMonthLabel;
            }
          } else {
            startIso = timeBounds.currentStartIso;
            endIso = timeBounds.currentEndIso;
            periodLabel = timeBounds.currentMonthLabel;
          }

          let txQuery = client
            .from("transactions")
            .select("id, title, amount, type, category, occurred_at, wallet_id, note")
            .eq("user_id", ctx.userId);

          if (startIso && endIso) {
            txQuery = txQuery.gte("occurred_at", startIso).lt("occurred_at", endIso);
          }

          if (typeof args.type === "string" && ["income", "expense", "transfer"].includes(args.type)) {
            txQuery = txQuery.eq("type", args.type);
          }

          if (typeof args.category === "string" && args.category.trim()) {
            txQuery = txQuery.ilike("category", `%${args.category.trim()}%`);
          }

          if (args.min_amount != null && !isNaN(Number(args.min_amount))) {
            txQuery = txQuery.gte("amount", Number(args.min_amount));
          }

          if (args.max_amount != null && !isNaN(Number(args.max_amount))) {
            txQuery = txQuery.lte("amount", Number(args.max_amount));
          }

          txQuery = txQuery.order("occurred_at", { ascending: false }).limit(limitCount);

          const [txRes, walletsRes] = await Promise.all([
            txQuery,
            client.from("wallets").select("id, name, currency").eq("user_id", ctx.userId),
          ]);

          if (txRes.error) throw txRes.error;

          const walletNameMap = new Map<string, { name: string; currency: string }>();
          if (walletsRes.data) {
            for (const w of walletsRes.data) {
              walletNameMap.set(w.id, { name: w.name, currency: w.currency || "VND" });
            }
          }

          const txList = txRes.data || [];
          let totalExpenseInList = 0;
          let totalIncomeInList = 0;

          const lines: string[] = [
            `### 📋 DANH SÁCH GIAO DỊCH (${periodLabel} - Hiển thị ${txList.length} giao dịch):`,
          ];

          if (txList.length === 0) {
            lines.push(`- Không tìm thấy giao dịch nào phù hợp với điều kiện tìm kiếm trong kỳ ${periodLabel}.`);
          } else {
            for (const t of txList) {
              const wInfo = t.wallet_id ? walletNameMap.get(t.wallet_id) : undefined;
              const wName = wInfo?.name || "Ví chính";
              const cur = wInfo?.currency || "VND";
              const amt = Number(t.amount) || 0;
              const dateStr = t.occurred_at ? t.occurred_at.split("T")[0] : "";
              const typeStr = t.type === "income" ? "[Thu]" : t.type === "expense" ? "[Chi]" : "[Chuyển]";

              if (t.type === "expense") totalExpenseInList += amt;
              if (t.type === "income") totalIncomeInList += amt;

              lines.push(
                `- **${dateStr}** | **${typeStr}** ${t.title}: **${amt.toLocaleString("vi-VN")} ${cur}** (Danh mục: ${t.category || "Khác"} | Ví: ${wName})${t.note ? ` - *${t.note}*` : ""}`
              );
            }

            lines.push("");
            lines.push(
              `- **Tổng kết các giao dịch trong danh sách:** Tổng chi: **${totalExpenseInList.toLocaleString("vi-VN")} VND** | Tổng thu: **${totalIncomeInList.toLocaleString("vi-VN")} VND**.`
            );
          }

          return {
            toolName,
            success: true,
            data: {
              transactions: txList,
              totalCount: txList.length,
              period: periodLabel,
              totalExpense: totalExpenseInList,
              totalIncome: totalIncomeInList,
            },
            summaryVi: lines.join("\n"),
          };
        } catch (err: unknown) {
          return {
            toolName,
            success: false,
            data: null,
            summaryVi: `LỖI TRUY VẤN DANH SÁCH GIAO DỊCH: Không thể kết nối hoặc tải dữ liệu giao dịch từ cơ sở dữ liệu (${err instanceof Error ? err.message : String(err)}). TUYỆT ĐỐI KHÔNG tự bịa đặt danh sách giao dịch.`,
          };
        }
      }

      case "get_financial_summary": {
        const [walletRes, spendRes] = await Promise.all([
          executeFinancialTool("get_wallet_balances", {}, ctx),
          executeFinancialTool("get_spending_analysis", { period: args.period || "current" }, ctx),
        ]);

        const lines: string[] = [
          "### 📊 BÁO CÁO TỔNG QUAN TÀI CHÍNH CÁ NHÂN:",
          walletRes.summaryVi,
          "",
          spendRes.summaryVi,
        ];

        return {
          toolName,
          success: walletRes.success && spendRes.success,
          data: {
            wallets: walletRes.data,
            spending: spendRes.data,
          },
          summaryVi: lines.join("\n"),
        };
      }

      case "get_budgets": {
        const budgetRes = await executeFinancialTool("get_budget_status", args, ctx);
        return {
          toolName,
          success: budgetRes.success,
          data: budgetRes.data,
          summaryVi: budgetRes.summaryVi,
        };
      }

      case "get_categories": {
        try {
          const typeFilter = typeof args.type === "string" ? args.type.trim().toLowerCase() : undefined;
          let catQuery = client
            .from("categories")
            .select("id, name, kind, icon, color, is_default")
            .eq("user_id", ctx.userId);

          if (typeFilter && (typeFilter === "income" || typeFilter === "expense")) {
            catQuery = catQuery.eq("kind", typeFilter);
          }

          const { data: cats, error } = await catQuery;
          if (error) throw error;

          const catList = cats || [];
          const expenseCats = catList.filter((c: { kind: string }) => c.kind === "expense").map((c: { name: string }) => c.name);
          const incomeCats = catList.filter((c: { kind: string }) => c.kind === "income").map((c: { name: string }) => c.name);

          const defaultExpense = ["Ăn uống", "Nhà ở", "Mua sắm", "Di chuyển", "Hóa đơn & Tiện ích", "Giáo dục", "Giải trí", "Sức khỏe", "Khác"];
          const defaultIncome = ["Lương", "Thưởng", "Đầu tư", "Bán đồ cũ", "Thu nhập khác"];

          const finalExpense = expenseCats.length > 0 ? expenseCats : defaultExpense;
          const finalIncome = incomeCats.length > 0 ? incomeCats : defaultIncome;

          const lines: string[] = ["### 🏷️ DANH MỤC THU & CHI TRONG HỆ THỐNG:"];
          if (!typeFilter || typeFilter === "expense") {
            lines.push(`- **Danh mục Chi tiêu (${finalExpense.length} mục):** ${finalExpense.join(", ")}`);
          }
          if (!typeFilter || typeFilter === "income") {
            lines.push(`- **Danh mục Thu nhập (${finalIncome.length} mục):** ${finalIncome.join(", ")}`);
          }

          return {
            toolName,
            success: true,
            data: {
              expenseCategories: finalExpense,
              incomeCategories: finalIncome,
              userCategoryCount: catList.length,
            },
            summaryVi: lines.join("\n"),
          };
        } catch (err: unknown) {
          return {
            toolName,
            success: false,
            data: null,
            summaryVi: `LỖI TRUY VẤN DANH MỤC: Không thể tải danh mục từ cơ sở dữ liệu (${err instanceof Error ? err.message : String(err)}).`,
          };
        }
      }

      case "get_system_capabilities": {
        const { SYSTEM_FEATURES } = await import("./system-knowledge-base.ts");
        const featureId = typeof args.feature_id === "string" ? args.feature_id.trim() : undefined;

        if (featureId && SYSTEM_FEATURES[featureId]) {
          const f = SYSTEM_FEATURES[featureId];
          const lines = [
            `### 🌟 NĂNG LỰC TÍNH NĂNG: ${f.name} [Trạng thái: ${f.status}]`,
            `- **Mục đích:** ${f.purpose}`,
            `- **Vị trí UI:** ${f.uiLocation}`,
            `- **Quy trình sử dụng:**`,
            ...f.workflow.map((w: string) => `  ${w}`),
            `- **Quy tắc nghiệp vụ:**`,
            ...f.businessRules.map((b: string) => `  * ${b}`),
            `- **Giới hạn & Lưu ý:**`,
            ...f.limitations.map((l: string) => `  * ${l}`),
          ];
          return {
            toolName,
            success: true,
            data: f,
            summaryVi: lines.join("\n"),
          };
        }

        const lines = [
          "### 🌟 TỔNG HỢP DANH MỤC CHỨC NĂNG HỆ THỐNG SỔ CHI TIÊU:",
          "Hệ thống Sổ Chi Tiêu đã triển khai đầy đủ các chức năng quản lý tài chính cá nhân sau:",
        ];

        for (const f of Object.values(SYSTEM_FEATURES)) {
          lines.push(`- **${f.name}** [${f.status}]: ${f.purpose} (Vị trí: ${f.uiLocation})`);
        }

        return {
          toolName,
          success: true,
          data: {
            features: Object.values(SYSTEM_FEATURES).map((f) => ({
              id: f.id,
              name: f.name,
              status: f.status,
              uiLocation: f.uiLocation,
            })),
          },
          summaryVi: lines.join("\n"),
        };
      }

      case "get_feature_instructions": {
        const { SYSTEM_FEATURES } = await import("./system-knowledge-base.ts");
        const rawParam =
          typeof args.feature_query === "string" && args.feature_query.trim()
            ? args.feature_query.trim()
            : typeof args.feature_id === "string" && args.feature_id.trim()
              ? args.feature_id.trim()
              : "";
        const query = rawParam.toLowerCase();
        const queryNorm = normalizeVietnamese(query);

        let matchedFeature = SYSTEM_FEATURES[query] || (query ? Object.values(SYSTEM_FEATURES).find((f) => {
          const nameNorm = normalizeVietnamese(f.name);
          const idNorm = f.id.toLowerCase();
          return (
            f.id === query ||
            nameNorm.includes(queryNorm) ||
            queryNorm.includes(idNorm) ||
            f.keywords.some((k: string) => queryNorm.includes(normalizeVietnamese(k)))
          );
        }) : undefined);

        if (!matchedFeature) {
          if (queryNorm.includes("excel") || queryNorm.includes("csv") || queryNorm.includes("sao ke")) {
            matchedFeature = queryNorm.includes("xuat") ? SYSTEM_FEATURES["excel_export"] : SYSTEM_FEATURES["excel_csv_import"];
          } else if (queryNorm.includes("giao dich") || queryNorm.includes("chi tieu") || queryNorm.includes("thu nhap")) {
            matchedFeature = SYSTEM_FEATURES["transactions"];
          } else if (queryNorm.includes("vi") || queryNorm.includes("so du") || queryNorm.includes("wallet")) {
            matchedFeature = SYSTEM_FEATURES["wallets"];
          } else if (queryNorm.includes("ngan sach") || queryNorm.includes("budget")) {
            matchedFeature = SYSTEM_FEATURES["budgets_tracking"];
          } else if (queryNorm.includes("tiet kiem") || queryNorm.includes("savings")) {
            matchedFeature = SYSTEM_FEATURES["savings_goals"];
          } else if (queryNorm.includes("hoa don") || queryNorm.includes("ocr")) {
            matchedFeature = SYSTEM_FEATURES["receipt_ocr"];
          } else {
            matchedFeature = SYSTEM_FEATURES["system_overview"];
          }
        }

        const lines = [
          `### 📖 HƯỚNG DẪN THAO TÁC: ${matchedFeature.name}`,
          `- **Trạng thái thực tế:** ${matchedFeature.status}`,
          `- **Vị trí trên giao diện:** ${matchedFeature.uiLocation}`,
          `- **Quy trình các bước thực hiện:**`,
          ...matchedFeature.workflow.map((w: string) => `  ${w}`),
          `- **Ràng buộc & Quy tắc:**`,
          ...matchedFeature.businessRules.slice(0, 3).map((r: string) => `  * ${r}`),
        ];

        return {
          toolName,
          success: true,
          data: matchedFeature,
          summaryVi: lines.join("\n"),
        };
      }

      case "create_category":
      case "create_budget":
      case "create_transaction":
      case "create_recurring_transaction": {
        const crudType = toolName as CrudActionType;
        if (args.confirmed === true && args.payload && typeof args.payload === "object") {
          const execRes = await executeConfirmedCrudAction(ctx, {
            actionId: typeof args.action_id === "string" ? args.action_id : undefined,
            idempotencyKey:
              typeof args.idempotency_key === "string" && args.idempotency_key
                ? args.idempotency_key
                : `tool_${crudType}_${Date.now()}`,
            actionType: crudType,
            payload: args.payload as Record<string, unknown>,
          });
          return {
            toolName,
            success: execRes.success,
            data: execRes.executedAction ?? null,
            summaryVi: execRes.reply,
          };
        }

        const rawPrompt =
          typeof args.raw_message === "string" && args.raw_message.trim()
            ? args.raw_message.trim()
            : JSON.stringify(args);

        const orchestrated = await handleChatCrudIntent(
          { kind: "CRUD_CREATE", actionType: crudType },
          rawPrompt,
          [],
          ctx,
          { function: { name: crudType, arguments: args } },
        );

        return {
          toolName,
          success: !orchestrated.error,
          data: orchestrated.executedAction ?? orchestrated.pendingAction ?? null,
          summaryVi: orchestrated.reply,
        };
      }

      default:
        throw new Error(`Tool "${toolName}" không được hỗ trợ.`);
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      toolName,
      success: false,
      data: null,
      summaryVi: `⚠️ LỖI TRUY VẤN DỮ LIỆU TÀI CHÍNH: Không thể kết nối hoặc truy vấn dữ liệu từ cơ sở dữ liệu (${errMsg}). Dữ liệu tài chính hiện không khả dụng. BẮT BUỘC: Bạn phải thông báo cho người dùng rằng dữ liệu tài chính tạm thời không khả dụng do lỗi kết nối hệ thống. TUYỆT ĐỐI KHÔNG mặc định số dư bằng 0 VND hoặc suy đoán số liệu giả mạo.`,
    };
  }
}
