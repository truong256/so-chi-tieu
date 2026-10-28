/**
 * tests/financial-chatbot-audit-fix.test.mjs
 * ==========================================
 * Verification suite for AI Chatbot Financial Audit & Bug Fixes:
 * 1. "Tôi có bao nhiêu tiền?" -> 980.000 VND total assets, 645.000 VND allocated, 335.000 VND available.
 * 2. "Tôi có đủ tiền chi 200k không?" -> Checks available funds (335k >= 200k), source wallets (Cash: 300k vs Bank: 35k), and budget.
 * 3. "Tôi có 200k ăn sáng trong 7 ngày, nên ăn gì?" -> 7-day spending plan at ~28.571 VND/day with meal suggestions.
 * 4. "Tại sao tôi chỉ còn 335k khả dụng?" -> Explains 645.000 VND is allocated to budgets/savings, not lost.
 * 5. Supabase / API error handling -> Clearly states data is unavailable, NEVER defaults balance to 0đ or hallucinates.
 * 6. Multi-user isolation -> Prevents any cross-user data leakage.
 * 7. Read-only safety guardrails -> AI cannot mutate balances or create unauthorized transactions.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  executeFinancialTool,
  classifyFinancialQuery,
  parsePurchaseQuery,
} from "../backend/src/services/financial-tools.service.ts";

import {
  formatServerFinancialContextForPrompt,
} from "../backend/src/services/financial-context.service.ts";

import {
  FINANCE_SYSTEM_PROMPT,
} from "../backend/src/services/ai-chat.service.ts";

// ---------------------------------------------------------------------------
// Mock Supabase Client for Testing Scenarios
// ---------------------------------------------------------------------------

function createMockSupabaseClient(userFixtures) {
  return {
    from(table) {
      return {
        select(fields) {
          const state = {
            table,
            fields,
            filters: [],
            orderField: null,
            limitCount: null,
          };

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
              if (userFixtures.__simulatedDbError) {
                return resolve({ data: null, error: new Error(userFixtures.__simulatedDbError) });
              }

              const allRows = userFixtures[table] || [];
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

// ---------------------------------------------------------------------------
// Realistic User State Fixture Matching Problem Statement Exactly
// ---------------------------------------------------------------------------
// - Ví tiền mặt: 645.000 VND, đã phân bổ 345.000 VND, khả dụng 300.000 VND.
// - Ví ngân hàng: 335.000 VND, đã phân bổ 300.000 VND, khả dụng 35.000 VND.
// - Tổng tài sản: 980.000 VND, Tổng đã phân bổ: 645.000 VND, Tổng khả dụng: 335.000 VND.
const USER_A_ID = "usr-test-alice-980k";

const USER_A_FIXTURES = {
  wallets: [
    {
      id: "w-cash-1",
      user_id: USER_A_ID,
      name: "Ví tiền mặt",
      type: "cash",
      balance: 645000,
      currency: "VND",
      reserved_amount: 0, // Un-cached, must be calculated dynamically from budgets/goals!
    },
    {
      id: "w-bank-1",
      user_id: USER_A_ID,
      name: "Ví ngân hàng",
      type: "bank",
      balance: 335000,
      currency: "VND",
      reserved_amount: 0, // Un-cached, must be calculated dynamically from budgets/goals!
    },
  ],
  budgets: [
    {
      id: "b-cash-dining",
      user_id: USER_A_ID,
      name: "Ngân sách Ăn uống",
      amount: 400000,
      allocated_amount: 345000,
      remaining_amount: 345000,
      spent_amount: 0,
      status: "active",
      source_wallet_id: "w-cash-1",
      category_id: "cat-dining",
    },
    {
      id: "b-bank-bills",
      user_id: USER_A_ID,
      name: "Ngân sách Hóa đơn",
      amount: 300000,
      allocated_amount: 300000,
      remaining_amount: 300000,
      spent_amount: 0,
      status: "active",
      source_wallet_id: "w-bank-1",
      category_id: "cat-bills",
    },
  ],
  savings_goals: [],
  categories: [
    { id: "cat-dining", user_id: USER_A_ID, name: "Ăn uống" },
    { id: "cat-bills", user_id: USER_A_ID, name: "Hóa đơn" },
  ],
  transactions: [],
};

const USER_A_CONTEXT = {
  supabaseUrl: "https://mock.supabase.co",
  supabaseKey: "mock-anon-key",
  token: "jwt-user-alice-token",
  userId: USER_A_ID,
  client: createMockSupabaseClient(USER_A_FIXTURES),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("AUDIT REQ 1 & TEST 1: 'Tôi có bao nhiêu tiền?' returns 980.000 VND total assets and 335.000 VND available", async () => {
  const query = "Tôi có bao nhiêu tiền?";
  const classified = classifyFinancialQuery(query);
  assert.equal(classified.category, "USER_FINANCIAL_DATA");

  const result = await executeFinancialTool("get_wallet_balances", {}, USER_A_CONTEXT);
  assert.equal(result.success, true);

  // Validate deterministic numbers
  const vndStats = result.data.balancesByCurrency.VND;
  assert.equal(vndStats.totalBalance, 980000, "Tổng tài sản phải bằng đúng 980.000 VND");
  assert.equal(vndStats.totalReserved, 645000, "Đã phân bổ phải bằng đúng 645.000 VND (345k + 300k)");
  assert.equal(vndStats.availableBalance, 335000, "Số dư khả dụng phải bằng đúng 335.000 VND (980k - 645k)");

  // Validate per-wallet breakdown
  const cashWallet = result.data.wallets.find((w) => w.name === "Ví tiền mặt");
  assert.ok(cashWallet);
  assert.equal(cashWallet.balance, 645000);
  assert.equal(cashWallet.reservedAmount, 345000);
  assert.equal(cashWallet.availableBalance, 300000);

  const bankWallet = result.data.wallets.find((w) => w.name === "Ví ngân hàng");
  assert.ok(bankWallet);
  assert.equal(bankWallet.balance, 335000);
  assert.equal(bankWallet.reservedAmount, 300000);
  assert.equal(bankWallet.availableBalance, 35000);

  // Validate summaryVi text
  assert.match(result.summaryVi, /Tổng tài sản 980\.000 VND/);
  assert.match(result.summaryVi, /Đã phân bổ: 645\.000 VND/);
  assert.match(result.summaryVi, /Số dư khả dụng chi tiêu: 335\.000 VND/);
  assert.match(result.summaryVi, /Ví tiền mặt.*Khả dụng: 300\.000 VND/);
  assert.match(result.summaryVi, /Ví ngân hàng.*Khả dụng: 35\.000 VND/);
});

test("AUDIT REQ 2 & TEST 2: 'Tôi có đủ tiền chi 200k không?' checks available funds, source wallet sufficiency, and budget", async () => {
  const query = "Tôi có đủ tiền chi 200k không?";
  const classified = classifyFinancialQuery(query);
  assert.equal(classified.category, "AFFORDABILITY_WHATIF");
  assert.ok(classified.extractedAffordability);
  assert.equal(classified.extractedAffordability.price, 200000);

  const result = await executeFinancialTool(
    "evaluate_purchase_affordability",
    {
      item_name: classified.extractedAffordability.itemName,
      price: classified.extractedAffordability.price,
    },
    USER_A_CONTEXT,
  );

  assert.equal(result.success, true);
  // Overall user has 335.000 VND available >= 200.000 VND -> Affordability is TRUE!
  assert.equal(result.data.canAffordCash, true);
  assert.equal(result.data.cashRemainingAfter, 135000);
  assert.equal(result.data.verdict, "AFFORDABLE_SAFE");

  // Per-wallet sufficiency checks
  const cashWalletEval = result.data.walletEvaluations.find((w) => w.name === "Ví tiền mặt");
  assert.ok(cashWalletEval);
  assert.equal(cashWalletEval.availableBalance, 300000);
  assert.equal(cashWalletEval.canCoverIndividually, true, "Ví tiền mặt có 300k khả dụng nên đủ chi 200k");
  assert.equal(cashWalletEval.remainingAfter, 100000);

  const bankWalletEval = result.data.walletEvaluations.find((w) => w.name === "Ví ngân hàng");
  assert.ok(bankWalletEval);
  assert.equal(bankWalletEval.availableBalance, 35000);
  assert.equal(bankWalletEval.canCoverIndividually, false, "Ví ngân hàng chỉ có 35k khả dụng nên KHÔNG đủ chi 200k");
  assert.equal(bankWalletEval.remainingAfter, -165000);

  // Summary checks
  assert.match(result.summaryVi, /Ví "Ví tiền mặt": Khả dụng 300\.000 VND => ĐỦ ĐỂ CHI TRẢ/);
  assert.match(result.summaryVi, /Ví "Ví ngân hàng": Khả dụng 35\.000 VND => KHÔNG ĐỦ/);
  assert.match(result.summaryVi, /Sau khi chi còn: 135\.000 VND/);
});

test("AUDIT REQ 3 & TEST 3: 'Tôi có 200k ăn sáng trong 7 ngày, nên ăn gì?' calculates ~28.571 VND/day and suggests meals", async () => {
  const query = "Tôi có 200k ăn sáng trong 7 ngày, nên ăn gì?";
  const classified = classifyFinancialQuery(query);
  assert.equal(classified.category, "AFFORDABILITY_WHATIF");
  assert.ok(classified.extractedAffordability);
  assert.equal(classified.extractedAffordability.price, 200000);
  assert.equal(classified.extractedAffordability.days, 7);
  assert.equal(classified.extractedAffordability.category, "ăn uống");

  const result = await executeFinancialTool(
    "evaluate_purchase_affordability",
    {
      item_name: classified.extractedAffordability.itemName,
      price: classified.extractedAffordability.price,
      days: classified.extractedAffordability.days,
      category: classified.extractedAffordability.category,
    },
    USER_A_CONTEXT,
  );

  assert.equal(result.success, true);
  // Math: 200.000 / 7 ≈ 28.571 VND/day
  assert.equal(result.data.dailyBudget, 28571);
  assert.equal(result.data.days, 7);
  assert.ok(result.data.suggestedMeals.length >= 3);

  // Summary mentions 28.571 VND/ngày and meal suggestions
  assert.match(result.summaryVi, /28\.571 VND\/ngày/);
  assert.match(result.summaryVi, /7 ngày/);
  assert.match(result.summaryVi, /Bánh mì/);
  assert.match(result.summaryVi, /Xôi/);
  assert.match(result.summaryVi, /Bánh bao/);
});

test("AUDIT REQ 4 & TEST 4: 'Tại sao tôi chỉ còn 335k khả dụng?' explains 645.000 VND was allocated to envelopes/budgets", async () => {
  const query = "Tại sao tôi chỉ còn 335k khả dụng?";
  
  // Must NOT be misclassified as purchase
  assert.equal(parsePurchaseQuery(query), null, "Query must not be parsed as an item purchase");
  const classified = classifyFinancialQuery(query);
  assert.equal(classified.category, "USER_FINANCIAL_DATA");

  const result = await executeFinancialTool("get_wallet_balances", {}, USER_A_CONTEXT);
  assert.equal(result.success, true);

  // Summary explicitly explains 645k allocated
  assert.match(result.summaryVi, /GIẢI THÍCH LÝ DO SỐ DƯ KHẢ DỤNG LÀ 335\.000 VND/);
  assert.match(result.summaryVi, /645\.000 VND đã được phân bổ/);
  assert.match(result.summaryVi, /980\.000 - 645\.000 = 335\.000 VND/);
  assert.match(result.summaryVi, /Tiền đã phân bổ không hề mất đi/);
});

test("AUDIT REQ 5 & TEST 5: When Supabase or API fails, does not default to 0 VND or invent data", async () => {
  const ERROR_CONTEXT = {
    supabaseUrl: "https://mock.supabase.co",
    supabaseKey: "mock-anon-key",
    token: "jwt-user-error-token",
    userId: "user-error",
    client: createMockSupabaseClient({ __simulatedDbError: "Network connection refused" }),
  };

  const toolResult = await executeFinancialTool("get_wallet_balances", {}, ERROR_CONTEXT);
  assert.equal(toolResult.success, false);
  assert.equal(toolResult.data, null);
  assert.match(toolResult.summaryVi, /⚠️ LỖI TRUY VẤN DỮ LIỆU TÀI CHÍNH/);
  assert.match(toolResult.summaryVi, /TUYỆT ĐỐI KHÔNG mặc định số dư bằng 0 VND/);

  // Server context prompt formatter behavior on error
  const mockErrorServerContext = {
    asOf: "2026-10-28 01:00:00 (UTC+7)",
    timezone: "Asia/Ho_Chi_Minh (UTC+7)",
    currentPeriod: "Tháng 10/2026",
    previousPeriod: "Tháng 09/2026",
    primaryCurrency: "VND",
    balancesByCurrency: {},
    reservedByCurrency: {},
    availableByCurrency: {},
    expensesByCurrency: {},
    incomesByCurrency: {},
    previousExpensesByCurrency: {},
    previousIncomesByCurrency: {},
    currentMonthIncome: 0,
    currentMonthExpense: 0,
    currentMonthNetSavings: 0,
    currentMonthSavingsRate: 0,
    previousMonthIncome: 0,
    previousMonthExpense: 0,
    expenseChangeVsPreviousMonth: { difference: 0, percentChange: null },
    topCategories: [],
    highestSpendingCategory: null,
    wallets: [],
    budgets: [],
    savingsGoals: [],
    recentTransactions: [],
    whatIfContext: { sample500kImpacts: [] },
    hasSufficientData: false,
    databaseQueryError: true,
    databaseErrorMessage: "Connection refused on postgres:5432",
  };

  const prompt = formatServerFinancialContextForPrompt(mockErrorServerContext);
  assert.match(prompt, /\[LỖI TRUY VẤN CƠ SỞ DỮ LIỆU TỪ MÁY CHỦ\]/);
  assert.match(prompt, /TUYỆT ĐỐI KHÔNG mặc định số dư là 0đ hay 0 VND/);
  assert.doesNotMatch(prompt, /Tổng số dư VND: 0 VND/, "Must never format 0 VND when DB failed!");
});

test("AUDIT REQ 6 & TEST 6: Strict Multi-user Authorization: User A cannot see User B's financial data", async () => {
  const USER_B_ID = "usr-test-bob-50m";
  const USER_B_FIXTURES = {
    wallets: [
      {
        id: "w-bob-gold",
        user_id: USER_B_ID,
        name: "Ví Vàng Bob",
        type: "bank",
        balance: 50000000,
        currency: "VND",
        reserved_amount: 10000000,
      },
    ],
    budgets: [
      {
        id: "b-bob-tech",
        user_id: USER_B_ID,
        name: "Ngân sách Công nghệ Bob",
        amount: 10000000,
        allocated_amount: 10000000,
        remaining_amount: 10000000,
        spent_amount: 0,
        status: "active",
        source_wallet_id: "w-bob-gold",
      },
    ],
    savings_goals: [],
    categories: [],
    transactions: [],
  };

  // Combine fixtures in single mock database instance
  const SHARED_DB_FIXTURES = {
    wallets: [...USER_A_FIXTURES.wallets, ...USER_B_FIXTURES.wallets],
    budgets: [...USER_A_FIXTURES.budgets, ...USER_B_FIXTURES.budgets],
    savings_goals: [],
    categories: USER_A_FIXTURES.categories,
    transactions: [],
  };

  const client = createMockSupabaseClient(SHARED_DB_FIXTURES);

  const ctxUserA = {
    supabaseUrl: "https://mock.supabase.co",
    supabaseKey: "mock-key",
    token: "token-a",
    userId: USER_A_ID,
    client,
  };

  const ctxUserB = {
    supabaseUrl: "https://mock.supabase.co",
    supabaseKey: "mock-key",
    token: "token-b",
    userId: USER_B_ID,
    client,
  };

  // Query User A
  const resA = await executeFinancialTool("get_wallet_balances", {}, ctxUserA);
  assert.equal(resA.data.balancesByCurrency.VND.totalBalance, 980000);
  assert.equal(resA.data.wallets.length, 2);
  assert.ok(resA.data.wallets.every((w) => w.name !== "Ví Vàng Bob"), "User A must NOT see Bob's wallet!");

  // Query User B
  const resB = await executeFinancialTool("get_wallet_balances", {}, ctxUserB);
  assert.equal(resB.data.balancesByCurrency.VND.totalBalance, 50000000);
  assert.equal(resB.data.wallets.length, 1);
  assert.equal(resB.data.wallets[0].name, "Ví Vàng Bob");
  assert.ok(!resB.data.wallets.some((w) => w.name === "Ví tiền mặt"), "User B must NOT see Alice's wallet!");
});

test("AUDIT REQ 7: Guardrails enforce Read-Only operation and no automated transaction creation", () => {
  assert.match(FINANCE_SYSTEM_PROMPT, /Bạn chỉ có quyền ĐỌC dữ liệu và TƯ VẤN \(Read-Only\)/);
  assert.match(FINANCE_SYSTEM_PROMPT, /Không được tự ý xóa, sửa hoặc tạo giao dịch/);
  assert.match(FINANCE_SYSTEM_PROMPT, /Không để lộ token, mật khẩu, khóa bí mật/);
});
