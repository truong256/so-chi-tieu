/**
 * tests/savings-goal-reasoning.test.mjs
 * ====================================
 * Comprehensive Test Suite for Savings Goal Reasoning in Sổ Chi Tiêu.
 *
 * Verifies Requirements:
 * 1. Intent flow: SAVINGS_GOAL_PLAN, SAVINGS_PLANNING, and parser extraction.
 * 2. Distinction: Target Goal (500k) vs Save Additional (500k) vs Already Saved.
 * 3. User-scoped actual data: income, expenses, wallets, budgets, savings goals, upcoming obligations.
 * 4. Zero expense / data limitations: Never conclude 100% savings rate merely because expense is 0.
 * 5. Backend calculations: available liquidity, max spending allowed, feasibility, shortfall.
 * 6. Recommendations: Concrete wallet allocation when feasible; ONLY advise cutting expense/increasing income on shortfall.
 * 7. Safety invariant: Never create automatic transactions or transfer funds without user confirmation.
 * 8. Edge cases: Zero data, missing data, wallet < income, achieved goals, unachieved goals, multi-turn, conflicting obligations.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  parseBudgetPlanQuery,
  createBudgetConstrainedPlan,
  verifyAndSanitizeBudgetPlan,
} from "../backend/src/services/budget-planning.service.ts";
import { routeUserIntent } from "../backend/src/services/ai-router.service.ts";
import { formatServerFinancialContextForPrompt } from "../backend/src/services/financial-context.service.ts";
import { detectMultiTurnReference } from "../backend/src/services/financial-simulation.service.ts";

// ---------------------------------------------------------------------------
// Fixture Builders
// ---------------------------------------------------------------------------

function buildMockSnapshot(options = {}) {
  const totalAssets = options.totalAssets ?? 4_104_000;
  const totalAllocated = options.totalAllocated ?? 645_000;
  const totalAvailable = options.totalAvailable ?? 3_459_000;

  return {
    totalAssets,
    totalAllocated,
    totalAvailable,
    primaryCurrency: "VND",
    byCurrency: {
      VND: {
        currency: "VND",
        totalAssets,
        totalAllocated,
        totalAvailable,
        wallets: [],
      },
    },
    walletBalances: new Map(),
    walletReservedMap: new Map(),
    availableBalances: new Map(),
    enrichedWallets: options.enrichedWallets || [
      {
        id: "w-cash",
        name: "Ví Tiền mặt",
        type: "cash",
        currency: "VND",
        rawBalance: 645_000,
        balance: 645_000,
        reservedAmount: 345_000,
        availableBalance: 300_000,
      },
      {
        id: "w-bank",
        name: "Tài khoản Techcombank",
        type: "bank",
        currency: "VND",
        rawBalance: 3_459_000,
        balance: 3_459_000,
        reservedAmount: 300_000,
        availableBalance: 3_159_000,
      },
    ],
  };
}

function buildMockServerContext(options = {}) {
  const snapshot = buildMockSnapshot(options);
  const currentMonthExpenseCount = options.currentMonthExpenseCount ?? 1;
  const hasExpenses = currentMonthExpenseCount > 0;
  const currentMonthIncome = options.currentMonthIncome ?? 10_000_000;
  const currentMonthExpense = options.currentMonthExpense ?? (hasExpenses ? 2_650_000 : 0);
  const isLimited = options.databaseQueryError || options.hasSufficientData === false;
  const currentMonthSavingsRate = isLimited ? null : (hasExpenses && currentMonthIncome > 0 ? Math.round(((currentMonthIncome - currentMonthExpense) / currentMonthIncome) * 100) : null);

  return {
    userId: options.userId || "user-test-uuid-1",
    asOf: "2026-10-28 20:00:00 (UTC+7)",
    currentPeriod: "Tháng 10/2026",
    previousPeriod: "Tháng 09/2026",
    timezone: "Asia/Ho_Chi_Minh (UTC+7)",
    primaryCurrency: "VND",
    totalAssets: snapshot.totalAssets,
    totalAllocated: snapshot.totalAllocated,
    totalAvailable: snapshot.totalAvailable,
    snapshot,
    balancesByCurrency: { VND: snapshot.totalAssets },
    expensesByCurrency: { VND: currentMonthExpense },
    incomesByCurrency: { VND: currentMonthIncome },
    previousExpensesByCurrency: { VND: 2_000_000 },
    previousIncomesByCurrency: { VND: 10_000_000 },
    currentMonthIncome,
    currentMonthExpense,
    currentMonthNetSavings: currentMonthIncome - currentMonthExpense,
    currentMonthSavingsRate,
    savingsRateStatus: isLimited ? "DATA_LIMITED" : (hasExpenses ? "NORMAL" : "NO_EXPENSES_LOGGED"),
    savingsRateNotice: hasExpenses ? "" : "Chưa có giao dịch chi tiêu nào được ghi nhận trong kỳ (0 giao dịch). Cấm mặc định kết luận tỷ lệ tiết kiệm đạt 100%.",
    previousMonthIncome: 10_000_000,
    previousMonthExpense: 2_000_000,
    expenseChangeVsPreviousMonth: { difference: 650_000, percentChange: 32.5 },
    topCategories: [],
    highestSpendingCategory: null,
    wallets: snapshot.enrichedWallets,
    budgets: options.budgets || [
      {
        name: "Ngân sách Ăn uống",
        limit: 3_000_000,
        actualSpent: 2_650_000,
        limitRemaining: 350_000,
        percentUsed: 88.3,
        allocated: 0,
        fundedRemaining: 0,
        isFunded: false,
        isOutOfFunds: false,
        status: "active",
        isOverLimit: false,
        isNearLimit: true,
        isReachedLimit: false,
        amount: 3_000_000,
        spent_amount: 2_650_000,
        remaining_amount: 350_000,
        isOverBudget: false,
      },
    ],
    savingsGoals: options.savingsGoals || [
      {
        id: "goal-1",
        title: "Quỹ tiết kiệm dự phòng",
        target_amount: 10_000_000,
        current_amount: 300_000,
        percentProgress: 3,
        deadline: "2026-12-31",
        source_wallet_id: "w-cash",
        reserved_in_wallet: 300_000,
      },
    ],
    upcomingObligations: options.upcomingObligations || [],
    upcomingObligationsTotal: options.upcomingObligationsTotal ?? (options.upcomingObligations ? options.upcomingObligations.reduce((s, o) => s + o.amount, 0) : 0),
    currentMonthTransactionCount: options.currentMonthTransactionCount ?? 5,
    currentMonthExpenseCount,
    currentMonthIncomeCount: options.currentMonthIncomeCount ?? 1,
    totalAccountTransactionCount: options.totalAccountTransactionCount ?? 20,
    recentTransactions: [],
    whatIfContext: { sample500kImpacts: [] },
    hasSufficientData: options.hasSufficientData ?? true,
    databaseQueryError: options.databaseQueryError ?? false,
  };
}

// ---------------------------------------------------------------------------
// TEST GROUP 1: Intent Routing & Parser Distinction
// ---------------------------------------------------------------------------

test("SG-01: Distinguishes 'Mục tiêu tiết kiệm 500k' as TARGET_GOAL", () => {
  const parsed = parseBudgetPlanQuery("Tôi muốn đặt mục tiêu tiết kiệm 500.000đ");
  assert.ok(parsed !== null);
  assert.equal(parsed.scope, "SAVINGS_GOAL_PLAN");
  assert.equal(parsed.savingsMode, "TARGET_GOAL");
  assert.equal(parsed.budget, 500_000);
});

test("SG-02: Distinguishes 'Tiết kiệm thêm 500.000đ' as ADDITIONAL_SAVINGS", () => {
  const parsed = parseBudgetPlanQuery("Tôi muốn tiết kiệm thêm 500.000đ vào quỹ");
  assert.ok(parsed !== null);
  assert.equal(parsed.scope, "SAVINGS_GOAL_PLAN");
  assert.equal(parsed.savingsMode, "ADDITIONAL_SAVINGS");
  assert.equal(parsed.budget, 500_000);
});

test("SG-03: Distinguishes 'Tôi đã tiết kiệm được bao nhiêu?' as SAVINGS_STATUS", () => {
  const parsed = parseBudgetPlanQuery("Tôi đã tiết kiệm được bao nhiêu tiền rồi?");
  assert.ok(parsed !== null);
  assert.equal(parsed.scope, "SAVINGS_GOAL_PLAN");
  assert.equal(parsed.savingsMode, "SAVINGS_STATUS");
});

test("SG-04: Distinguishes 'Tháng này tôi có thể tiết kiệm được bao nhiêu?' as MAX_SAVINGS_CAPACITY", () => {
  const parsed = parseBudgetPlanQuery("Tháng này tôi có thể tiết kiệm được bao nhiêu?");
  assert.ok(parsed !== null);
  assert.equal(parsed.scope, "SAVINGS_GOAL_PLAN");
  assert.equal(parsed.savingsMode, "MAX_SAVINGS_CAPACITY");
});

test("SG-05: System definition query does NOT get routed to savings calculation", () => {
  const parsed = parseBudgetPlanQuery("Sự khác biệt giữa Ngân sách và Mục tiêu tiết kiệm là gì?");
  assert.equal(parsed, null);

  const routing = routeUserIntent("Sự khác biệt giữa Ngân sách và Mục tiêu tiết kiệm là gì?");
  assert.equal(routing.primaryIntent, "SYSTEM_KNOWLEDGE");
});

// ---------------------------------------------------------------------------
// TEST GROUP 2: Zero Data & Incomplete Data Audit (Requirement 4)
// ---------------------------------------------------------------------------

test("SG-06: Zero expense transactions MUST NOT conclude 100% savings rate", () => {
  const serverContext = buildMockServerContext({
    currentMonthIncome: 15_000_000,
    currentMonthExpense: 0,
    currentMonthExpenseCount: 0,
    currentMonthTransactionCount: 0,
  });

  assert.equal(serverContext.currentMonthSavingsRate, null);
  assert.equal(serverContext.savingsRateStatus, "NO_EXPENSES_LOGGED");

  const promptFormatted = formatServerFinancialContextForPrompt(serverContext);
  assert.ok(!promptFormatted.includes("Tỷ lệ tiết kiệm (VND): 100%"));
  assert.ok(promptFormatted.includes("Chưa có giao dịch chi tiêu"));
  assert.ok(promptFormatted.includes("CẤM kết luận tỷ lệ tiết kiệm 100%"));
});

test("SG-07: Database query failure emits DATA_LIMITED notice and does not invent numbers", () => {
  const serverContext = buildMockServerContext({
    databaseQueryError: true,
    hasSufficientData: false,
  });

  assert.equal(serverContext.currentMonthSavingsRate, null);

  const plan = createBudgetConstrainedPlan(
    {
      scope: "SAVINGS_GOAL_PLAN",
      budget: 500_000,
      days: 30,
      useRemainingFunds: false,
      rawText: "Mục tiêu 500k",
      savingsMode: "TARGET_GOAL",
    },
    { serverContext },
  );

  assert.equal(plan.savingsDetails.feasibilityStatus, "DATA_LIMITED");
  assert.ok(plan.summaryMarkdown.includes("Cảnh báo: Dữ liệu tài chính chưa tải đầy đủ"));
});

// ---------------------------------------------------------------------------
// TEST GROUP 3: Target Goal vs Additional Savings vs Already Saved (Requirement 2 & 5)
// ---------------------------------------------------------------------------

test("SG-08: TARGET_GOAL: Target 500k with 300k already saved requires only 200k to reach target", () => {
  const serverContext = buildMockServerContext({
    savingsGoals: [
      {
        id: "g-laptop",
        title: "Quỹ tiết kiệm",
        target_amount: 1_000_000,
        current_amount: 300_000,
        percentProgress: 30,
        deadline: null,
      },
    ],
  });

  const plan = createBudgetConstrainedPlan(
    {
      scope: "SAVINGS_GOAL_PLAN",
      budget: 500_000,
      days: 30,
      useRemainingFunds: false,
      rawText: "Mục tiêu tiết kiệm 500.000đ",
      savingsMode: "TARGET_GOAL",
    },
    { serverContext },
  );

  assert.equal(plan.savingsDetails.mode, "TARGET_GOAL");
  assert.equal(plan.savingsDetails.targetAmount, 500_000);
  assert.equal(plan.savingsDetails.currentSavedAmount, 300_000);
  assert.equal(plan.savingsDetails.effectiveRequiredAmount, 200_000); // 500k - 300k = 200k
  assert.equal(plan.savingsDetails.isAchieved, undefined);
  assert.equal(plan.isFeasible, true);
  assert.equal(plan.savingsDetails.shortfall, 0);
  assert.ok(plan.summaryMarkdown.includes("Số tiền cần bổ sung để về đích"));
  assert.ok(plan.summaryMarkdown.includes("200.000 VND"));
});

test("SG-09: ADDITIONAL_SAVINGS: Save additional 500k with 300k already saved requires exactly 500k and yields 800k total", () => {
  const serverContext = buildMockServerContext({
    savingsGoals: [
      {
        id: "g-1",
        title: "Quỹ tiết kiệm",
        target_amount: 1_000_000,
        current_amount: 300_000,
        percentProgress: 30,
        deadline: null,
      },
    ],
  });

  const plan = createBudgetConstrainedPlan(
    {
      scope: "SAVINGS_GOAL_PLAN",
      budget: 500_000,
      days: 30,
      useRemainingFunds: false,
      rawText: "Tôi muốn tiết kiệm thêm 500.000đ",
      savingsMode: "ADDITIONAL_SAVINGS",
    },
    { serverContext },
  );

  assert.equal(plan.savingsDetails.mode, "ADDITIONAL_SAVINGS");
  assert.equal(plan.savingsDetails.effectiveRequiredAmount, 500_000);
  assert.equal(plan.savingsDetails.currentSavedAmount, 300_000);
  assert.ok(plan.summaryMarkdown.includes("Tổng tiền tích lũy dự kiến sau khi trích"));
  assert.ok(plan.summaryMarkdown.includes("800.000 VND"));
  assert.ok(plan.summaryMarkdown.includes("Trích thêm ngoài số tiền đã tích lũy"));
});

test("SG-10: SAVINGS_STATUS: Reports accumulated savings and list of goals without setting targets", () => {
  const serverContext = buildMockServerContext({
    totalAllocated: 645_000,
    savingsGoals: [
      {
        id: "g-1",
        title: "Mua iPhone 16",
        target_amount: 25_000_000,
        current_amount: 5_000_000,
        percentProgress: 20,
        deadline: "2026-12-31",
      },
      {
        id: "g-2",
        title: "Quỹ khẩn cấp",
        target_amount: 10_000_000,
        current_amount: 3_000_000,
        percentProgress: 30,
        deadline: null,
      },
    ],
  });

  const plan = createBudgetConstrainedPlan(
    {
      scope: "SAVINGS_GOAL_PLAN",
      days: 30,
      useRemainingFunds: false,
      rawText: "Tôi đã tiết kiệm được bao nhiêu?",
      savingsMode: "SAVINGS_STATUS",
    },
    { serverContext },
  );

  assert.equal(plan.savingsDetails.mode, "SAVINGS_STATUS");
  assert.equal(plan.savingsDetails.currentSavedAmount, 8_000_000); // 5m + 3m
  assert.ok(plan.summaryMarkdown.includes("8.000.000 VND"));
  assert.ok(plan.summaryMarkdown.includes("Mua iPhone 16"));
  assert.ok(plan.summaryMarkdown.includes("Quỹ khẩn cấp"));
});

// ---------------------------------------------------------------------------
// TEST GROUP 4: Liquidity, Wallet vs Income & Shortfalls (Requirements 3 & 5)
// ---------------------------------------------------------------------------

test("SG-11: Wallet balance lower than income evaluates against available cash, NOT income", () => {
  // User earned 20m, but spent/transferred 18.5m, so wallet available is only 1.5m
  const serverContext = buildMockServerContext({
    currentMonthIncome: 20_000_000,
    currentMonthExpense: 18_500_000,
    totalAssets: 1_845_000,
    totalAllocated: 345_000,
    totalAvailable: 1_500_000,
    savingsGoals: [], // No existing goal, starting from 0
    enrichedWallets: [
      {
        id: "w-cash",
        name: "Ví Tiền mặt",
        type: "cash",
        currency: "VND",
        rawBalance: 1_845_000,
        balance: 1_845_000,
        reservedAmount: 345_000,
        availableBalance: 1_500_000,
      },
    ],
  });

  const plan = createBudgetConstrainedPlan(
    {
      scope: "SAVINGS_GOAL_PLAN",
      budget: 3_000_000,
      days: 30,
      useRemainingFunds: false,
      rawText: "Tôi có đủ tiền để tiết kiệm 3 triệu không?",
      savingsMode: "TARGET_GOAL",
    },
    { serverContext },
  );

  // Available is 1.5m, required is 3m (assuming 0 saved for this new target)
  // Shortfall = 1.5m
  assert.equal(plan.isFeasible, false);
  assert.equal(plan.savingsDetails.feasibilityStatus, "INSUFFICIENT_FUNDS_SHORTFALL");
  assert.equal(plan.savingsDetails.shortfall, 1_500_000);
  assert.ok(plan.summaryMarkdown.includes("Còn thiếu"));
  assert.ok(plan.summaryMarkdown.includes("1.500.000 VND"));
  assert.ok(plan.summaryMarkdown.includes("CHƯA ĐỦ TIỀN ĐỂ ĐẠT MỤC TIÊU"));
});

test("SG-12: Goal already achieved (current_amount >= target_amount)", () => {
  const serverContext = buildMockServerContext({
    savingsGoals: [
      {
        id: "g-1",
        title: "Học phí",
        target_amount: 500_000,
        current_amount: 600_000,
        percentProgress: 120,
        deadline: null,
      },
    ],
  });

  const plan = createBudgetConstrainedPlan(
    {
      scope: "SAVINGS_GOAL_PLAN",
      budget: 500_000,
      days: 30,
      useRemainingFunds: false,
      rawText: "Mục tiêu 500k đã đạt chưa?",
      savingsMode: "TARGET_GOAL",
    },
    { serverContext },
  );

  assert.equal(plan.savingsDetails.feasibilityStatus, "ALREADY_ACHIEVED");
  assert.equal(plan.isFeasible, true);
  assert.equal(plan.savingsDetails.shortfall, 0);
  assert.ok(plan.summaryMarkdown.includes("MỤC TIÊU ĐÃ HOÀN THÀNH"));
  assert.ok(plan.summaryMarkdown.includes("Bạn không cần phải trích thêm tiền"));
});

// ---------------------------------------------------------------------------
// TEST GROUP 5: Recommendation Quality & Conflicting Obligations (Requirement 6 & 8)
// ---------------------------------------------------------------------------

test("SG-13: When feasible, proposes concrete wallet allocation and does NOT advise reducing expenses", () => {
  const serverContext = buildMockServerContext({
    totalAvailable: 3_459_000,
    enrichedWallets: [
      {
        id: "w-cash",
        name: "Ví Tiền mặt",
        type: "cash",
        currency: "VND",
        rawBalance: 645_000,
        balance: 645_000,
        reservedAmount: 345_000,
        availableBalance: 300_000,
      },
      {
        id: "w-bank",
        name: "Tài khoản Techcombank",
        type: "bank",
        currency: "VND",
        rawBalance: 3_459_000,
        balance: 3_459_000,
        reservedAmount: 300_000,
        availableBalance: 3_159_000,
      },
    ],
  });

  const plan = createBudgetConstrainedPlan(
    {
      scope: "SAVINGS_GOAL_PLAN",
      budget: 1_000_000,
      days: 30,
      useRemainingFunds: false,
      rawText: "Tôi muốn tiết kiệm 1 triệu",
      savingsMode: "ADDITIONAL_SAVINGS",
    },
    { serverContext },
  );

  assert.equal(plan.isFeasible, true);
  assert.equal(plan.savingsDetails.recommendedWalletName, "Tài khoản Techcombank");
  assert.ok(plan.summaryMarkdown.includes("Trích **1.000.000 VND** từ **Tài khoản Techcombank**"));
  assert.ok(plan.summaryMarkdown.includes("HOÀN TOÀN ĐỦ TIỀN"));
  assert.ok(!plan.summaryMarkdown.includes("cần gia tăng thu nhập hoặc cắt giảm"));
});

test("SG-14: Upcoming recurring obligations are factored in and protected", () => {
  const serverContext = buildMockServerContext({
    totalAvailable: 800_000,
    upcomingObligationsTotal: 500_000,
    upcomingObligations: [
      {
        id: "rec-1",
        title: "Tiền mạng Internet FPT",
        amount: 300_000,
        frequency: "monthly",
        nextRunAt: "2026-11-01",
        type: "expense",
      },
      {
        id: "rec-2",
        title: "Gói bảo hiểm",
        amount: 200_000,
        frequency: "monthly",
        nextRunAt: "2026-11-05",
        type: "expense",
      },
    ],
  });

  // User has 800k available. Recurring obligations total 500k. Discretionary = 300k.
  // Saving 600k leaves only 200k, not enough to cover the 500k bills!
  const plan = createBudgetConstrainedPlan(
    {
      scope: "SAVINGS_GOAL_PLAN",
      budget: 600_000,
      days: 30,
      useRemainingFunds: false,
      rawText: "Tôi có thể tiết kiệm 600k không?",
      savingsMode: "ADDITIONAL_SAVINGS",
    },
    { serverContext },
  );

  assert.equal(plan.savingsDetails.discretionaryAvailable, 300_000);
  assert.equal(plan.savingsDetails.feasibilityStatus, "FEASIBLE_WITH_BUDGET_DISCIPLINE");
  assert.ok(plan.summaryMarkdown.includes("Nghĩa vụ chi định kỳ sắp tới"));
  assert.ok(plan.summaryMarkdown.includes("500.000 VND"));
});

// ---------------------------------------------------------------------------
// TEST GROUP 6: Multi-Turn Continuity (Requirement 8)
// ---------------------------------------------------------------------------

test("SG-15: Multi-turn reference: 'Với số tiền còn lại đó tôi có tiết kiệm được 200k không?'", () => {
  const history = [
    { role: "user", parts: [{ text: "Tiền mặt tôi còn bao nhiêu tiền?" }] },
    { role: "assistant", parts: [{ text: "Ví tiền mặt của bạn có số dư 645.000 VND, khả dụng là 300.000 VND." }] },
  ];

  const multiTurn = detectMultiTurnReference("Với số tiền còn lại đó tôi có tiết kiệm được 200k không?", history);
  assert.equal(multiTurn.hasReference, true);
  assert.equal(multiTurn.referenceType, "PLANNING_WITH_REMAINING");

  const parsed = parseBudgetPlanQuery(
    "Với số tiền còn lại đó tôi có tiết kiệm được 200k không?",
    history,
    multiTurn,
  );
  assert.ok(parsed !== null);
  assert.equal(parsed.scope, "SAVINGS_GOAL_PLAN");
  assert.equal(parsed.useRemainingFunds, true);
  assert.equal(parsed.budget, 200_000);

  const serverContext = buildMockServerContext();
  const plan = createBudgetConstrainedPlan(parsed, {
    serverContext,
    snapshot: serverContext.snapshot,
  });

  // Cash wallet available is 300.000 VND -> saving 200.000 VND is feasible!
  assert.equal(plan.isFeasible, true);
  assert.ok(plan.summaryMarkdown.includes("HOÀN TOÀN ĐỦ TIỀN"));
});

test("SG-16: Multi-turn reference with shortfall: 'Với số tiền còn lại đó tôi có tiết kiệm được 500k không?'", () => {
  const history = [
    { role: "user", parts: [{ text: "Tiền mặt tôi còn bao nhiêu tiền?" }] },
    { role: "assistant", parts: [{ text: "Ví tiền mặt của bạn có khả dụng là 300.000 VND." }] },
  ];

  const multiTurn = detectMultiTurnReference("Với số tiền còn lại đó tôi có tiết kiệm được 500k không?", history);
  const parsed = parseBudgetPlanQuery(
    "Với số tiền còn lại đó tôi có tiết kiệm được 500k không?",
    history,
    multiTurn,
  );

  const serverContext = buildMockServerContext();
  const plan = createBudgetConstrainedPlan(parsed, {
    serverContext,
    snapshot: serverContext.snapshot,
    activePurchaseSimulationRemaining: 300_000,
  });

  assert.equal(plan.isFeasible, false);
  assert.equal(plan.savingsDetails.shortfall, 200_000); // 500k - 300k = 200k shortfall
  assert.ok(plan.summaryMarkdown.includes("Còn thiếu"));
  assert.ok(plan.summaryMarkdown.includes("200.000 VND"));
});

// ---------------------------------------------------------------------------
// TEST GROUP 7: Guardrail Sanitization & Security (Requirement 7 & 10)
// ---------------------------------------------------------------------------

test("SG-17: Guardrail sanitizes LLM hallucinating 100% savings rate when zero expenses recorded", () => {
  const serverContext = buildMockServerContext({
    currentMonthExpenseCount: 0,
    currentMonthExpense: 0,
  });

  const verifiedPlan = createBudgetConstrainedPlan(
    {
      scope: "SAVINGS_GOAL_PLAN",
      budget: 500_000,
      days: 30,
      useRemainingFunds: false,
      rawText: "Mục tiêu 500k",
      savingsMode: "TARGET_GOAL",
    },
    { serverContext },
  );

  const badLlmOutput = "Chúc mừng bạn! Bạn đang tiết kiệm được 100% thu nhập vì chưa tiêu đồng nào.";
  const sanitized = verifyAndSanitizeBudgetPlan(badLlmOutput, verifiedPlan.constraints, verifiedPlan);

  assert.equal(sanitized.corrected, true);
  assert.ok(sanitized.reasons.some((r) => r.includes("100%")));
  assert.equal(sanitized.sanitizedText, verifiedPlan.summaryMarkdown);
});

test("SG-18: Guardrail sanitizes false LLM claims of automatic transaction execution", () => {
  const serverContext = buildMockServerContext();
  const verifiedPlan = createBudgetConstrainedPlan(
    {
      scope: "SAVINGS_GOAL_PLAN",
      budget: 500_000,
      days: 30,
      useRemainingFunds: false,
      rawText: "Mục tiêu 500k",
      savingsMode: "TARGET_GOAL",
    },
    { serverContext },
  );

  const badLlmOutput = "Tôi đã tạo giao dịch trích 500.000 VND từ ví tiền mặt của bạn vào quỹ tiết kiệm thành công.";
  const sanitized = verifyAndSanitizeBudgetPlan(badLlmOutput, verifiedPlan.constraints, verifiedPlan);

  assert.equal(sanitized.corrected, true);
  assert.ok(sanitized.reasons.some((r) => r.includes("chuyển tiền/tạo giao dịch")));
  assert.equal(sanitized.sanitizedText, verifiedPlan.summaryMarkdown);
});

test("SG-19: Guardrail sanitizes false sufficiency claim when account is in shortfall", () => {
  const serverContext = buildMockServerContext({
    totalAvailable: 200_000,
  });

  const verifiedPlan = createBudgetConstrainedPlan(
    {
      scope: "SAVINGS_GOAL_PLAN",
      budget: 1_000_000,
      days: 30,
      useRemainingFunds: false,
      rawText: "Mục tiêu 1 triệu",
      savingsMode: "ADDITIONAL_SAVINGS",
    },
    { serverContext },
  );

  assert.equal(verifiedPlan.isFeasible, false);

  const badLlmOutput = "Bạn hoàn toàn đủ tiền để tiết kiệm thêm 1 triệu VND ngay lúc này.";
  const sanitized = verifyAndSanitizeBudgetPlan(badLlmOutput, verifiedPlan.constraints, verifiedPlan);

  assert.equal(sanitized.corrected, true);
  assert.ok(sanitized.reasons.some((r) => r.includes("thiếu hụt")));
});

test("SG-20: Safety notice invariant is present in every plan output", () => {
  const plan = createBudgetConstrainedPlan({
    scope: "SAVINGS_GOAL_PLAN",
    budget: 500_000,
    days: 30,
    useRemainingFunds: false,
    rawText: "Tiết kiệm 500k",
  });

  assert.ok(plan.summaryMarkdown.includes("Sổ Chi Tiêu không tự ý thực hiện giao dịch hay chuyển tiền"));
  assert.ok(plan.savingsDetails.safetyNotice.includes("không tự ý thực hiện giao dịch"));
});
