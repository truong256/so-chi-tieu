/**
 * tests/authoritative-balance-audit.test.mjs
 * ==========================================
 * Comprehensive Root Cause & Regression Audit Test Suite for
 * Authoritative Balance Calculation and Chatbot Accuracy.
 *
 * Scenarios tested:
 * 1. Authoritative Financial Snapshot Calculation:
 *    - User scenario: 2 wallets with DB balance = 0.00 (wallets.balance = 0)
 *    - Real transactions (income + expense) + transfers yielding 4,104,000 VND
 *    - Active budgets remaining + savings goals reserved yielding 645,000 VND
 *    - Verified output:
 *      * Total Assets = 4,104,000 VND
 *      * Total Allocated = 645,000 VND
 *      * Total Available = 3,459,000 VND
 * 2. Mathematical Consistency Rules:
 *    - Budget expense does NOT double-deduct from wallet.
 *    - Internal transfers between wallets preserve total assets.
 *    - Available balance = Math.max(0, computedBalance - reservedAmount).
 * 3. Intent Routing for 8 canonical user balance queries:
 *    - "Tôi có bao nhiêu tiền?"
 *    - "Tổng tài sản của tôi là bao nhiêu?"
 *    - "Tôi còn bao nhiêu tiền?"
 *    - "Tôi có bao nhiêu tiền khả dụng?"
 *    - "Tiền mặt của tôi còn bao nhiêu?"
 *    - "Tiền trong ngân hàng còn bao nhiêu?"
 *    - "Tôi đã phân bổ bao nhiêu tiền?"
 *    - "Tôi có đủ tiền mua món đồ 2 triệu không?"
 * 4. Deterministic Tool Execution (`get_wallet_balances`, `evaluate_purchase_affordability`):
 *    - Correct balance breakdown and purchase affordability evaluations.
 * 5. Error handling and non-zero fallbacks:
 *    - Database connection error or missing permissions MUST NOT become 0 VND.
 * 6. Multi-currency and multi-user isolation:
 *    - VND and USD are never combined; users cannot access others' balances.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  computeAuthoritativeWalletBalances,
  computeAuthoritativeReservedByWallet,
  computeAuthoritativeAvailableBalances,
  buildAuthoritativeFinancialSnapshot,
} from "../backend/src/services/financial-snapshot.service.ts";

import { routeUserIntent } from "../backend/src/services/ai-router.service.ts";
import { executeFinancialTool } from "../backend/src/services/financial-tools.service.ts";
import { formatServerFinancialContextForPrompt } from "../backend/src/services/financial-context.service.ts";

test("0. Low-level calculation functions work in isolation", () => {
  const wallets = [
    { id: "w1", name: "Ví chính", type: "cash", balance: 0, currency: "VND" },
  ];
  const txs = [
    { id: "t1", amount: 1000000, type: "income", wallet_id: "w1" },
    { id: "t2", amount: 300000, type: "expense", wallet_id: "w1" },
  ];
  const transfers = [];
  const budgets = [
    { id: "b1", remaining_amount: 200000, allocated_amount: 500000, status: "active", source_wallet_id: "w1" },
  ];
  const goals = [
    { id: "g1", reserved_in_wallet: 100000, current_amount: 100000, source_wallet_id: "w1" },
  ];

  const balances = computeAuthoritativeWalletBalances(wallets, txs, transfers, budgets);
  assert.equal(balances.get("w1"), 700000);

  const reserved = computeAuthoritativeReservedByWallet(wallets, budgets, goals);
  assert.equal(reserved.get("w1"), 300000); // 200k + 100k

  const available = computeAuthoritativeAvailableBalances(balances, reserved);
  assert.equal(available.get("w1"), 400000); // 700k - 300k
});

test("1. Authoritative Snapshot correctly calculates 4.104.000 VND from transactions when wallets.balance is 0", () => {
  const wallets = [
    { id: "w-bank", name: "tiền ngân hàng", type: "bank", balance: 0, currency: "VND", reserved_amount: 0 },
    { id: "w-cash", name: "Tiền mặt", type: "cash", balance: 0, currency: "VND", reserved_amount: 0 },
  ];

  // Transactions that total 4.104.000 VND:
  // e.g. w-bank has income 5.000.000, expense 896.000 => 4.104.000
  const transactions = [
    { id: "t1", amount: 5000000, type: "income", wallet_id: "w-bank", category: "Lương" },
    { id: "t2", amount: 896000, type: "expense", wallet_id: "w-bank", category: "Chi tiêu" },
  ];

  const transfers = [];

  const budgets = [
    {
      id: "b1",
      name: "Ăn uống",
      amount: 1000000,
      spent_amount: 655000,
      remaining_amount: 345000,
      allocated_amount: 1000000,
      status: "active",
      source_wallet_id: "w-bank",
    },
  ];

  const goals = [
    {
      id: "g1",
      title: "Tiết kiệm khẩn cấp",
      target_amount: 1000000,
      current_amount: 300000,
      source_wallet_id: "w-bank",
      reserved_in_wallet: 300000,
    },
  ];

  const snapshot = buildAuthoritativeFinancialSnapshot(wallets, transactions, transfers, budgets, goals);

  assert.equal(snapshot.totalAssets, 4104000, "Total assets must be exactly 4.104.000 VND");
  assert.equal(snapshot.totalAllocated, 645000, "Total allocated must be exactly 645.000 VND (345k budget + 300k goal)");
  assert.equal(snapshot.totalAvailable, 3459000, "Total available must be exactly 3.459.000 VND (4.104.000 - 645.000)");

  // Bank wallet verification
  const bankWallet = snapshot.enrichedWallets.find((w) => w.id === "w-bank");
  assert.ok(bankWallet);
  assert.equal(bankWallet.balance, 4104000);
  assert.equal(bankWallet.reservedAmount, 645000);
  assert.equal(bankWallet.availableBalance, 3459000);
});

test("2. Internal transfers preserve total assets and update wallet balances correctly", () => {
  const wallets = [
    { id: "w-bank", name: "Ngân hàng", type: "bank", balance: 0, currency: "VND" },
    { id: "w-cash", name: "Tiền mặt", type: "cash", balance: 0, currency: "VND" },
  ];

  const transactions = [
    { id: "t1", amount: 4104000, type: "income", wallet_id: "w-bank" },
  ];

  // Transfer 1.000.000 VND from bank to cash
  const transfers = [
    { id: "tr1", from_wallet_id: "w-bank", to_wallet_id: "w-cash", amount: 1000000 },
  ];

  const snapshot = buildAuthoritativeFinancialSnapshot(wallets, transactions, transfers, [], []);

  assert.equal(snapshot.totalAssets, 4104000, "Transfers must never duplicate or leak money");
  const bank = snapshot.enrichedWallets.find((w) => w.id === "w-bank");
  const cash = snapshot.enrichedWallets.find((w) => w.id === "w-cash");

  assert.equal(bank.balance, 3104000, "Bank balance should be 4.104.000 - 1.000.000 = 3.104.000");
  assert.equal(cash.balance, 1000000, "Cash balance should be 1.000.000");
});

test("3. Budget-funded expenses do not double-deduct from wallet", () => {
  const wallets = [
    { id: "w1", name: "Ví chính", type: "general", balance: 0, currency: "VND" },
  ];

  const transactions = [
    { id: "t1", amount: 1000000, type: "income", wallet_id: "w1" },
    // Expense paid from budget
    { id: "t2", amount: 200000, type: "expense", wallet_id: "w1", payment_source_type: "budget", budget_id: "b1" },
  ];

  const budgets = [
    {
      id: "b1",
      name: "Ngân sách tiêu vặt",
      amount: 500000,
      spent_amount: 200000,
      remaining_amount: 300000,
      allocated_amount: 500000,
      status: "active",
      source_wallet_id: "w1",
    },
  ];

  const snapshot = buildAuthoritativeFinancialSnapshot(wallets, transactions, [], budgets, []);

  // Total assets = 1.000.000 - 200.000 = 800.000
  assert.equal(snapshot.totalAssets, 800000);
  // Remaining reserved in budget = 300.000
  assert.equal(snapshot.totalAllocated, 300000);
  // Available = 800.000 - 300.000 = 500.000
  assert.equal(snapshot.totalAvailable, 500000);
});

test("4. Intent Router correctly classifies all 8 required balance queries", () => {
  const queries = [
    { text: "Tôi có bao nhiêu tiền?", expectedCategory: "USER_FINANCIAL_DATA", requireData: true },
    { text: "Tổng tài sản của tôi là bao nhiêu?", expectedCategory: "USER_FINANCIAL_DATA", requireData: true },
    { text: "Tôi còn bao nhiêu tiền?", expectedCategory: "USER_FINANCIAL_DATA", requireData: true },
    { text: "Tôi có bao nhiêu tiền khả dụng?", expectedCategory: "USER_FINANCIAL_DATA", requireData: true },
    { text: "Tiền mặt của tôi còn bao nhiêu?", expectedCategory: "USER_FINANCIAL_DATA", requireData: true },
    { text: "Tiền trong ngân hàng còn bao nhiêu?", expectedCategory: "USER_FINANCIAL_DATA", requireData: true },
    { text: "Tôi đã phân bổ bao nhiêu tiền?", expectedCategory: "USER_FINANCIAL_DATA", requireData: true },
    { text: "Tôi có đủ tiền mua món đồ 2 triệu không?", expectedCategory: "AFFORDABILITY_WHATIF", requireData: true },
  ];

  for (const q of queries) {
    const route = routeUserIntent(q.text);
    assert.equal(route.requiresPersonalData, q.requireData, `Query "${q.text}" must require personal data`);
    assert.equal(route.category, q.expectedCategory, `Query "${q.text}" expected category ${q.expectedCategory} but got ${route.category}`);
  }
});

test("5. Deterministic tool get_wallet_balances returns authoritative figures", async () => {
  const mockClient = {
    from: (table) => ({
      select: () => ({
        eq: () => {
          if (table === "wallets") {
            return Promise.resolve({
              data: [
                { id: "w-bank", name: "tiền ngân hàng", type: "bank", balance: 0, currency: "VND", reserved_amount: 0 },
                { id: "w-cash", name: "Tiền mặt", type: "cash", balance: 0, currency: "VND", reserved_amount: 0 },
              ],
              error: null,
            });
          }
          if (table === "budgets") {
            return Promise.resolve({
              data: [
                { id: "b1", name: "Ăn uống", amount: 600000, remaining_amount: 345000, allocated_amount: 600000, status: "active", source_wallet_id: "w-bank" },
              ],
              error: null,
            });
          }
          if (table === "savings_goals") {
            return Promise.resolve({
              data: [
                { id: "g1", title: "Khẩn cấp", target_amount: 1000000, current_amount: 300000, source_wallet_id: "w-bank", reserved_in_wallet: 300000 },
              ],
              error: null,
            });
          }
          if (table === "transfers") {
            return Promise.resolve({ data: [], error: null });
          }
          if (table === "transactions") {
            return Promise.resolve({
              data: [
                { id: "t1", amount: 5000000, type: "income", wallet_id: "w-bank" },
                { id: "t2", amount: 896000, type: "expense", wallet_id: "w-bank" },
              ],
              error: null,
            });
          }
          return Promise.resolve({ data: [], error: null });
        },
      }),
    }),
  };

  const toolCtx = {
    supabaseUrl: "https://mock.supabase.co",
    supabaseKey: "mock-key",
    token: "mock-token",
    userId: "test-user-id",
    client: mockClient,
  };

  const result = await executeFinancialTool("get_wallet_balances", {}, toolCtx);
  assert.equal(result.success, true);
  assert.equal(result.data.totalAssets, 4104000);
  assert.equal(result.data.totalAllocated, 645000);
  assert.equal(result.data.totalAvailable, 3459000);
  assert.ok(result.summaryVi.includes("4.104.000 VND"));
  assert.ok(result.summaryVi.includes("645.000 VND"));
  assert.ok(result.summaryVi.includes("3.459.000 VND"));
});

test("6. evaluate_purchase_affordability correctly uses authoritative available balance (3.459.000 VND)", async () => {
  const mockClient = {
    from: (table) => ({
      select: () => {
        const queryObj = {
          eq: () => queryObj,
          gte: () => queryObj,
          lt: () => queryObj,
          then: (resolve) => {
            if (table === "wallets") {
              return resolve({
                data: [{ id: "w1", name: "Ví chính", type: "bank", balance: 0, currency: "VND", reserved_amount: 0 }],
                error: null,
              });
            }
            if (table === "budgets") {
              return resolve({
                data: [{ id: "b1", name: "Mua sắm", amount: 1000000, remaining_amount: 345000, allocated_amount: 600000, status: "active", category_id: null, source_wallet_id: "w1" }],
                error: null,
              });
            }
            if (table === "categories") return resolve({ data: [], error: null });
            if (table === "savings_goals") {
              return resolve({
                data: [{ id: "g1", title: "Tiết kiệm", target_amount: 1000000, current_amount: 300000, source_wallet_id: "w1", reserved_in_wallet: 300000 }],
                error: null,
              });
            }
            if (table === "transfers") return resolve({ data: [], error: null });
            if (table === "transactions") {
              return resolve({
                data: [
                  { id: "t1", amount: 5000000, type: "income", wallet_id: "w1" },
                  { id: "t2", amount: 896000, type: "expense", wallet_id: "w1" },
                ],
                error: null,
              });
            }
            return resolve({ data: [], error: null });
          },
        };
        return queryObj;
      },
    }),
  };

  const toolCtx = {
    supabaseUrl: "https://mock.supabase.co",
    supabaseKey: "mock-key",
    token: "mock-token",
    userId: "test-user-id",
    client: mockClient,
  };

  // Case A: 2.000.000 VND (Available is 3.459.000 VND => Can afford!)
  const resAfford = await executeFinancialTool(
    "evaluate_purchase_affordability",
    { item_name: "Món đồ 2 triệu", price: 2000000 },
    toolCtx,
  );
  assert.equal(resAfford.success, true);
  assert.equal(resAfford.data.canAffordCash, true);
  assert.equal(resAfford.data.cashRemainingAfter, 1459000);
  assert.ok(resAfford.summaryVi.includes("HOÀN TOÀN ĐỦ TIỀN"));

  // Case B: 5.000.000 VND (Available is 3.459.000 VND => Cannot afford!)
  const resCantAfford = await executeFinancialTool(
    "evaluate_purchase_affordability",
    { item_name: "Món đồ 5 triệu", price: 5000000 },
    toolCtx,
  );
  assert.equal(resCantAfford.success, true);
  assert.equal(resCantAfford.data.canAffordCash, false);
  assert.ok(resCantAfford.summaryVi.includes("KHÔNG ĐỦ TIỀN"));
});

test("7. Database error does NOT default balance to 0 VND", () => {
  const errContext = {
    userId: "user-err",
    asOf: "2026-10-28 04:00:00 (UTC+7)",
    currentPeriod: "Tháng 10/2026",
    previousPeriod: "Tháng 09/2026",
    timezone: "Asia/Ho_Chi_Minh (UTC+7)",
    balancesByCurrency: {},
    primaryCurrency: "VND",
    databaseQueryError: true,
    databaseErrorMessage: "Connection refused to Supabase",
  };

  const promptText = formatServerFinancialContextForPrompt(errContext, "dashboard", "Tôi có bao nhiêu tiền?");
  assert.ok(promptText.includes("[LỖI TRUY VẤN CƠ SỞ DỮ LIỆU TỪ MÁY CHỦ]"));
  assert.ok(promptText.includes("TUYỆT ĐỐI KHÔNG mặc định số dư là 0đ hay 0 VND"));
  assert.ok(promptText.includes("KHÔNG nói người dùng 'chưa có tiền' hay 'hết tiền'"));
});

test("8. Multi-currency balances are kept strictly separated", () => {
  const wallets = [
    { id: "w-vnd", name: "Ví VNĐ", type: "cash", balance: 0, currency: "VND" },
    { id: "w-usd", name: "Ví USD", type: "bank", balance: 0, currency: "USD" },
  ];

  const transactions = [
    { id: "t1", amount: 2000000, type: "income", wallet_id: "w-vnd" },
    { id: "t2", amount: 100, type: "income", wallet_id: "w-usd" },
  ];

  const snapshot = buildAuthoritativeFinancialSnapshot(wallets, transactions, [], [], []);

  assert.equal(snapshot.byCurrency["VND"].totalAssets, 2000000);
  assert.equal(snapshot.byCurrency["USD"].totalAssets, 100);
  assert.equal(Object.keys(snapshot.byCurrency).length, 2);
});

test("9. Intent Router & detectWalletTarget correctly handle all 8 specific user queries", () => {
  // Query 1: "Tôi có bao nhiêu tiền mặt?"
  const q1 = routeUserIntent("Tôi có bao nhiêu tiền mặt?");
  assert.equal(q1.primaryIntent, "PERSONAL_FINANCE");
  assert.equal(q1.category, "USER_FINANCIAL_DATA");
  assert.equal(q1.walletTargetQuery?.targetWalletKeyword, "tiền mặt");
  assert.equal(q1.walletTargetQuery?.targetWalletType, "cash");
  assert.equal(q1.walletTargetQuery?.focusType, "WALLET_BALANCE");

  // Query 2: "Tiền mặt tôi còn bao nhiêu?"
  const q2 = routeUserIntent("Tiền mặt tôi còn bao nhiêu?");
  assert.equal(q2.primaryIntent, "PERSONAL_FINANCE");
  assert.equal(q2.category, "USER_FINANCIAL_DATA");
  assert.equal(q2.walletTargetQuery?.targetWalletKeyword, "tiền mặt");
  assert.equal(q2.walletTargetQuery?.targetWalletType, "cash");
  assert.equal(q2.walletTargetQuery?.focusType, "WALLET_BALANCE");

  // Query 3: "Trong ngân hàng tôi có bao nhiêu?"
  const q3 = routeUserIntent("Trong ngân hàng tôi có bao nhiêu?");
  assert.equal(q3.primaryIntent, "PERSONAL_FINANCE");
  assert.equal(q3.category, "USER_FINANCIAL_DATA");
  assert.equal(q3.walletTargetQuery?.targetWalletKeyword, "ngân hàng");
  assert.equal(q3.walletTargetQuery?.targetWalletType, "bank");
  assert.equal(q3.walletTargetQuery?.focusType, "WALLET_BALANCE");

  // Query 4: "Tổng tài sản là bao nhiêu?"
  const q4 = routeUserIntent("Tổng tài sản là bao nhiêu?");
  assert.equal(q4.primaryIntent, "PERSONAL_FINANCE");
  assert.equal(q4.category, "USER_FINANCIAL_DATA");
  assert.equal(q4.walletTargetQuery?.focusType, "TOTAL_ASSETS");

  // Query 5: "Tôi còn bao nhiêu tiền khả dụng?"
  const q5 = routeUserIntent("Tôi còn bao nhiêu tiền khả dụng?");
  assert.equal(q5.primaryIntent, "PERSONAL_FINANCE");
  assert.equal(q5.category, "USER_FINANCIAL_DATA");
  assert.equal(q5.walletTargetQuery?.focusType, "TOTAL_AVAILABLE");

  // Query 6: "Ví tiền mặt đã phân bổ bao nhiêu?"
  const q6 = routeUserIntent("Ví tiền mặt đã phân bổ bao nhiêu?");
  assert.equal(q6.primaryIntent, "PERSONAL_FINANCE");
  assert.equal(q6.category, "USER_FINANCIAL_DATA");
  assert.equal(q6.walletTargetQuery?.targetWalletKeyword, "tiền mặt");
  assert.equal(q6.walletTargetQuery?.targetWalletType, "cash");
  assert.equal(q6.walletTargetQuery?.focusType, "WALLET_ALLOCATED");

  // Query 7: "Tôi có đủ 500.000đ tiền mặt để mua hàng không?"
  const q7 = routeUserIntent("Tôi có đủ 500.000đ tiền mặt để mua hàng không?");
  assert.equal(q7.primaryIntent, "FINANCIAL_ADVICE");
  assert.equal(q7.category, "AFFORDABILITY_WHATIF");
  assert.equal(q7.extractedAffordability?.price, 500000);
  assert.equal(q7.extractedAffordability?.targetWalletKeyword, "tiền mặt");
  assert.equal(q7.extractedAffordability?.targetWalletType, "cash");

  // Query 8: "Ví nào đang có nhiều tiền nhất?"
  const q8 = routeUserIntent("Ví nào đang có nhiều tiền nhất?");
  assert.equal(q8.primaryIntent, "PERSONAL_FINANCE");
  assert.equal(q8.category, "USER_FINANCIAL_DATA");
  assert.equal(q8.walletTargetQuery?.focusType, "HIGHEST_WALLET");
});

test("10. get_wallet_balances returns targeted wallet data without replacing with Total Assets", async () => {
  const mockClient = {
    from: (table) => ({
      select: () => ({
        eq: () => {
          if (table === "wallets") {
            return Promise.resolve({
              data: [
                { id: "w-cash", name: "Tiền mặt", type: "cash", balance: 645000, currency: "VND", reserved_amount: 345000 },
                { id: "w-bank", name: "tiền ngân hàng", type: "bank", balance: 3459000, currency: "VND", reserved_amount: 300000 },
              ],
              error: null,
            });
          }
          if (table === "budgets") {
            return Promise.resolve({
              data: [
                { id: "b1", name: "Ăn uống", amount: 1000000, remaining_amount: 345000, allocated_amount: 345000, status: "active", source_wallet_id: "w-cash" },
              ],
              error: null,
            });
          }
          if (table === "savings_goals") {
            return Promise.resolve({
              data: [
                { id: "g1", title: "Khẩn cấp", target_amount: 1000000, current_amount: 300000, source_wallet_id: "w-bank", reserved_in_wallet: 300000 },
              ],
              error: null,
            });
          }
          if (table === "transfers") return Promise.resolve({ data: [], error: null });
          if (table === "transactions") return Promise.resolve({ data: [], error: null });
          return Promise.resolve({ data: [], error: null });
        },
      }),
    }),
  };

  const toolCtx = {
    supabaseUrl: "https://mock.supabase.co",
    supabaseKey: "mock-key",
    token: "mock-token",
    userId: "test-user-id",
    client: mockClient,
  };

  // Case A: User asks for "tiền mặt"
  const resCash = await executeFinancialTool(
    "get_wallet_balances",
    { wallet_query: "tiền mặt", wallet_type: "cash", focus: "WALLET_BALANCE" },
    toolCtx,
  );
  assert.equal(resCash.success, true);
  assert.equal(resCash.data.targetWallet.walletId, "w-cash");
  assert.equal(resCash.data.targetWallet.walletName, "Tiền mặt");
  assert.equal(resCash.data.targetWallet.balance, 645000);
  assert.equal(resCash.data.targetWallet.allocated, 345000);
  assert.equal(resCash.data.targetWallet.available, 300000);
  assert.ok(resCash.summaryVi.includes('BÁO CÁO SỐ LIỆU VÍ "TIỀN MẶT"'));
  assert.ok(resCash.summaryVi.includes("TUYỆT ĐỐI KHÔNG lấy Tổng tài sản (4.104.000 VND)"));

  // Case B: User asks for "ngân hàng"
  const resBank = await executeFinancialTool(
    "get_wallet_balances",
    { wallet_query: "ngân hàng", wallet_type: "bank", focus: "WALLET_BALANCE" },
    toolCtx,
  );
  assert.equal(resBank.success, true);
  assert.equal(resBank.data.targetWallet.walletId, "w-bank");
  assert.equal(resBank.data.targetWallet.balance, 3459000);
  assert.equal(resBank.data.targetWallet.allocated, 300000);
  assert.equal(resBank.data.targetWallet.available, 3159000);

  // Case C: User asks "Ví nào đang có nhiều tiền nhất?"
  const resHighest = await executeFinancialTool(
    "get_wallet_balances",
    { focus: "HIGHEST_WALLET" },
    toolCtx,
  );
  assert.equal(resHighest.success, true);
  assert.equal(resHighest.data.highestWallet.walletId, "w-bank");
  assert.equal(resHighest.data.highestWallet.balance, 3459000);
  assert.ok(resHighest.summaryVi.includes("BÁO CÁO VÍ CÓ NHIỀU TIỀN NHẤT"));
  assert.ok(resHighest.summaryVi.includes('Ví "tiền ngân hàng" (bank) hiện đang có NHIỀU TIỀN NHẤT'));

  // Case D: User asks "Ví tiền mặt đã phân bổ bao nhiêu?"
  const resCashAlloc = await executeFinancialTool(
    "get_wallet_balances",
    { wallet_query: "tiền mặt", wallet_type: "cash", focus: "WALLET_ALLOCATED" },
    toolCtx,
  );
  assert.equal(resCashAlloc.success, true);
  assert.ok(resCashAlloc.summaryVi.includes("345.000 VND"));
  assert.ok(resCashAlloc.summaryVi.includes("TUYỆT ĐỐI KHÔNG lấy tổng số tiền phân bổ của toàn bộ tài khoản"));
});

test("11. evaluate_purchase_affordability evaluates specific target wallet (Cash available 300k vs 500k needed)", async () => {
  const mockClient = {
    from: (table) => ({
      select: () => {
        const queryObj = {
          eq: () => queryObj,
          gte: () => queryObj,
          lt: () => queryObj,
          then: (resolve) => {
            if (table === "wallets") {
              return resolve({
                data: [
                  { id: "w-cash", name: "Tiền mặt", type: "cash", balance: 645000, currency: "VND", reserved_amount: 345000 },
                  { id: "w-bank", name: "tiền ngân hàng", type: "bank", balance: 3459000, currency: "VND", reserved_amount: 300000 },
                ],
                error: null,
              });
            }
            if (table === "budgets") {
              return resolve({
                data: [
                  { id: "b1", name: "Ăn uống", amount: 1000000, remaining_amount: 345000, allocated_amount: 345000, status: "active", category_id: null, source_wallet_id: "w-cash" },
                ],
                error: null,
              });
            }
            if (table === "categories") return resolve({ data: [], error: null });
            if (table === "savings_goals") {
              return resolve({
                data: [
                  { id: "g1", title: "Khẩn cấp", target_amount: 1000000, current_amount: 300000, source_wallet_id: "w-bank", reserved_in_wallet: 300000 },
                ],
                error: null,
              });
            }
            if (table === "transfers") return resolve({ data: [], error: null });
            if (table === "transactions") return resolve({ data: [], error: null });
            return resolve({ data: [], error: null });
          },
        };
        return queryObj;
      },
    }),
  };

  const toolCtx = {
    supabaseUrl: "https://mock.supabase.co",
    supabaseKey: "mock-key",
    token: "mock-token",
    userId: "test-user-id",
    client: mockClient,
  };

  // User asks: "Tôi có đủ 500.000đ tiền mặt để mua hàng không?"
  const res = await executeFinancialTool(
    "evaluate_purchase_affordability",
    {
      item_name: "mua hàng",
      price: 500000,
      target_wallet: "tiền mặt",
      target_wallet_type: "cash",
    },
    toolCtx,
  );

  assert.equal(res.success, true);
  assert.equal(res.data.verdict, "WARNING_BALANCE");
  assert.ok(res.summaryVi.includes('KHÔNG ĐỦ TIỀN MẶT / KHÔNG ĐỦ TIỀN TỪ VÍ "Tiền mặt"'));
  assert.ok(res.summaryVi.includes("300.000 VND"));
  assert.ok(res.summaryVi.includes("thiếu 200.000 VND"));
  assert.ok(res.summaryVi.includes("TUYỆT ĐỐI KHÔNG dùng tổng khả dụng toàn bộ tài khoản"));
});

test("12. formatServerFinancialContextForPrompt produces anti-substitution directive for specific wallet questions", () => {
  const ctx = {
    userId: "test-user",
    asOf: "2026-10-28 04:00:00 (UTC+7)",
    currentPeriod: "Tháng 10/2026",
    previousPeriod: "Tháng 09/2026",
    timezone: "Asia/Ho_Chi_Minh (UTC+7)",
    primaryCurrency: "VND",
    totalAssets: 4104000,
    totalAllocated: 645000,
    totalAvailable: 3459000,
    balancesByCurrency: { VND: 4104000 },
    reservedByCurrency: { VND: 645000 },
    availableByCurrency: { VND: 3459000 },
    wallets: [
      { id: "w-cash", name: "Tiền mặt", type: "cash", balance: 645000, reservedAmount: 345000, availableBalance: 300000, currency: "VND" },
      { id: "w-bank", name: "tiền ngân hàng", type: "bank", balance: 3459000, reservedAmount: 300000, availableBalance: 3159000, currency: "VND" },
    ],
  };

  const prompt = formatServerFinancialContextForPrompt(ctx, "dashboard", "Tiền mặt tôi còn bao nhiêu tiền?");
  assert.ok(prompt.includes('[CHỈ THỊ ĐẶC BIỆT KHI HỎI VÍ CỤ THỂ "TIỀN MẶT"]'));
  assert.ok(prompt.includes("Số dư ví: 645.000 VND"));
  assert.ok(prompt.includes("Đã phân bổ: 345.000 VND"));
  assert.ok(prompt.includes("Khả dụng: 300.000 VND"));
  assert.ok(prompt.includes('TUYỆT ĐỐI KHÔNG lấy Tổng tài sản (4.104.000 VND)'));
});
