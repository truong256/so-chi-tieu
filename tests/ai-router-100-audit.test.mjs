/**
 * tests/ai-router-100-audit.test.mjs
 * ===================================
 * Complete Verification Test Suite for AI Chatbot Audit & Intent Router Upgrade:
 * 1. 6 Canonical Intent Groups:
 *    - PERSONAL_FINANCE
 *    - FINANCIAL_ADVICE
 *    - SYSTEM_KNOWLEDGE
 *    - GENERAL_KNOWLEDGE
 *    - REALTIME_INFORMATION
 *    - GENERAL_CHAT
 * 2. Multi-intent queries (e.g. General Knowledge + Personal Finance)
 * 3. Multi-turn conversational memory (e.g. "Với số tiền đó, tôi nên tiết kiệm bao nhiêu?")
 * 4. Context Isolation (General questions NEVER receive or dump user personal finance)
 * 5. Realtime Tool & Transparency (Honest limitation disclosure, live exchange rates)
 * 6. System Error Resilience & Safety Guardrails (Never default to 0đ, Read-Only enforcement)
 * 7. Typo & Diacritic tolerance in Vietnamese
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  routeUserIntent,
  removeVietnameseAccents,
} from "../backend/src/services/ai-router.service.ts";

import {
  buildDynamicSystemPrompt,
  FINANCE_SYSTEM_PROMPT,
  isObviouslyOffTopic,
} from "../backend/src/services/ai-chat.service.ts";

import {
  executeFinancialTool,
  FINANCIAL_TOOLS,
} from "../backend/src/services/financial-tools.service.ts";

import {
  formatServerFinancialContextForPrompt,
} from "../backend/src/services/financial-context.service.ts";

function createMockSupabaseClient(fixtures) {
  return {
    from(table) {
      return {
        select() {
          const state = { table, filters: [], orderField: null, limitCount: null };
          const builder = {
            eq(col, val) {
              state.filters.push({ col, op: "eq", val });
              return builder;
            },
            gte(col, val) {
              state.filters.push({ col, op: "gte", val });
              return builder;
            },
            lt(col, val) {
              state.filters.push({ col, op: "lt", val });
              return builder;
            },
            ilike(col, val) {
              state.filters.push({ col, op: "ilike", val });
              return builder;
            },
            order(col, opts) {
              state.orderField = { col, opts };
              return builder;
            },
            limit(count) {
              state.limitCount = count;
              return builder;
            },
            async then(resolve) {
              const allRows = fixtures[table] || [];
              const filtered = allRows.filter((row) => {
                for (const f of state.filters) {
                  if (f.op === "eq" && row[f.col] !== f.val) return false;
                  if (f.op === "gte" && row[f.col] < f.val) return false;
                  if (f.op === "lt" && row[f.col] >= f.val) return false;
                  if (f.op === "ilike" && !String(row[f.col] || "").toLowerCase().includes(String(f.val).replace(/%/g, "").toLowerCase())) return false;
                }
                return true;
              });
              return resolve({ data: filtered, error: null });
            },
          };
          return builder;
        },
      };
    },
  };
}

// Helper mock tool context
function createMockToolContext(customData = {}) {
  const wallets = customData.wallets || [
    { id: "w-cash", user_id: "u-1", name: "Ví tiền mặt", type: "cash", balance: 645000, currency: "VND", reserved_amount: 345000 },
    { id: "w-bank", user_id: "u-1", name: "Ví ngân hàng", type: "bank", balance: 335000, currency: "VND", reserved_amount: 300000 },
  ];
  const transactions = customData.transactions || [
    { id: "t-1", user_id: "u-1", wallet_id: "w-cash", amount: 1500000, type: "expense", category: "Nhà ở", date: "2026-10-05T08:00:00Z" },
    { id: "t-2", user_id: "u-1", wallet_id: "w-bank", amount: 2650000, type: "expense", category: "Ăn uống", date: "2026-10-12T12:00:00Z" },
    { id: "t-3", user_id: "u-1", wallet_id: "w-cash", amount: 700000, type: "expense", category: "Mua sắm", date: "2026-10-15T18:00:00Z" },
  ];
  const budgets = customData.budgets || [
    { id: "b-cash-dining", user_id: "u-1", name: "Ngân sách Ăn uống", amount: 400000, allocated_amount: 345000, remaining_amount: 345000, status: "active", source_wallet_id: "w-cash", category_id: "cat-dining" },
    { id: "b-bank-bills", user_id: "u-1", name: "Ngân sách Hóa đơn", amount: 300000, allocated_amount: 300000, remaining_amount: 300000, status: "active", source_wallet_id: "w-bank", category_id: "cat-bills" },
  ];
  const goals = customData.goals || [
    { id: "g-1", user_id: "u-1", name: "Mua laptop", target_amount: 25000000, current_amount: 5000000, currency: "VND", target_date: "2026-12-31" },
  ];
  const categories = customData.categories || [
    { id: "cat-dining", user_id: "u-1", name: "Ăn uống" },
    { id: "cat-bills", user_id: "u-1", name: "Hóa đơn" },
  ];

  const fixtures = { wallets, transactions, budgets, savings_goals: goals, categories };

  return {
    supabaseUrl: "https://mock.supabase.co",
    supabaseKey: "mock-key",
    token: "mock-token",
    userId: "u-1",
    client: createMockSupabaseClient(fixtures),
  };
}

// ============================================================================
// Group 1: Intent Router Verification across 6 Canonical Categories
// ============================================================================

test("Router 1: 'Người giàu nhất thế giới hiện nay là ai?' -> GENERAL_KNOWLEDGE", () => {
  const res = routeUserIntent("Người giàu nhất thế giới hiện nay là ai?");
  assert.equal(res.primaryIntent, "GENERAL_KNOWLEDGE");
  assert.equal(res.requiresPersonalData, false);
  assert.equal(res.requiresFinancialAnalysis, false);
  assert.equal(res.requiresSystemRag, false);
});

test("Router 2: 'Ngân sách là gì?' -> GENERAL_KNOWLEDGE (without dumping user balance)", () => {
  const res = routeUserIntent("Ngân sách là gì?");
  assert.equal(res.primaryIntent, "GENERAL_KNOWLEDGE");
  assert.equal(res.requiresPersonalData, false);
});

test("Router 3: 'Lạm phát là gì và tại sao tiền mất giá?' -> GENERAL_KNOWLEDGE", () => {
  const res = routeUserIntent("Lạm phát là gì và tại sao tiền mất giá?");
  assert.equal(res.primaryIntent, "GENERAL_KNOWLEDGE");
  assert.equal(res.requiresPersonalData, false);
});

test("Router 4: 'Tôi có bao nhiêu tiền?' -> PERSONAL_FINANCE", () => {
  const res = routeUserIntent("Tôi có bao nhiêu tiền?");
  assert.equal(res.primaryIntent, "PERSONAL_FINANCE");
  assert.equal(res.category, "USER_FINANCIAL_DATA");
  assert.equal(res.requiresPersonalData, true);
});

test("Router 5: 'Tôi đã tiêu bao nhiêu trong tháng?' -> PERSONAL_FINANCE (SPENDING_ANALYSIS)", () => {
  const res = routeUserIntent("Tôi đã tiêu bao nhiêu trong tháng?");
  assert.equal(res.primaryIntent, "PERSONAL_FINANCE");
  assert.equal(res.category, "SPENDING_ANALYSIS");
  assert.equal(res.requiresPersonalData, true);
});

test("Router 6: 'Tôi nên làm gì với số tiền còn lại?' -> FINANCIAL_ADVICE", () => {
  const res = routeUserIntent("Tôi nên làm gì với số tiền còn lại?");
  assert.equal(res.primaryIntent, "FINANCIAL_ADVICE");
  assert.equal(res.category, "GENERAL_FINANCIAL_ADVICE");
  assert.equal(res.requiresFinancialAnalysis, true);
  assert.equal(res.requiresPersonalData, true);
});

test("Router 7: 'Tôi có đủ tiền mua điện thoại không?' -> FINANCIAL_ADVICE (AFFORDABILITY_WHATIF)", () => {
  const res = routeUserIntent("Tôi có đủ tiền mua điện thoại không?");
  assert.equal(res.primaryIntent, "FINANCIAL_ADVICE");
  assert.equal(res.category, "AFFORDABILITY_WHATIF");
  assert.equal(res.requiresFinancialAnalysis, true);
  assert.equal(res.requiresPersonalData, true);
});

test("Router 8: 'Hệ thống Sổ Chi Tiêu có chức năng gì?' -> SYSTEM_KNOWLEDGE", () => {
  const res = routeUserIntent("Hệ thống Sổ Chi Tiêu có chức năng gì?");
  assert.equal(res.primaryIntent, "SYSTEM_KNOWLEDGE");
  assert.equal(res.category, "SYSTEM_KNOWLEDGE");
  assert.equal(res.requiresSystemRag, true);
  assert.equal(res.requiresPersonalData, false);
});

test("Router 9: 'Xin chào, bạn có thể giúp gì?' -> GENERAL_CHAT", () => {
  const res = routeUserIntent("Xin chào, bạn có thể giúp gì?");
  assert.equal(res.primaryIntent, "GENERAL_CHAT");
  assert.equal(res.requiresPersonalData, false);
  assert.equal(res.requiresFinancialAnalysis, false);
});

test("Router 10: 'Hôm nay có tin tức kinh tế nổi bật nào?' -> REALTIME_INFORMATION", () => {
  const res = routeUserIntent("Hôm nay có tin tức kinh tế nổi bật nào?");
  assert.equal(res.primaryIntent, "REALTIME_INFORMATION");
  assert.equal(res.requiresRealtimeSearch, true);
  assert.equal(res.requiresPersonalData, false);
});

// ============================================================================
// Group 2: Multi-Intent and Multi-turn Follow-up
// ============================================================================

test("Router 11: Multi-intent 'Người giàu nhất thế giới là ai và tôi có bao nhiêu tiền?'", () => {
  const res = routeUserIntent("Người giàu nhất thế giới là ai và tôi có bao nhiêu tiền?");
  assert.ok(res.intents.includes("GENERAL_KNOWLEDGE"));
  assert.ok(res.intents.includes("PERSONAL_FINANCE"));
  assert.equal(res.requiresPersonalData, true);
});

test("Router 12: Multi-turn follow-up 'Với số tiền đó, tôi nên tiết kiệm bao nhiêu?' inherits referenced amount", () => {
  const history = [
    { role: "user", parts: [{ text: "Tôi có bao nhiêu tiền?" }] },
    {
      role: "assistant",
      parts: [
        {
          text: "Tổng tài sản của bạn là 980.000 VND, số dư khả dụng hiện tại là 335.000 VND.",
        },
      ],
    },
  ];
  const res = routeUserIntent("Với số tiền đó, tôi nên tiết kiệm bao nhiêu?", history);
  assert.equal(res.primaryIntent, "FINANCIAL_ADVICE");
  assert.equal(res.requiresFinancialAnalysis, true);
  assert.ok(res.multiTurnContext);
  assert.equal(res.multiTurnContext.referencedAmount, 335000);
});

// ============================================================================
// Group 3: Context Isolation & Persona Prompts
// ============================================================================

test("Isolation 13: General knowledge prompt strictly isolates user data", () => {
  const routing = routeUserIntent("Người giàu nhất thế giới hiện nay là ai?");
  const prompt = buildDynamicSystemPrompt(routing);
  assert.match(prompt, /Giải đáp các thắc mắc về kiến thức kinh tế, tài chính tổng quát/);
  assert.match(prompt, /TUYỆT ĐỐI KHÔNG tự động hiển thị số dư, thu chi, ví tiền hay báo cáo tài chính cá nhân/);
});

test("Isolation 14: System knowledge prompt guides feature walkthrough without personal balance", () => {
  const routing = routeUserIntent("Hệ thống Sổ Chi Tiêu có chức năng gì?");
  const prompt = buildDynamicSystemPrompt(routing);
  assert.match(prompt, /Trợ lý hướng dẫn sử dụng hệ thống "Sổ Chi Tiêu"/);
  assert.match(prompt, /TUYỆT ĐỐI KHÔNG in số dư hay báo cáo tài chính cá nhân/);
});

test("Isolation 15: General chat prompt greets politely without dumping balances", () => {
  const routing = routeUserIntent("Xin chào, bạn có thể giúp gì?");
  const prompt = buildDynamicSystemPrompt(routing);
  assert.match(prompt, /Trợ lý AI thân thiện của hệ thống "Sổ Chi Tiêu"/);
  assert.match(prompt, /TUYỆT ĐỐI KHÔNG tự động in bảng báo cáo tài chính cá nhân/);
});

test("Isolation 16: Multi-intent prompt directs AI to answer BOTH parts clearly", () => {
  const routing = routeUserIntent("Người giàu nhất thế giới là ai và tôi có bao nhiêu tiền?");
  const prompt = buildDynamicSystemPrompt(routing);
  assert.match(prompt, /HƯỚNG DẪN CÂU HỎI KẾT HỢP NHIỀU Ý ĐỊNH/);
  assert.match(prompt, /Bạn phải trả lời ĐẦY ĐỦ CẢ HAI PHẦN/);
});

// ============================================================================
// Group 4: Realtime Information Tool & Web Search Transparency
// ============================================================================

test("Realtime 17: get_realtime_information tool is registered in FINANCIAL_TOOLS", () => {
  const tool = FINANCIAL_TOOLS.find((t) => t.function.name === "get_realtime_information");
  assert.ok(tool, "Tool get_realtime_information must be defined in FINANCIAL_TOOLS schema");
  assert.match(tool.function.description, /thời gian thực/);
});

test("Realtime 18: get_realtime_information returns live exchange rates with verifiable source", async () => {
  const ctx = createMockToolContext();
  const res = await executeFinancialTool("get_realtime_information", { topic: "tỷ giá USD" }, ctx);
  assert.ok(res.success);
  assert.match(res.summaryVi, /USD/i);
  assert.match(res.summaryVi, /VND/);
  assert.match(res.summaryVi, /Nguồn kiểm chứng/);
});

test("Realtime 19: get_realtime_information transparently states limitation if web search API is unconfigured", async () => {
  const ctx = createMockToolContext();
  const res = await executeFinancialTool("get_realtime_information", { topic: "tin tức kinh tế" }, ctx);
  assert.ok(res.success);
  assert.match(res.summaryVi, /Hệ thống hiện chưa kết nối trực tiếp đến công cụ tìm kiếm tin tức Internet/);
  assert.match(res.summaryVi, /Trợ lý AI KHÔNG tự bịa đặt sự kiện, tin tức/);
});

// ============================================================================
// Group 5: Core Financial Reporting Accuracy
// ============================================================================

test("Financial 20: 'Tôi có bao nhiêu tiền?' calculates 980k assets, 645k allocated, 335k available", async () => {
  const ctx = createMockToolContext({ transactions: [] });
  const res = await executeFinancialTool("get_wallet_balances", {}, ctx);
  assert.ok(res.success);
  assert.match(res.summaryVi, /980\.000 VND/); // Total assets
  assert.match(res.summaryVi, /645\.000 VND/); // Allocated
  assert.match(res.summaryVi, /335\.000 VND/); // Available
  assert.match(res.summaryVi, /Ví tiền mặt.*645\.000 VND/);
  assert.match(res.summaryVi, /Ví ngân hàng.*335\.000 VND/);
});

test("Financial 21: 'Tôi đã tiêu bao nhiêu trong tháng?' computes 4.850.000 VND correctly", async () => {
  const ctx = createMockToolContext();
  const res = await executeFinancialTool("get_spending_analysis", {}, ctx);
  assert.ok(res.success);
  assert.match(res.summaryVi, /4\.850\.000 VND/);
});

test("Financial 22: 'Tôi có 200k ăn sáng trong 7 ngày, nên ăn gì?' calculates ~28.571 VND/day", async () => {
  const ctx = createMockToolContext();
  const res = await executeFinancialTool(
    "evaluate_purchase_affordability",
    { item_name: "ăn sáng trong 7 ngày", price: 200000, category: "ăn uống", days: 7 },
    ctx,
  );
  assert.ok(res.success);
  assert.match(res.summaryVi, /28\.571 VND\/ngày/);
  assert.match(res.summaryVi, /Bánh mì/);
  assert.match(res.summaryVi, /Xôi/);
});

// ============================================================================
// Group 6: Diacritic, Typo Tolerance & Safety Guardrails
// ============================================================================

test("Tolerance 23: Unaccented Vietnamese text correctly routes to appropriate intents", () => {
  assert.equal(removeVietnameseAccents("Người giàu nhất thế giới"), "nguoi giau nhat the gioi");
  assert.equal(isObviouslyOffTopic("Viết code Python thuật toán Dijkstra"), true);
  assert.equal(isObviouslyOffTopic("Người giàu nhất thế giới hiện nay là ai?"), false);
  assert.equal(routeUserIntent("nguoi giau nhat the gioi").primaryIntent, "GENERAL_KNOWLEDGE");
  assert.equal(routeUserIntent("toi co bao nhieu tien").primaryIntent, "PERSONAL_FINANCE");
  assert.equal(routeUserIntent("toi da chi bao nhieu").primaryIntent, "PERSONAL_FINANCE");
  assert.equal(routeUserIntent("ngan sach la gi").primaryIntent, "GENERAL_KNOWLEDGE");
  assert.equal(routeUserIntent("xin chao ban co the giup gi").primaryIntent, "GENERAL_CHAT");
});

test("Guardrail 24: Database connection failure does NOT default balance to 0 VND or say user is broke", () => {
  const mockErrorContext = {
    asOf: new Date().toISOString(),
    currency: "VND",
    balancesByCurrency: {},
    totalIncome: 0,
    totalExpense: 0,
    categoryBreakdown: [],
    previousMonthComparison: { incomeDelta: 0, expenseDelta: 0, netSavingsDelta: 0 },
    budgetAlerts: [],
    recentTransactions: [],
    wallets: [],
    savingsGoals: [],
    databaseError: "Supabase connection timed out after 5000ms",
  };

  const formatted = formatServerFinancialContextForPrompt(mockErrorContext, "Dashboard", "Tôi có bao nhiêu tiền?");
  assert.match(formatted, /LỖI TRUY VẤN CƠ SỞ DỮ LIỆU/);
  assert.match(formatted, /KHÔNG ĐƯỢC thông báo người dùng chi tiêu 0đ/);
  assert.match(formatted, /hết tiền/);
});

test("Guardrail 25: Prompt injection and write attempts are strictly rejected as Read-Only", () => {
  assert.match(FINANCE_SYSTEM_PROMPT, /Bạn chỉ có quyền ĐỌC dữ liệu và TƯ VẤN \(Read-Only\)/);
  assert.match(FINANCE_SYSTEM_PROMPT, /Không được tự ý xóa, sửa hoặc tạo giao dịch/);
  assert.match(FINANCE_SYSTEM_PROMPT, /Không để lộ token, mật khẩu, khóa bí mật/);
});
