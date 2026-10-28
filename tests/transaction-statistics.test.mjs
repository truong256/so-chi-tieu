/**
 * tests/transaction-statistics.test.mjs
 * =====================================
 * Verification test suite for AI Chatbot Transaction Statistics & Count Audit:
 *
 * 1. Month with 0 transactions (Tháng không có giao dịch -> returns 0, no hallucination)
 * 2. Exactly 1 transaction in range (1 in October 2026 vs 10 in total account -> reports 1 for October)
 * 3. Multiple transactions in month (Nhiều giao dịch -> accurate income, expense, and total counts)
 * 4. Transactions in different months (Giao dịch khác tháng -> September vs October vs November boundaries in UTC+7)
 * 5. Transfers between wallets (Giao dịch chuyển ví -> distinct from transactions, reported separately)
 * 6. Recurring transactions (Giao dịch định kỳ -> only executed transactions counted, templates distinguished)
 * 7. Pagination vs Total (Phân trang -> page slice does not alter reported period count)
 * 8. Filtering (Bộ lọc -> date range, category, type, wallet)
 * 9. Multi-user isolation (Nhiều người dùng -> strict RLS / user_id segregation)
 * 10. Database error resilience (Lỗi API/DB -> reports unverifiable, never invents numbers)
 * 11. Immediate update upon mutations (Cập nhật tức thời -> add, edit, delete immediately update counts)
 * 12. History independence (Không dùng dữ liệu lịch sử cũ khi người dùng hỏi lại)
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  executeFinancialTool,
  classifyFinancialQuery,
  getVietnamTimeBounds,
  parseCustomDateRangeVn,
} from "../backend/src/services/financial-tools.service.ts";

import {
  routeUserIntent,
  parseTransactionStatisticsQuery,
} from "../backend/src/services/ai-router.service.ts";

import {
  formatServerFinancialContextForPrompt,
} from "../backend/src/services/financial-context.service.ts";

// ---------------------------------------------------------------------------
// Mock Supabase Client Helper
// ---------------------------------------------------------------------------

function createMockSupabase(store) {
  return {
    from(tableName) {
      return {
        select(fields) {
          const state = {
            table: tableName,
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
            range() {
              return builder;
            },
            async then(resolve) {
              if (store.__simulatedDbError) {
                return resolve({ data: null, error: new Error(store.__simulatedDbError) });
              }

              const all = store[tableName] || [];
              const filtered = all.filter((r) => {
                for (const f of state.filters) {
                  if (f.op === "eq" && r[f.col] !== f.val) return false;
                  if (f.op === "gte" && r[f.col] < f.val) return false;
                  if (f.op === "lt" && r[f.col] >= f.val) return false;
                  if (f.op === "ilike") {
                    const haystack = String(r[f.col] || "").toLowerCase();
                    const needle = String(f.val).replace(/%/g, "").toLowerCase();
                    if (!haystack.includes(needle)) return false;
                  }
                }
                return true;
              });

              const resultData = state.limitCount ? filtered.slice(0, state.limitCount) : filtered;
              return resolve({
                data: resultData,
                count: filtered.length,
                error: null,
              });
            },
          };

          return builder;
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// TEST 1: Intent Routing & Query Parsing
// ---------------------------------------------------------------------------

test("Intent Router: 'Tháng này tôi có bao nhiêu giao dịch?' routes to PERSONAL_FINANCE and TRANSACTION_STATISTICS", () => {
  const query = "Tháng này tôi có bao nhiêu giao dịch?";
  const routing = routeUserIntent(query);

  assert.equal(routing.primaryIntent, "PERSONAL_FINANCE");
  assert.equal(routing.category, "TRANSACTION_STATISTICS");
  assert.equal(routing.requiresPersonalData, true);
  assert.ok(routing.transactionStatisticsQuery);
  assert.equal(routing.transactionStatisticsQuery?.period, "current_month");

  const classified = classifyFinancialQuery(query);
  assert.equal(classified.category, "TRANSACTION_STATISTICS");
});

test("Intent Router: Parses custom date range 'từ 01/10/2026 đến 30/10/2026'", () => {
  const query = "Từ ngày 01/10/2026 đến 30/10/2026 tôi có bao nhiêu giao dịch?";
  const parsed = parseTransactionStatisticsQuery(query);

  assert.ok(parsed);
  assert.equal(parsed.period, "custom");
  assert.equal(parsed.startDate, "01/10/2026");
  assert.equal(parsed.endDate, "30/10/2026");
});

test("Intent Router: Parses previous month and type filtering (khoản chi / khoản thu)", () => {
  const expenseQuery = "Tháng trước tôi có bao nhiêu khoản chi?";
  const parsedExpense = parseTransactionStatisticsQuery(expenseQuery);
  assert.ok(parsedExpense);
  assert.equal(parsedExpense.period, "previous_month");
  assert.equal(parsedExpense.type, "expense");

  const incomeQuery = "Toàn bộ có bao nhiêu khoản thu?";
  const parsedIncome = parseTransactionStatisticsQuery(incomeQuery);
  assert.ok(parsedIncome);
  assert.equal(parsedIncome.period, "all");
  assert.equal(parsedIncome.type, "income");
});

// ---------------------------------------------------------------------------
// TEST 2: Asia/Ho_Chi_Minh Timezone Bounds
// ---------------------------------------------------------------------------

test("Timezone: getVietnamTimeBounds normalizes month start and end with UTC+7 offset", () => {
  // 2026-10-15 12:00:00 UTC = 2026-10-15 19:00:00 UTC+7
  const refDate = new Date("2026-10-15T12:00:00.000Z");
  const bounds = getVietnamTimeBounds(refDate);

  assert.equal(bounds.year, 2026);
  assert.equal(bounds.month, 10);
  assert.equal(bounds.currentMonthLabel, "Tháng 10/2026");
  assert.equal(bounds.previousMonthLabel, "Tháng 09/2026");

  // October 1st 00:00:00 UTC+7 is September 30th 17:00:00 UTC
  assert.equal(bounds.currentStartIso, "2026-09-30T17:00:00.000Z");
  // November 1st 00:00:00 UTC+7 is October 31st 17:00:00 UTC
  assert.equal(bounds.currentEndIso, "2026-10-31T17:00:00.000Z");
});

test("Timezone: parseCustomDateRangeVn parses 01/10/2026 to 30/10/2026 precisely in UTC+7", () => {
  const range = parseCustomDateRangeVn("01/10/2026", "30/10/2026");

  // Start: 2026-10-01 00:00:00 UTC+7 = 2026-09-30 17:00:00 UTC
  assert.equal(range.startIso, "2026-09-30T17:00:00.000Z");
  // End covers 2026-10-30 23:59:59.999 UTC+7, i.e. < 2026-10-31 00:00:00 UTC+7 = 2026-10-30 17:00:00 UTC
  assert.equal(range.endIso, "2026-10-30T17:00:00.000Z");
  assert.equal(range.label, "từ 01/10/2026 đến 30/10/2026");
});

// ---------------------------------------------------------------------------
// TEST 3: Core Problem Statement Scenario:
// UI shows 1 transaction in 01/10/2026 - 30/10/2026.
// Total account has 10 transactions.
// Chatbot MUST report exactly 1 transaction in October 2026, NOT 10!
// ---------------------------------------------------------------------------

test("AUDIT SCENARIO: User has 1 transaction in Oct 2026, 9 in Aug/Sep (total 10) -> get_transaction_statistics reports 1", async () => {
  const USER_ID = "user-audit-123";

  const store = {
    transactions: [
      // 1 transaction in October 2026
      {
        id: "tx-oct-1",
        user_id: USER_ID,
        title: "Cơm trưa văn phòng",
        amount: 45000,
        type: "expense",
        category: "Ăn uống",
        occurred_at: "2026-10-15T05:30:00.000Z", // 12:30 PM UTC+7
      },
      // 9 transactions in August / September 2026
      { id: "tx-sep-1", user_id: USER_ID, title: "Đổ xăng", amount: 50000, type: "expense", category: "Di chuyển", occurred_at: "2026-09-20T08:00:00.000Z" },
      { id: "tx-sep-2", user_id: USER_ID, title: "Tiền điện", amount: 400000, type: "expense", category: "Hóa đơn", occurred_at: "2026-09-18T08:00:00.000Z" },
      { id: "tx-sep-3", user_id: USER_ID, title: "Lương tháng 9", amount: 15000000, type: "income", category: "Lương", occurred_at: "2026-09-05T08:00:00.000Z" },
      { id: "tx-aug-1", user_id: USER_ID, title: "Cà phê", amount: 35000, type: "expense", category: "Ăn uống", occurred_at: "2026-08-25T08:00:00.000Z" },
      { id: "tx-aug-2", user_id: USER_ID, title: "Mua sách", amount: 120000, type: "expense", category: "Giáo dục", occurred_at: "2026-08-22T08:00:00.000Z" },
      { id: "tx-aug-3", user_id: USER_ID, title: "Bún bò", amount: 50000, type: "expense", category: "Ăn uống", occurred_at: "2026-08-19T08:00:00.000Z" },
      { id: "tx-aug-4", user_id: USER_ID, title: "Siêu thị", amount: 350000, type: "expense", category: "Ăn uống", occurred_at: "2026-08-15T08:00:00.000Z" },
      { id: "tx-aug-5", user_id: USER_ID, title: "Tiền mạng", amount: 220000, type: "expense", category: "Hóa đơn", occurred_at: "2026-08-10T08:00:00.000Z" },
      { id: "tx-aug-6", user_id: USER_ID, title: "Lương tháng 8", amount: 15000000, type: "income", category: "Lương", occurred_at: "2026-08-05T08:00:00.000Z" },
    ],
    transfers: [],
    recurring_transactions: [],
    wallets: [],
  };

  const toolCtx = {
    supabaseUrl: "https://mock.supabase.co",
    supabaseKey: "mock-key",
    token: "mock-token",
    userId: USER_ID,
    client: createMockSupabase(store),
  };

  // 1. Query for month 10 / 2026
  const res = await executeFinancialTool("get_transaction_statistics", { month: 10, year: 2026 }, toolCtx);
  assert.equal(res.success, true);

  // Period transaction count MUST be 1
  assert.equal(res.data.periodTransactionCount, 1, "Số giao dịch tháng 10 phải bằng đúng 1");
  assert.equal(res.data.expenseCount, 1);
  assert.equal(res.data.incomeCount, 0);
  assert.equal(res.data.totalExpense, 45000);

  // Total account transactions MUST be 10
  assert.equal(res.data.totalAccountTransactions, 10, "Tổng số giao dịch toàn tài khoản phải bằng đúng 10");

  // Summary text must clearly distinguish 1 from 10
  assert.match(res.summaryVi, /Số lượng giao dịch trong kỳ:\s*1\s*giao dịch/);
  assert.match(res.summaryVi, /Tổng số giao dịch toàn tài khoản \(mọi thời điểm\):\s*10\s*giao dịch/);
  assert.match(res.summaryVi, /KHÔNG nhầm lẫn số giao dịch trong kỳ \(1\) với tổng số giao dịch toàn tài khoản \(10\)/);

  // 2. Query with custom range 01/10/2026 to 30/10/2026 (matching UI filter)
  const resRange = await executeFinancialTool(
    "get_transaction_statistics",
    { period: "custom", start_date: "01/10/2026", end_date: "30/10/2026" },
    toolCtx,
  );
  assert.equal(resRange.success, true);
  assert.equal(resRange.data.periodTransactionCount, 1);
  assert.equal(resRange.data.totalAccountTransactions, 10);
});

// ---------------------------------------------------------------------------
// TEST 4: Month with 0 transactions
// ---------------------------------------------------------------------------

test("Scenario: Month with 0 transactions reports 0 and does not hallucinate", async () => {
  const USER_ID = "user-empty-month";

  const store = {
    transactions: [
      { id: "tx-1", user_id: USER_ID, title: "Lương", amount: 10000000, type: "income", occurred_at: "2026-08-01T08:00:00.000Z" },
    ],
    transfers: [],
    recurring_transactions: [],
    wallets: [],
  };

  const toolCtx = {
    supabaseUrl: "https://mock.supabase.co",
    supabaseKey: "mock-key",
    token: "mock-token",
    userId: USER_ID,
    client: createMockSupabase(store),
  };

  const res = await executeFinancialTool("get_transaction_statistics", { month: 10, year: 2026 }, toolCtx);
  assert.equal(res.success, true);
  assert.equal(res.data.periodTransactionCount, 0);
  assert.equal(res.data.totalAccountTransactions, 1);
  assert.match(res.summaryVi, /0 giao dịch/);
  assert.match(res.summaryVi, /Người dùng KHÔNG CÓ giao dịch nào/);
});

// ---------------------------------------------------------------------------
// TEST 5: Multiple transactions in month
// ---------------------------------------------------------------------------

test("Scenario: Multiple transactions computes exact counts, income and expense totals", async () => {
  const USER_ID = "user-multi-tx";

  const store = {
    transactions: [
      { id: "t1", user_id: USER_ID, title: "Ăn sáng", amount: 35000, type: "expense", category: "Ăn uống", occurred_at: "2026-10-02T02:00:00.000Z" },
      { id: "t2", user_id: USER_ID, title: "Ăn trưa", amount: 50000, type: "expense", category: "Ăn uống", occurred_at: "2026-10-05T05:00:00.000Z" },
      { id: "t3", user_id: USER_ID, title: "Xăng xe", amount: 60000, type: "expense", category: "Di chuyển", occurred_at: "2026-10-10T08:00:00.000Z" },
      { id: "t4", user_id: USER_ID, title: "Lương", amount: 15000000, type: "income", category: "Lương", occurred_at: "2026-10-15T09:00:00.000Z" },
      { id: "t5", user_id: USER_ID, title: "Thưởng", amount: 2000000, type: "income", category: "Thưởng", occurred_at: "2026-10-20T10:00:00.000Z" },
    ],
    transfers: [],
    recurring_transactions: [],
    wallets: [],
  };

  const toolCtx = {
    supabaseUrl: "https://mock.supabase.co",
    supabaseKey: "mock-key",
    token: "mock-token",
    userId: USER_ID,
    client: createMockSupabase(store),
  };

  const res = await executeFinancialTool("get_transaction_statistics", { month: 10, year: 2026 }, toolCtx);
  assert.equal(res.success, true);
  assert.equal(res.data.periodTransactionCount, 5);
  assert.equal(res.data.expenseCount, 3);
  assert.equal(res.data.incomeCount, 2);
  assert.equal(res.data.totalExpense, 145000);
  assert.equal(res.data.totalIncome, 17000000);
  assert.equal(res.data.netDifference, 16855000);
});

// ---------------------------------------------------------------------------
// TEST 6: Transfers between wallets separation
// ---------------------------------------------------------------------------

test("Scenario: Transfers between wallets do NOT count as income or expense", async () => {
  const USER_ID = "user-transfers-test";

  const store = {
    transactions: [
      { id: "t1", user_id: USER_ID, title: "Ăn trưa", amount: 40000, type: "expense", category: "Ăn uống", occurred_at: "2026-10-05T05:00:00.000Z" },
    ],
    transfers: [
      { id: "tr-1", user_id: USER_ID, from_wallet_id: "w1", to_wallet_id: "w2", amount: 500000, occurred_at: "2026-10-08T08:00:00.000Z" },
      { id: "tr-2", user_id: USER_ID, from_wallet_id: "w2", to_wallet_id: "w1", amount: 200000, occurred_at: "2026-10-12T08:00:00.000Z" },
    ],
    recurring_transactions: [],
    wallets: [],
  };

  const toolCtx = {
    supabaseUrl: "https://mock.supabase.co",
    supabaseKey: "mock-key",
    token: "mock-token",
    userId: USER_ID,
    client: createMockSupabase(store),
  };

  const res = await executeFinancialTool("get_transaction_statistics", { month: 10, year: 2026 }, toolCtx);
  assert.equal(res.success, true);
  assert.equal(res.data.periodTransactionCount, 1, "Chỉ tính 1 giao dịch thu/chi");
  assert.equal(res.data.transfersCount, 2, "2 giao dịch chuyển ví được thống kê riêng");
  assert.equal(res.data.totalTransfersAmount, 700000);
  assert.match(res.summaryVi, /2 lượt.*không tính vào thu\/chi/);
});

// ---------------------------------------------------------------------------
// TEST 7: Recurring transactions (templates vs executed transactions)
// ---------------------------------------------------------------------------

test("Scenario: Configured recurring templates are distinguished from executed transactions", async () => {
  const USER_ID = "user-recurring-test";

  const store = {
    transactions: [
      { id: "t1", user_id: USER_ID, title: "Tiền trọ", amount: 1500000, type: "expense", recurrence_id: "rec-1", occurred_at: "2026-10-01T02:00:00.000Z" },
    ],
    transfers: [],
    recurring_transactions: [
      { id: "rec-1", user_id: USER_ID, title: "Tiền trọ", amount: 1500000, type: "expense", active: true, auto_create: true },
      { id: "rec-2", user_id: USER_ID, title: "Tiền internet", amount: 250000, type: "expense", active: true, auto_create: true },
      { id: "rec-3", user_id: USER_ID, title: "Học phí", amount: 2000000, type: "expense", active: true, auto_create: false },
    ],
    wallets: [],
  };

  const toolCtx = {
    supabaseUrl: "https://mock.supabase.co",
    supabaseKey: "mock-key",
    token: "mock-token",
    userId: USER_ID,
    client: createMockSupabase(store),
  };

  const res = await executeFinancialTool("get_transaction_statistics", { month: 10, year: 2026 }, toolCtx);
  assert.equal(res.success, true);
  assert.equal(res.data.periodTransactionCount, 1, "Chỉ tính 1 giao dịch thực tế đã ghi nhận");
  assert.equal(res.data.activeRecurringCount, 3, "3 lịch hẹn định kỳ được phân biệt rõ là cấu hình");
  assert.match(res.summaryVi, /3 lịch giao dịch định kỳ chỉ là thiết lập hẹn giờ tự động/);
});

// ---------------------------------------------------------------------------
// TEST 8: Pagination separation (Limit does NOT affect true total)
// ---------------------------------------------------------------------------

test("Scenario: Requesting recent slice limit (e.g. 10 or 20) does not alter true period count", async () => {
  const USER_ID = "user-pagination-test";

  // 15 transactions in October 2026
  const txs = Array.from({ length: 15 }, (_, i) => ({
    id: `tx-${i + 1}`,
    user_id: USER_ID,
    title: `Khoản chi ${i + 1}`,
    amount: 10000 * (i + 1),
    type: "expense",
    category: "Khác",
    occurred_at: `2026-10-${String(i + 1).padStart(2, "0")}T08:00:00.000Z`,
  }));

  const store = {
    transactions: txs,
    transfers: [],
    recurring_transactions: [],
    wallets: [],
  };

  const toolCtx = {
    supabaseUrl: "https://mock.supabase.co",
    supabaseKey: "mock-key",
    token: "mock-token",
    userId: USER_ID,
    client: createMockSupabase(store),
  };

  // get_recent_transactions default limit is 10
  const recentRes = await executeFinancialTool("get_recent_transactions", { limit: 10 }, toolCtx);
  assert.equal(recentRes.data.transactions.length, 10, "Danh sách mẫu cắt đúng 10 bản ghi");
  assert.match(recentRes.summaryVi, /DANH SÁCH 10 GIAO DỊCH GẦN ĐÂY ĐỂ THAM KHẢO/);
  assert.match(recentRes.summaryVi, /TUYỆT ĐỐI KHÔNG PHẢI LÀ TỔNG SỐ GIAO DỊCH/);

  // get_transaction_statistics computes all 15
  const statsRes = await executeFinancialTool("get_transaction_statistics", { month: 10, year: 2026 }, toolCtx);
  assert.equal(statsRes.data.periodTransactionCount, 15, "Tổng số giao dịch thực tế phải là 15");
  assert.equal(statsRes.data.totalAccountTransactions, 15);
});

// ---------------------------------------------------------------------------
// TEST 9: Category and Type filtering
// ---------------------------------------------------------------------------

test("Scenario: Category and type filtering calculates filteredTransactionCount correctly", async () => {
  const USER_ID = "user-filter-test";

  const store = {
    transactions: [
      { id: "t1", user_id: USER_ID, title: "Phở bò", amount: 45000, type: "expense", category: "Ăn uống", occurred_at: "2026-10-02T08:00:00.000Z" },
      { id: "t2", user_id: USER_ID, title: "Cơm tấm", amount: 40000, type: "expense", category: "Ăn uống", occurred_at: "2026-10-05T08:00:00.000Z" },
      { id: "t3", user_id: USER_ID, title: "Đổ xăng", amount: 60000, type: "expense", category: "Di chuyển", occurred_at: "2026-10-10T08:00:00.000Z" },
      { id: "t4", user_id: USER_ID, title: "Lương", amount: 12000000, type: "income", category: "Lương", occurred_at: "2026-10-15T08:00:00.000Z" },
    ],
    transfers: [],
    recurring_transactions: [],
    wallets: [],
  };

  const toolCtx = {
    supabaseUrl: "https://mock.supabase.co",
    supabaseKey: "mock-key",
    token: "mock-token",
    userId: USER_ID,
    client: createMockSupabase(store),
  };

  // Filter by category: Ăn uống
  const resCat = await executeFinancialTool("get_transaction_statistics", { month: 10, year: 2026, category: "Ăn uống" }, toolCtx);
  assert.equal(resCat.data.periodTransactionCount, 4, "Tổng giao dịch trong kỳ là 4");
  assert.equal(resCat.data.filteredTransactionCount, 2, "Giao dịch danh mục Ăn uống là 2");
  assert.match(resCat.summaryVi, /Số giao dịch sau bộ lọc \(Danh mục "Ăn uống"\): 2 giao dịch/);

  // Filter by type: income
  const resIncome = await executeFinancialTool("get_transaction_statistics", { month: 10, year: 2026, type: "income" }, toolCtx);
  assert.equal(resIncome.data.filteredTransactionCount, 1, "Chỉ có 1 giao dịch thu nhập");
});

// ---------------------------------------------------------------------------
// TEST 10: Multi-user isolation
// ---------------------------------------------------------------------------

test("Scenario: User A and User B transactions are strictly isolated by authenticated user_id", async () => {
  const USER_A = "user-alice";
  const USER_B = "user-bob";

  const sharedStore = {
    transactions: [
      { id: "ta-1", user_id: USER_A, title: "Alice cafe", amount: 35000, type: "expense", occurred_at: "2026-10-10T08:00:00.000Z" },
      { id: "tb-1", user_id: USER_B, title: "Bob dinner", amount: 200000, type: "expense", occurred_at: "2026-10-10T08:00:00.000Z" },
      { id: "tb-2", user_id: USER_B, title: "Bob lunch", amount: 80000, type: "expense", occurred_at: "2026-10-12T08:00:00.000Z" },
      { id: "tb-3", user_id: USER_B, title: "Bob salary", amount: 25000000, type: "income", occurred_at: "2026-10-15T08:00:00.000Z" },
    ],
    transfers: [],
    recurring_transactions: [],
    wallets: [],
  };

  const client = createMockSupabase(sharedStore);

  const ctxA = { supabaseUrl: "mock", supabaseKey: "mock", token: "mock", userId: USER_A, client };
  const ctxB = { supabaseUrl: "mock", supabaseKey: "mock", token: "mock", userId: USER_B, client };

  const resA = await executeFinancialTool("get_transaction_statistics", { month: 10, year: 2026 }, ctxA);
  assert.equal(resA.data.periodTransactionCount, 1, "Alice chỉ thấy 1 giao dịch của mình");
  assert.equal(resA.data.totalAccountTransactions, 1);

  const resB = await executeFinancialTool("get_transaction_statistics", { month: 10, year: 2026 }, ctxB);
  assert.equal(resB.data.periodTransactionCount, 3, "Bob chỉ thấy 3 giao dịch của mình");
  assert.equal(resB.data.totalAccountTransactions, 3);
});

// ---------------------------------------------------------------------------
// TEST 11: Database Error Resilience
// ---------------------------------------------------------------------------

test("Scenario: Database failure returns error notice and NEVER hallucinates numbers", async () => {
  const store = {
    transactions: [],
    __simulatedDbError: "connection refused to postgres:5432",
  };

  const toolCtx = {
    supabaseUrl: "mock",
    supabaseKey: "mock",
    token: "mock",
    userId: "u-err",
    client: createMockSupabase(store),
  };

  const res = await executeFinancialTool("get_transaction_statistics", { month: 10, year: 2026 }, toolCtx);
  assert.equal(res.success, false);
  assert.match(res.summaryVi, /LỖI TRUY XUẤT CƠ SỞ DỮ LIỆU/);
  assert.match(res.summaryVi, /KHÔNG THỂ XÁC MINH số lượng giao dịch/);
  assert.match(res.summaryVi, /Tuyệt đối không tự bịa đặt hay giả định con số/);
});

// ---------------------------------------------------------------------------
// TEST 12: Immediate update upon mutation (Add / Edit / Delete)
// ---------------------------------------------------------------------------

test("Scenario: Mutation changes (add, edit date, delete) immediately update query results", async () => {
  const USER_ID = "user-mutation-test";

  const store = {
    transactions: [
      { id: "tx-init", user_id: USER_ID, title: "Ăn sáng", amount: 30000, type: "expense", occurred_at: "2026-10-01T08:00:00.000Z" },
    ],
    transfers: [],
    recurring_transactions: [],
    wallets: [],
  };

  const toolCtx = {
    supabaseUrl: "mock",
    supabaseKey: "mock",
    token: "mock",
    userId: USER_ID,
    client: createMockSupabase(store),
  };

  // Step 1: Initial state -> 1 transaction
  const step1 = await executeFinancialTool("get_transaction_statistics", { month: 10, year: 2026 }, toolCtx);
  assert.equal(step1.data.periodTransactionCount, 1);

  // Step 2: User adds a transaction
  store.transactions.push({
    id: "tx-new",
    user_id: USER_ID,
    title: "Ăn trưa",
    amount: 50000,
    type: "expense",
    occurred_at: "2026-10-05T08:00:00.000Z",
  });
  const step2 = await executeFinancialTool("get_transaction_statistics", { month: 10, year: 2026 }, toolCtx);
  assert.equal(step2.data.periodTransactionCount, 2, "Ngay sau khi thêm phải cập nhật lên 2");

  // Step 3: User edits transaction date to November (outside October)
  const targetTx = store.transactions.find((t) => t.id === "tx-new");
  targetTx.occurred_at = "2026-11-05T08:00:00.000Z";
  const step3 = await executeFinancialTool("get_transaction_statistics", { month: 10, year: 2026 }, toolCtx);
  assert.equal(step3.data.periodTransactionCount, 1, "Sau khi sửa ngày sang tháng 11, tháng 10 chỉ còn 1");
  assert.equal(step3.data.totalAccountTransactions, 2, "Tổng tài khoản vẫn là 2");

  // Step 4: User deletes transaction
  store.transactions = store.transactions.filter((t) => t.id !== "tx-init");
  const step4 = await executeFinancialTool("get_transaction_statistics", { month: 10, year: 2026 }, toolCtx);
  assert.equal(step4.data.periodTransactionCount, 0, "Sau khi xóa, tháng 10 trở về 0");
  assert.equal(step4.data.totalAccountTransactions, 1);
});

// ---------------------------------------------------------------------------
// TEST 13: Server Financial Context Prompt Formatting
// ---------------------------------------------------------------------------

test("Prompt Formatting: Server context clearly distinguishes monthly count from recent sample list", () => {
  const contextFixture = {
    userId: "user-prompt-test",
    asOf: "2026-10-28 03:00:00 (UTC+7)",
    currentPeriod: "Tháng 10/2026",
    previousPeriod: "Tháng 09/2026",
    timezone: "Asia/Ho_Chi_Minh (UTC+7)",
    primaryCurrency: "VND",
    balancesByCurrency: { VND: 5000000 },
    currentMonthIncome: 10000000,
    currentMonthExpense: 45000,
    currentMonthNetSavings: 9955000,
    currentMonthSavingsRate: 99,
    previousMonthIncome: 0,
    previousMonthExpense: 0,
    expenseChangeVsPreviousMonth: { difference: 45000, percentChange: null },
    topCategories: [],
    highestSpendingCategory: null,
    wallets: [],
    budgets: [],
    savingsGoals: [],
    // 1 transaction in current month, but total 10 across account
    currentMonthTransactionCount: 1,
    currentMonthExpenseCount: 1,
    currentMonthIncomeCount: 0,
    totalAccountTransactionCount: 10,
    // Sample list has 1 item
    recentTransactions: [
      { title: "Cơm trưa", amount: 45000, currency: "VND", type: "expense", category: "Ăn uống", date: "2026-10-15" },
    ],
    whatIfContext: { sample500kImpacts: [] },
    hasSufficientData: true,
  };

  const formattedPrompt = formatServerFinancialContextForPrompt(
    contextFixture,
    "Tháng này tôi có bao nhiêu giao dịch?",
  );

  // Must contain accurate counts and clear boundary rules
  assert.match(formattedPrompt, /Số lượng giao dịch trong Tháng 10\/2026: 1 giao dịch/);
  assert.match(formattedPrompt, /Tổng số giao dịch toàn tài khoản \(mọi thời điểm\): 10 giao dịch/);
  assert.match(formattedPrompt, /BẮT BUỘC trả lời chính xác 1 giao dịch/);
  assert.doesNotMatch(formattedPrompt, /TỔNG 10 GIAO DỊCH/);
});

