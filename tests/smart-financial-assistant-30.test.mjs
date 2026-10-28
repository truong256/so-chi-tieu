/**
 * tests/smart-financial-assistant-30.test.mjs
 * ===========================================
 * Comprehensive 33-Scenario Test Suite for Smart Financial Assistant:
 * - Deterministic Financial Tool Calling Engine
 * - Query Classification
 * - Multi-turn Conversational Context
 * - Balance, Spending, Budget, Savings, What-If, Advice, Security & Guardrails
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyFinancialQuery,
  parsePurchaseQuery,
  executeFinancialTool,
} from "../backend/src/services/financial-tools.service.ts";

import {
  extractToolCallsFromContent,
  isObviouslyOffTopic,
  FINANCE_SYSTEM_PROMPT,
} from "../backend/src/services/ai-chat.service.ts";

function buildMockSupabaseClient(mockData) {
  return {
    from(tableName) {
      const data = mockData[tableName] || [];
      const createQueryBuilder = (currentData) => {
        const builder = {
          data: currentData,
          error: null,
          select() {
            return builder;
          },
          eq(field, val) {
            let filtered = currentData;
            if (field === "type") {
              filtered = currentData.filter((item) => item.type === val);
            }
            return createQueryBuilder(filtered);
          },
          gte() {
            return builder;
          },
          lt() {
            return builder;
          },
          order() {
            return builder;
          },
          limit(count) {
            return createQueryBuilder(currentData.slice(0, count));
          },
          ilike() {
            return builder;
          },
          then(resolve, reject) {
            return Promise.resolve({ data: currentData, error: null }).then(resolve, reject);
          },
        };
        return builder;
      };
      return createQueryBuilder(data);
    },
  };
}

// Mock Supabase context for deterministic unit testing
function createMockToolContext(overrides = {}) {
  const defaultWallets = [
    { id: "w_cash", name: "Tiền mặt", type: "cash", balance: 5000000, reserved_amount: 500000, currency: "VND" },
    { id: "w_vcb", name: "Tài khoản VCB", type: "bank", balance: 10000000, reserved_amount: 0, currency: "VND" },
    { id: "w_usd", name: "PayPal USD", type: "ewallet", balance: 250, reserved_amount: 0, currency: "USD" },
  ];

  const defaultBudgets = [
    { id: "b_food", name: "Ngân sách Ăn uống", amount: 3000000, allocated_amount: 500000, remaining_amount: 500000, category_id: "c_food", period: "monthly", alert_percent: 80 },
  ];

  const defaultCategories = [
    { id: "c_food", name: "Ăn uống" },
    { id: "c_house", name: "Nhà ở" },
    { id: "c_trans", name: "Di chuyển" },
  ];

  const defaultGoals = [
    { id: "g_laptop", title: "Mua Laptop M3", target_amount: 25000000, current_amount: 5000000, deadline: "2026-12-31" },
  ];

  const defaultTxs = [
    { id: "t1", title: "Lương tháng 10", amount: 15000000, type: "income", category: "Lương", category_id: null, wallet_id: "w_vcb", occurred_at: "2026-10-05T08:00:00Z" },
    { id: "t2", title: "Ăn uống gia đình", amount: 2100000, type: "expense", category: "Ăn uống", category_id: "c_food", wallet_id: "w_cash", occurred_at: "2026-10-10T12:00:00Z" },
    { id: "t3", title: "Siêu thị thực phẩm", amount: 550000, type: "expense", category: "Ăn uống", category_id: "c_food", wallet_id: "w_cash", occurred_at: "2026-10-20T17:00:00Z" },
    { id: "t4", title: "Tiền thuê nhà", amount: 1500000, type: "expense", category: "Nhà ở", category_id: "c_house", wallet_id: "w_vcb", occurred_at: "2026-10-02T09:00:00Z" },
    { id: "t5", title: "Xăng xe", amount: 700000, type: "expense", category: "Di chuyển", category_id: "c_trans", wallet_id: "w_cash", occurred_at: "2026-10-15T15:00:00Z" },
  ];

  const mockData = {
    wallets: overrides.wallets ?? defaultWallets,
    budgets: overrides.budgets ?? defaultBudgets,
    categories: overrides.categories ?? defaultCategories,
    savings_goals: overrides.goals ?? defaultGoals,
    transactions: overrides.transactions ?? defaultTxs,
  };

  return {
    supabaseUrl: "https://mock.supabase.co",
    supabaseKey: "mock_key",
    token: "mock_token",
    userId: "user_test_mock",
    client: buildMockSupabaseClient(mockData),
  };
}

// ============================================================================
// Group 1: Balance & Wallet Queries (Hỏi số dư ví & Tiền tệ)
// ============================================================================

test("Scenario 1: User asks 'Tôi có bao nhiêu tiền?' -> classifies as USER_FINANCIAL_DATA", () => {
  const result = classifyFinancialQuery("Tôi có bao nhiêu tiền?");
  assert.equal(result.category, "USER_FINANCIAL_DATA");
});

test("Scenario 2: Specific wallet query 'Ví tiền mặt còn bao nhiêu?' -> classifies as USER_FINANCIAL_DATA", () => {
  const result = classifyFinancialQuery("Ví tiền mặt của tôi còn bao nhiêu tiền?");
  assert.equal(result.category, "USER_FINANCIAL_DATA");
});

test("Scenario 3: Bank balance query 'Số dư tài khoản ngân hàng' -> classifies as USER_FINANCIAL_DATA", () => {
  const result = classifyFinancialQuery("Số dư tài khoản hiện tại của tôi");
  assert.equal(result.category, "USER_FINANCIAL_DATA");
});

test("Scenario 4: Multi-currency separation: get_wallet_balances calculates separate VND and USD totals", async () => {
  const ctx = createMockToolContext({ transactions: [] });
  const res = await executeFinancialTool("get_wallet_balances", {}, ctx);
  assert.ok(res.success);
  assert.match(res.summaryVi, /Tổng số dư/);
  assert.match(res.summaryVi, /15\.000\.000 VND/);
  assert.match(res.summaryVi, /14\.500\.000 VND/); // Available
  assert.match(res.summaryVi, /500\.000 VND/); // Reserved
  assert.doesNotMatch(res.summaryVi, /15\.000\.250/); // Never naive cross-currency addition
});

test("Scenario 5: Empty wallets list handles gracefully without crashing", async () => {
  const ctx = createMockToolContext({ wallets: [] });
  const res = await executeFinancialTool("get_wallet_balances", {}, ctx);
  assert.ok(res.success);
  assert.ok(Array.isArray(res.data.wallets));
  assert.equal(res.data.wallets.length, 0);
});

// ============================================================================
// Group 2: Spending Analysis (Phân tích chi tiêu & Thu nhập)
// ============================================================================

test("Scenario 6: User asks 'Tháng này tôi đã chi bao nhiêu?' -> classifies as SPENDING_ANALYSIS", () => {
  const result = classifyFinancialQuery("Tháng này tôi đã chi bao nhiêu?");
  assert.equal(result.category, "SPENDING_ANALYSIS");
});

test("Scenario 7: Highest spending query 'Tôi chi nhiều nhất cho cái gì?' -> classifies as SPENDING_ANALYSIS", () => {
  const result = classifyFinancialQuery("Khoản chi lớn nhất của tôi tháng này là gì?");
  assert.equal(result.category, "SPENDING_ANALYSIS");
});

test("Scenario 8: Comparison with previous month 'So với tháng trước chi tiêu tăng hay giảm?'", () => {
  const result = classifyFinancialQuery("So với tháng trước thì chi tiêu tăng hay giảm?");
  assert.equal(result.category, "SPENDING_ANALYSIS");
});

test("Scenario 9: Spending tool computes net savings and savings rate correctly", async () => {
  const ctx = createMockToolContext();
  const res = await executeFinancialTool("get_spending_analysis", {}, ctx);
  assert.ok(res.success);
  assert.match(res.summaryVi, /TỔNG KẾT CHI TIÊU/);
  assert.match(res.summaryVi, /4\.850\.000 VND/); // Total expense
  assert.match(res.summaryVi, /15\.000\.000 VND/); // Total income
  assert.match(res.summaryVi, /10\.150\.000 VND/); // Net savings
  assert.match(res.summaryVi, /68%/); // Savings rate
  assert.match(res.summaryVi, /Ăn uống/); // Highest category
});

test("Scenario 10: Transfers between wallets do not count as income or expense", async () => {
  const ctx = createMockToolContext({
    transactions: [
      { id: "tr1", title: "Chuyển tiền tiết kiệm", amount: 2000000, type: "transfer", category: "Chuyển tiền", occurred_at: new Date().toISOString() },
    ],
  });
  const res = await executeFinancialTool("get_spending_analysis", {}, ctx);
  assert.ok(res.success);
  assert.equal(res.data.curExpense, 0);
  assert.equal(res.data.curIncome, 0);
});

// ============================================================================
// Group 3: Budget Management (Ngân sách & Quỹ phong bì)
// ============================================================================

test("Scenario 11: User asks about budget -> classifies as BUDGET_ADVICE", () => {
  const result = classifyFinancialQuery("Ngân sách Ăn uống của tôi còn lại bao nhiêu tiền?");
  assert.equal(result.category, "BUDGET_ADVICE");
});

test("Scenario 12: Percentage used query -> classifies as BUDGET_ADVICE", () => {
  const result = classifyFinancialQuery("Tôi đã sử dụng bao nhiêu phần trăm ngân sách Ăn uống?");
  assert.equal(result.category, "BUDGET_ADVICE");
});

test("Scenario 13: Budget tool computes limit (3M), actual spent (2.65M) and remaining (350k) accurately", async () => {
  const ctx = createMockToolContext();
  const res = await executeFinancialTool("get_budget_status", { category: "Ăn uống" }, ctx);
  assert.ok(res.success);
  assert.match(res.summaryVi, /3\.000\.000 VND/); // Limit
  assert.match(res.summaryVi, /2\.650\.000 VND/); // Actual spent (2.1M + 550k)
  assert.match(res.summaryVi, /350\.000 VND/); // Remaining
  assert.match(res.summaryVi, /88\.3%/); // Percentage used
  assert.match(res.summaryVi, /CẢNH BÁO/); // Near limit alert
});

test("Scenario 14: Direct wallet expense increments category actual spending without double-adding", async () => {
  const ctx = createMockToolContext();
  const res = await executeFinancialTool("get_budget_status", {}, ctx);
  assert.ok(res.success);
  const foodBudget = res.data.budgets.find((b) => b.budgetName.includes("Ăn uống"));
  assert.ok(foodBudget);
  assert.equal(foodBudget.actualSpent, 2650000);
  assert.equal(foodBudget.limitRemaining, 350000);
});

test("Scenario 15: Budget exceeding 100% is marked as EXCEEDED_LIMIT status", async () => {
  const ctx = createMockToolContext({
    budgets: [
      { id: "b_small", name: "Ngân sách nhỏ", amount: 1000000, category_id: "c_food" },
    ],
  });
  const res = await executeFinancialTool("get_budget_status", {}, ctx);
  assert.ok(res.success);
  const b = res.data.budgets[0];
  assert.equal(b.status, "exceeded_limit");
  assert.equal(b.limitRemaining, 0);
  assert.match(b.statusText, /VƯỢT HẠN MỨC/);
});

// ============================================================================
// Group 4: Purchase Affordability & What-If (Đánh giá khả năng chi trả)
// ============================================================================

test("Scenario 16: Affordability classification with item and price 'Có nên mua điện thoại 15 triệu không?'", () => {
  const result = classifyFinancialQuery("Có nên mua điện thoại 15 triệu không?");
  assert.equal(result.category, "AFFORDABILITY_WHATIF");
  assert.ok(result.extractedAffordability);
  assert.equal(result.extractedAffordability.price, 15000000);
  assert.match(result.extractedAffordability.itemName, /điện thoại/i);
});

test("Scenario 17: Price parsing handles '250k', '500 nghìn', '1.5 triệu', '15000000'", () => {
  assert.equal(parsePurchaseQuery("mua bữa ăn 250k")?.price, 250000);
  assert.equal(parsePurchaseQuery("chi 500 nghìn đổ xăng")?.price, 500000);
  assert.equal(parsePurchaseQuery("mua máy tính 1.5 triệu")?.price, 1500000);
  assert.equal(parsePurchaseQuery("mua xe máy 15.000.000đ")?.price, 15000000);
});

test("Scenario 18: Purchase evaluation: 15M phone with 14.5M available triggers WARNING_BALANCE", async () => {
  const ctx = createMockToolContext({ transactions: [] });
  const res = await executeFinancialTool(
    "evaluate_purchase_affordability",
    { item_name: "Điện thoại", price: 15000000 },
    ctx,
  );
  assert.ok(res.success);
  assert.equal(res.data.verdict, "WARNING_BALANCE");
  assert.equal(res.data.canAffordCash, false);
  assert.equal(res.data.cashRemainingAfter, -500000);
  assert.match(res.summaryVi, /KHÔNG ĐỦ TIỀN MẶT/);
});

test("Scenario 19: Purchase evaluation: 250k food with 350k budget remaining triggers AFFORDABLE_SAFE", async () => {
  const ctx = createMockToolContext();
  const res = await executeFinancialTool(
    "evaluate_purchase_affordability",
    { item_name: "Bữa ăn", price: 250000 },
    ctx,
  );
  assert.ok(res.success);
  assert.equal(res.data.verdict, "AFFORDABLE_SAFE");
  assert.equal(res.data.budgetRemainingAfter, 100000); // 350k - 250k = 100k
  assert.match(res.summaryVi, /AN TOÀN ĐỂ MUA/);
});

test("Scenario 20: Purchase evaluation: 500k party exceeding 350k budget remaining triggers WARNING_BUDGET", async () => {
  const ctx = createMockToolContext();
  const res = await executeFinancialTool(
    "evaluate_purchase_affordability",
    { item_name: "Bữa tiệc", price: 500000 },
    ctx,
  );
  assert.ok(res.success);
  assert.equal(res.data.verdict, "WARNING_BUDGET");
  assert.equal(res.data.budgetRemainingAfter, -150000); // 350k - 500k = -150k
  assert.match(res.summaryVi, /VƯỢT NGÂN SÁCH/);
});

// ============================================================================
// Group 5: Savings Goals & Planning (Mục tiêu tiết kiệm & Kế hoạch)
// ============================================================================

test("Scenario 21: User asks 'Mục tiêu tiết kiệm của tôi thế nào?' -> classifies as SAVINGS_PLANNING", () => {
  const result = classifyFinancialQuery("Mục tiêu tiết kiệm của tôi như thế nào?");
  assert.equal(result.category, "SAVINGS_PLANNING");
});

test("Scenario 22: Savings goal tool computes 5M / 25M (20%) and remaining 20M accurately", async () => {
  const ctx = createMockToolContext();
  const res = await executeFinancialTool("get_savings_goals", {}, ctx);
  assert.ok(res.success);
  assert.match(res.summaryVi, /Mua Laptop M3/);
  assert.match(res.summaryVi, /5\.000\.000 VND/);
  assert.match(res.summaryVi, /25\.000\.000 VND/);
  assert.match(res.summaryVi, /20%/);
  assert.match(res.summaryVi, /20\.000\.000 VND/);
  assert.match(res.summaryVi, /2026-12-31/);
});

test("Scenario 23: User asks 'Tôi nên làm gì với số tiền hiện tại?' -> classifies as GENERAL_FINANCIAL_ADVICE", () => {
  const result = classifyFinancialQuery("Tôi nên làm gì với số tiền hiện tại?");
  assert.equal(result.category, "GENERAL_FINANCIAL_ADVICE");
});

test("Scenario 24: get_financial_advice provides comprehensive 3-step structured guidance", async () => {
  const ctx = createMockToolContext();
  const res = await executeFinancialTool("get_financial_advice", {}, ctx);
  assert.ok(res.success);
  assert.match(res.summaryVi, /QUY TẮC TƯ VẤN CÁ NHÂN HÓA/);
  assert.match(res.summaryVi, /Bước 1 - Đảm bảo chi tiêu thiết yếu/);
  assert.match(res.summaryVi, /Bước 2 - Đóng góp mục tiêu tiết kiệm/);
  assert.match(res.summaryVi, /Bước 3 - Sử dụng tiền nhàn rỗi/);
});

test("Scenario 25: User with no savings goals handles gracefully without crashing", async () => {
  const ctx = createMockToolContext({ goals: [] });
  const res = await executeFinancialTool("get_savings_goals", {}, ctx);
  assert.ok(res.success);
  assert.match(res.summaryVi, /Bạn chưa tạo mục tiêu tiết kiệm nào/);
});

// ============================================================================
// Group 6: Multi-turn Conversations & Follow-up Context (Hội thoại nhiều lượt)
// ============================================================================

test("Scenario 26: Follow-up question inherits previous purchase intent from history", () => {
  const history = [
    { role: "user", parts: [{ text: "Tôi đang định mua điện thoại iPhone 15 giá 20 triệu" }] },
    { role: "model", parts: [{ text: "Chiếc điện thoại này có giá 20 triệu..." }] },
  ];
  const result = classifyFinancialQuery("Vậy tôi có nên mua không?", history);
  assert.equal(result.category, "AFFORDABILITY_WHATIF");
});

test("Scenario 27: Follow-up question on budget retains budget context", () => {
  const history = [
    { role: "user", parts: [{ text: "Hạn mức Ăn uống của tôi còn bao nhiêu?" }] },
    { role: "model", parts: [{ text: "Hạn mức Ăn uống còn lại 350.000đ" }] },
  ];
  const result = classifyFinancialQuery("Còn ngân sách thì sao?", history);
  assert.equal(result.category, "BUDGET_ADVICE");
});

test("Scenario 28: extractToolCallsFromContent parses raw JSON output from model", () => {
  const rawJson = '{"name": "get_wallet_balances", "arguments": {}}';
  const calls = extractToolCallsFromContent(rawJson);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, "get_wallet_balances");
});

test("Scenario 29: extractToolCallsFromContent parses markdown code block ```json ... ```", () => {
  const fenced = '```json\n{"name": "evaluate_purchase_affordability", "arguments": {"price": 500000}}\n```';
  const calls = extractToolCallsFromContent(fenced);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, "evaluate_purchase_affordability");
  assert.equal(calls[0].function.arguments.price, 500000);
});

// ============================================================================
// Group 7: Security, Isolation & Guardrails (Bảo mật & Phân quyền)
// ============================================================================

test("Scenario 30: System knowledge query 'Làm thế nào để xuất Excel?' -> classifies as SYSTEM_KNOWLEDGE", () => {
  const result = classifyFinancialQuery("Làm thế nào để xuất báo cáo Excel?");
  assert.equal(result.category, "SYSTEM_KNOWLEDGE");
});

test("Scenario 31: System knowledge tool retrieves OOXML / XLSX export documentation via RAG", async () => {
  const ctx = createMockToolContext();
  const res = await executeFinancialTool("get_system_knowledge", { query: "xuất excel" }, ctx);
  assert.ok(res.success);
  assert.match(res.summaryVi, /Excel/i);
});

test("Scenario 32: Obviously off-topic query (weather, coding) is intercepted before tool execution", () => {
  assert.equal(isObviouslyOffTopic("Hôm nay thời tiết Hà Nội thế nào?"), true);
  assert.equal(isObviouslyOffTopic("Viết cho tôi hàm quicksort bằng python"), true);
  assert.equal(isObviouslyOffTopic("Tôi có bao nhiêu tiền?"), false);
  assert.equal(isObviouslyOffTopic("Tháng này tôi mua game hết bao nhiêu tiền?"), false);
});

test("Scenario 33: FINANCE_SYSTEM_PROMPT contains strict security guardrails against unauthorized writes", () => {
  assert.match(FINANCE_SYSTEM_PROMPT, /Bạn chỉ có quyền ĐỌC dữ liệu và TƯ VẤN/);
  assert.match(FINANCE_SYSTEM_PROMPT, /Không được tự ý xóa, sửa hoặc tạo giao dịch/);
  assert.match(FINANCE_SYSTEM_PROMPT, /Không để lộ token, mật khẩu, khóa bí mật/);
});
