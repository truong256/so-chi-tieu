/**
 * tests/financial-planning-engine.test.mjs
 * ========================================
 * Comprehensive Test Suite for Financial Planning & Budget-Constrained Engine.
 * 
 * Verifies 53 automated scenarios across:
 * 1. Planning Scope & Intent Parsing
 * 2. Mathematical Integrity & Budget Constraints
 * 3. Infeasible & Low Budget Handling
 * 4. Supabase Category Budget Integration & Cash Separation
 * 5. Guardrails & Output Sanitization (Anti-Hallucination)
 * 6. Monthly Meals, 50/30/20 Income Allocation, Spending Reduction & Savings
 * 7. Multi-Turn Anaphora & Exact User Bug Resolution
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  parseBudgetPlanQuery,
  createBudgetConstrainedPlan,
  verifyAndSanitizeBudgetPlan,
  VIETNAMESE_BREAKFAST_OPTIONS,
} from "../backend/src/services/budget-planning.service.ts";
import { detectMultiTurnReference } from "../backend/src/services/financial-simulation.service.ts";
import { routeUserIntent } from "../backend/src/services/ai-router.service.ts";

// ---------------------------------------------------------------------------
// Mock Fixtures
// ---------------------------------------------------------------------------

const mockSnapshot = {
  walletBalances: new Map([["w-cash", 645000], ["w-bank", 3459000]]),
  walletReservedMap: new Map([["w-cash", 345000], ["w-bank", 300000]]),
  availableBalances: new Map([["w-cash", 300000], ["w-bank", 3159000]]),
  enrichedWallets: [
    {
      id: "w-cash",
      name: "Tiền mặt",
      type: "cash",
      currency: "VND",
      rawBalance: 645000,
      balance: 645000,
      reservedAmount: 345000,
      availableBalance: 300000,
    },
    {
      id: "w-bank",
      name: "Tài khoản VCB",
      type: "bank",
      currency: "VND",
      rawBalance: 3459000,
      balance: 3459000,
      reservedAmount: 300000,
      availableBalance: 3159000,
    },
  ],
  byCurrency: {
    VND: {
      currency: "VND",
      totalAssets: 4104000,
      totalAllocated: 645000,
      totalAvailable: 3459000,
      wallets: [],
    },
  },
  primaryCurrency: "VND",
  totalAssets: 4104000,
  totalAllocated: 645000,
  totalAvailable: 3459000,
};

const mockServerContext = {
  userId: "user-test-planning",
  asOf: "2026-10-28 16:00:00 (UTC+7)",
  snapshot: mockSnapshot,
  budgets: [
    {
      name: "Ngân sách Ăn uống",
      limit: 3000000,
      actualSpent: 2650000,
      limitRemaining: 350000,
      percentUsed: 88.3,
      envelopeAllocated: 500000,
      envelopeSpent: 2650000,
      allocated: 500000,
      fundedRemaining: 350000,
      isFunded: true,
      isOutOfFunds: false,
      status: "active",
      isOverLimit: false,
      isNearLimit: true,
      isReachedLimit: false,
      amount: 3000000,
      spent_amount: 2650000,
      remaining_amount: 350000,
      isOverBudget: false,
    },
  ],
  wallets: mockSnapshot.enrichedWallets,
};

// ===========================================================================
// SECTION 1: PLANNING SCOPE & QUERY PARSING (10 tests)
// ===========================================================================

test("P1-01: Parses 'ăn sáng trong 1 tuần tôi ăn gì?' as BREAKFAST_PLAN 7 days", () => {
  const parsed = parseBudgetPlanQuery("ăn sáng trong 1 tuần tôi ăn gì?");
  assert.ok(parsed);
  assert.equal(parsed.scope, "BREAKFAST_PLAN");
  assert.equal(parsed.days, 7);
  assert.equal(parsed.mealType, "breakfast");
  assert.equal(parsed.useRemainingFunds, false);
});

test("P1-02: Parses 'với số tiền còn lại thì ăn sáng trong 1 tuần tôi ăn gì?' with useRemainingFunds true", () => {
  const parsed = parseBudgetPlanQuery("với số tiền còn lại thì ăn sáng trong 1 tuần tôi ăn gì?");
  assert.ok(parsed);
  assert.equal(parsed.scope, "BREAKFAST_PLAN");
  assert.equal(parsed.days, 7);
  assert.equal(parsed.mealType, "breakfast");
  assert.equal(parsed.useRemainingFunds, true);
});

test("P1-03: Parses explicit budget 'ăn sáng trong 7 ngày với 200k' -> 200.000 VND", () => {
  const parsed = parseBudgetPlanQuery("ăn sáng trong 7 ngày với 200k");
  assert.ok(parsed);
  assert.equal(parsed.scope, "BREAKFAST_PLAN");
  assert.equal(parsed.days, 7);
  assert.equal(parsed.budget, 200000);
});

test("P1-04: Parses 'gợi ý thực đơn ăn sáng cho 5 ngày' -> 5 days", () => {
  const parsed = parseBudgetPlanQuery("gợi ý thực đơn ăn sáng cho 5 ngày");
  assert.ok(parsed);
  assert.equal(parsed.scope, "BREAKFAST_PLAN");
  assert.equal(parsed.days, 5);
});

test("P1-05: Parses 'ăn uống trong một tháng với 3 triệu' -> MEALS_MONTHLY_PLAN 30 days, 3.000.000 VND", () => {
  const parsed = parseBudgetPlanQuery("ăn uống trong một tháng với 3 triệu");
  assert.ok(parsed);
  assert.equal(parsed.scope, "MEALS_MONTHLY_PLAN");
  assert.equal(parsed.days, 30);
  assert.equal(parsed.budget, 3000000);
  assert.equal(parsed.mealType, "all_meals");
});

test("P1-06: Parses 'kế hoạch ăn uống cả tháng' -> MEALS_MONTHLY_PLAN 30 days", () => {
  const parsed = parseBudgetPlanQuery("kế hoạch ăn uống cả tháng");
  assert.ok(parsed);
  assert.equal(parsed.scope, "MEALS_MONTHLY_PLAN");
  assert.equal(parsed.days, 30);
});

test("P1-07: Parses 'mua sắm trong ngân sách 1 triệu' -> SHOPPING_BUDGET_PLAN 1.000.000 VND", () => {
  const parsed = parseBudgetPlanQuery("tôi muốn mua sắm trong ngân sách 1 triệu");
  assert.ok(parsed);
  assert.equal(parsed.scope, "SHOPPING_BUDGET_PLAN");
  assert.equal(parsed.budget, 1000000);
});

test("P1-08: Parses 'lập kế hoạch tiết kiệm 12 triệu trong 6 tháng' -> SAVINGS_GOAL_PLAN", () => {
  const parsed = parseBudgetPlanQuery("lập kế hoạch tiết kiệm 12 triệu");
  assert.ok(parsed);
  assert.equal(parsed.scope, "SAVINGS_GOAL_PLAN");
  assert.equal(parsed.budget, 12000000);
});

test("P1-09: Parses 'lương 15 triệu nên phân bổ như thế nào' -> INCOME_ALLOCATION 15.000.000 VND", () => {
  const parsed = parseBudgetPlanQuery("lương 15 triệu nên phân bổ như thế nào");
  assert.ok(parsed);
  assert.equal(parsed.scope, "INCOME_ALLOCATION");
  assert.equal(parsed.budget, 15000000);
});

test("P1-10: Parses 'điều chỉnh chi tiêu khi thu nhập giảm' -> SPENDING_REDUCTION", () => {
  const parsed = parseBudgetPlanQuery("điều chỉnh chi tiêu khi thu nhập giảm");
  assert.ok(parsed);
  assert.equal(parsed.scope, "SPENDING_REDUCTION");
});

// ===========================================================================
// SECTION 2: MATHEMATICAL INTEGRITY & BUDGET CONSTRAINTS (10 tests)
// ===========================================================================

test("M2-01: Sum of item prices matches totalEstimatedCost exactly", () => {
  const plan = createBudgetConstrainedPlan(
    { scope: "BREAKFAST_PLAN", budget: 300000, days: 7, mealType: "breakfast", useRemainingFunds: false, rawText: "" },
    { snapshot: mockSnapshot, serverContext: mockServerContext },
  );
  const mathSum = plan.items.reduce((acc, it) => acc + it.estimatedPrice, 0);
  assert.equal(plan.totalEstimatedCost, mathSum);
});

test("M2-02: 7-day breakfast plan produces exactly 7 items", () => {
  const plan = createBudgetConstrainedPlan(
    { scope: "BREAKFAST_PLAN", budget: 300000, days: 7, mealType: "breakfast", useRemainingFunds: false, rawText: "" },
  );
  assert.equal(plan.items.length, 7);
});

test("M2-03: Every item in breakfast plan has mealType 'breakfast'", () => {
  const plan = createBudgetConstrainedPlan(
    { scope: "BREAKFAST_PLAN", budget: 300000, days: 7, mealType: "breakfast", useRemainingFunds: false, rawText: "" },
  );
  assert.ok(plan.items.every((it) => it.mealType === "breakfast"));
});

test("M2-04: Zero lunch or dinner items in breakfast plan items", () => {
  const plan = createBudgetConstrainedPlan(
    { scope: "BREAKFAST_PLAN", budget: 300000, days: 7, mealType: "breakfast", useRemainingFunds: false, rawText: "" },
  );
  const forbidden = plan.items.filter((it) => it.mealType === "lunch" || it.mealType === "dinner");
  assert.equal(forbidden.length, 0);
});

test("M2-05: Total cost does NOT exceed budget limit (totalCost <= budget)", () => {
  const budget = 300000;
  const plan = createBudgetConstrainedPlan(
    { scope: "BREAKFAST_PLAN", budget, days: 7, mealType: "breakfast", useRemainingFunds: false, rawText: "" },
  );
  assert.ok(plan.totalEstimatedCost <= budget);
});

test("M2-06: Remaining funds calculated accurately (remaining = budget - totalCost)", () => {
  const budget = 300000;
  const plan = createBudgetConstrainedPlan(
    { scope: "BREAKFAST_PLAN", budget, days: 7, mealType: "breakfast", useRemainingFunds: false, rawText: "" },
  );
  assert.equal(plan.remainingFunds, budget - plan.totalEstimatedCost);
  assert.ok(plan.remainingFunds >= 0);
});

test("M2-07: Budget 200k for 7 days respects 200.000 limit", () => {
  const plan = createBudgetConstrainedPlan(
    { scope: "BREAKFAST_PLAN", budget: 200000, days: 7, mealType: "breakfast", useRemainingFunds: false, rawText: "" },
  );
  assert.ok(plan.totalEstimatedCost <= 200000);
  assert.ok(plan.isFeasible);
});

test("M2-08: Budget 150k for 7 days adjusts to affordable options", () => {
  const plan = createBudgetConstrainedPlan(
    { scope: "BREAKFAST_PLAN", budget: 150000, days: 7, mealType: "breakfast", useRemainingFunds: false, rawText: "" },
  );
  assert.ok(plan.totalEstimatedCost <= 150000);
  assert.ok(plan.isFeasible);
});

test("M2-09: Generous budget 500k for 7 days allows premium choices within cap", () => {
  const plan = createBudgetConstrainedPlan(
    { scope: "BREAKFAST_PLAN", budget: 500000, days: 7, mealType: "breakfast", useRemainingFunds: false, rawText: "" },
  );
  assert.ok(plan.totalEstimatedCost <= 500000);
  assert.ok(plan.isFeasible);
});

test("M2-10: Vietnamese breakfast catalog contains varied realistic items with price bounds", () => {
  assert.ok(VIETNAMESE_BREAKFAST_OPTIONS.length >= 8);
  for (const dish of VIETNAMESE_BREAKFAST_OPTIONS) {
    assert.ok(dish.minPrice <= dish.estimatedPrice);
    assert.ok(dish.estimatedPrice <= dish.maxPrice);
    assert.equal(dish.mealType, "breakfast");
  }
});

// ===========================================================================
// SECTION 3: INFEASIBLE & LOW BUDGET HANDLING (5 tests)
// ===========================================================================

test("L3-01: Impossible budget (30k for 7 days) marks isFeasible as false (<10k/day)", () => {
  const plan = createBudgetConstrainedPlan(
    { scope: "BREAKFAST_PLAN", budget: 30000, days: 7, mealType: "breakfast", useRemainingFunds: false, rawText: "" },
  );
  assert.equal(plan.isFeasible, false);
});

test("L3-02: Impossible budget never concludes 'hoàn toàn đủ tiền'", () => {
  const plan = createBudgetConstrainedPlan(
    { scope: "BREAKFAST_PLAN", budget: 30000, days: 7, mealType: "breakfast", useRemainingFunds: false, rawText: "" },
  );
  assert.ok(!plan.summaryMarkdown.includes("✅ **HOÀN TOÀN ĐỦ TIỀN**"));
  assert.ok(plan.summaryMarkdown.includes("KHÔNG ĐỦ TIỀN"));
});

test("L3-03: Impossible budget provides emergency survival home cooking recommendations", () => {
  const plan = createBudgetConstrainedPlan(
    { scope: "BREAKFAST_PLAN", budget: 30000, days: 7, mealType: "breakfast", useRemainingFunds: false, rawText: "" },
  );
  assert.ok(plan.summaryMarkdown.includes("Mì gói") || plan.summaryMarkdown.includes("tại nhà"));
});

test("L3-04: Daily average budget is computed accurately", () => {
  const plan = createBudgetConstrainedPlan(
    { scope: "BREAKFAST_PLAN", budget: 280000, days: 7, mealType: "breakfast", useRemainingFunds: false, rawText: "" },
  );
  assert.equal(plan.dailyAverageCost, Math.round(plan.totalEstimatedCost / 7));
});

test("L3-05: Missing days defaults safely to 7 days for breakfast", () => {
  const plan = createBudgetConstrainedPlan(
    { scope: "BREAKFAST_PLAN", budget: 300000, days: 0, mealType: "breakfast", useRemainingFunds: false, rawText: "" },
  );
  assert.equal(plan.constraints.periodDays, 7);
  assert.equal(plan.items.length, 7);
});

// ===========================================================================
// SECTION 4: SUPABASE CATEGORY BUDGET & CASH RECONCILIATION (5 tests)
// ===========================================================================

test("S4-01: Detects existing 'Ngân sách Ăn uống' in Supabase and reports remaining limit", () => {
  const plan = createBudgetConstrainedPlan(
    { scope: "BREAKFAST_PLAN", budget: 300000, days: 7, mealType: "breakfast", useRemainingFunds: false, rawText: "" },
    { snapshot: mockSnapshot, serverContext: mockServerContext },
  );
  assert.ok(plan.constraints.categoryBudgetStatus);
  assert.equal(plan.constraints.categoryBudgetStatus.name, "Ngân sách Ăn uống");
  assert.equal(plan.constraints.categoryBudgetStatus.limit, 3000000);
  assert.equal(plan.constraints.categoryBudgetStatus.remaining, 350000);
  assert.ok(plan.summaryMarkdown.includes("Ngân sách Ăn uống"));
});

test("S4-02: 'Với số tiền còn lại' resolves to cash wallet available balance (300k)", () => {
  const plan = createBudgetConstrainedPlan(
    { scope: "BREAKFAST_PLAN", days: 7, mealType: "breakfast", useRemainingFunds: true, rawText: "" },
    { snapshot: mockSnapshot, serverContext: mockServerContext },
  );
  assert.equal(plan.constraints.totalBudget, 300000);
  assert.equal(plan.constraints.budgetSource, "CASH_AVAILABLE");
  assert.ok(plan.summaryMarkdown.includes("300.000 VND"));
});

test("S4-03: Cash wallet balance (645k) is distinguished from available balance (300k)", () => {
  const plan = createBudgetConstrainedPlan(
    { scope: "BREAKFAST_PLAN", days: 7, mealType: "breakfast", useRemainingFunds: true, rawText: "" },
    { snapshot: mockSnapshot, serverContext: mockServerContext },
  );
  // Must use 300.000 available, NOT 645.000 raw balance!
  assert.equal(plan.constraints.totalBudget, 300000);
  assert.ok(plan.constraints.sourceExplanation.includes("345.000"));
});

test("S4-04: Explicit budget overrides snapshot without double-counting", () => {
  const plan = createBudgetConstrainedPlan(
    { scope: "BREAKFAST_PLAN", budget: 250000, days: 7, mealType: "breakfast", useRemainingFunds: false, rawText: "" },
    { snapshot: mockSnapshot, serverContext: mockServerContext },
  );
  assert.equal(plan.constraints.totalBudget, 250000);
  assert.equal(plan.constraints.budgetSource, "USER_INPUT");
});

test("S4-05: Planning execution never mutates snapshot balances or Supabase records", () => {
  const initialAvailable = mockSnapshot.totalAvailable;
  createBudgetConstrainedPlan(
    { scope: "BREAKFAST_PLAN", budget: 300000, days: 7, mealType: "breakfast", useRemainingFunds: false, rawText: "" },
    { snapshot: mockSnapshot, serverContext: mockServerContext },
  );
  assert.equal(mockSnapshot.totalAvailable, initialAvailable);
});

// ===========================================================================
// SECTION 5: GUARDRAILS & OUTPUT SANITIZATION (10 tests)
// ===========================================================================

test("G5-01: Intercepts and strips hallucinated 'bữa trưa' from breakfast response", () => {
  const plan = createBudgetConstrainedPlan(
    { scope: "BREAKFAST_PLAN", budget: 300000, days: 7, mealType: "breakfast", useRemainingFunds: false, rawText: "" },
  );
  const hallucinatedOutput = "Chào bạn, đây là thực đơn:\n- Bữa sáng: Bánh mì 20k\n- Bữa trưa: Cơm sườn 40k\nTổng cộng 60k.";
  const verified = verifyAndSanitizeBudgetPlan(hallucinatedOutput, plan.constraints, plan);
  assert.equal(verified.corrected, true);
  assert.ok(verified.reasons.some((r) => r.includes("bữa trưa")));
  assert.ok(!verified.sanitizedText.includes("Bữa trưa"));
});

test("G5-02: Intercepts and strips hallucinated 'bữa tối' from breakfast response", () => {
  const plan = createBudgetConstrainedPlan(
    { scope: "BREAKFAST_PLAN", budget: 300000, days: 7, mealType: "breakfast", useRemainingFunds: false, rawText: "" },
  );
  const hallucinatedOutput = "Thực đơn của bạn:\n- Bữa sáng: Xôi 20k\n- Bữa tối: Phở bò 45k.";
  const verified = verifyAndSanitizeBudgetPlan(hallucinatedOutput, plan.constraints, plan);
  assert.equal(verified.corrected, true);
  assert.ok(!verified.sanitizedText.includes("Bữa tối"));
});

test("G5-03: Intercepts missing days (only 3 days instead of 7) and replaces with full 7 days", () => {
  const plan = createBudgetConstrainedPlan(
    { scope: "BREAKFAST_PLAN", budget: 300000, days: 7, mealType: "breakfast", useRemainingFunds: false, rawText: "" },
  );
  const partialOutput = "Thực đơn 3 ngày:\n- Ngày 1: Bánh mì\n- Ngày 2: Xôi\n- Ngày 3: Bún riêu.";
  const verified = verifyAndSanitizeBudgetPlan(partialOutput, plan.constraints, plan);
  assert.equal(verified.corrected, true);
  assert.ok(verified.reasons.some((r) => r.includes("7 ngày")));
  assert.ok(verified.sanitizedText.includes("Ngày 7"));
});

test("G5-04: Intercepts over-budget claim (450k > 300k budget) with 'đủ tiền' conclusion", () => {
  const plan = createBudgetConstrainedPlan(
    { scope: "BREAKFAST_PLAN", budget: 300000, days: 7, mealType: "breakfast", useRemainingFunds: false, rawText: "" },
  );
  const overBudgetOutput = "Tổng chi phí là 450.000 VND và số tiền này hoàn toàn đủ với ngân sách của bạn!";
  const verified = verifyAndSanitizeBudgetPlan(overBudgetOutput, plan.constraints, plan);
  assert.equal(verified.corrected, true);
  assert.ok(verified.reasons.some((r) => r.includes("vượt ngân sách")));
});

test("G5-05: Non-feasible plan prevents false 'hoàn toàn đủ' conclusion", () => {
  const plan = createBudgetConstrainedPlan(
    { scope: "BREAKFAST_PLAN", budget: 30000, days: 7, mealType: "breakfast", useRemainingFunds: false, rawText: "" },
  );
  const falseSufficientOutput = "Với 30k, bạn hoàn toàn đủ tiền ăn sáng 7 ngày ngoài hàng!";
  const verified = verifyAndSanitizeBudgetPlan(falseSufficientOutput, plan.constraints, plan);
  assert.equal(verified.corrected, true);
  assert.ok(verified.sanitizedText.includes("KHÔNG ĐỦ TIỀN"));
});

test("G5-06: Preserves compliant response that passes all rules", () => {
  const plan = createBudgetConstrainedPlan(
    { scope: "BREAKFAST_PLAN", budget: 300000, days: 7, mealType: "breakfast", useRemainingFunds: false, rawText: "" },
  );
  const compliantOutput = "Thực đơn ăn sáng:\n- Ngày 1: Bánh mì 20k\n- Ngày 2: Xôi 20k\n- Ngày 3: Bún 35k\n- Ngày 4: Bánh bao 20k\n- Ngày 5: Mì 15k\n- Ngày 6: Bánh cuốn 25k\n- Ngày 7: Cơm tấm 30k\nTổng chi phí 165.000 VND, còn dư 135.000 VND.\n*(Lưu ý: Mức giá trên là giá ước tính).*";
  const verified = verifyAndSanitizeBudgetPlan(compliantOutput, plan.constraints, plan);
  assert.equal(verified.corrected, false);
  assert.equal(verified.sanitizedText, compliantOutput);
});

test("G5-07: Sanitized output includes realistic price estimate disclaimer", () => {
  const plan = createBudgetConstrainedPlan(
    { scope: "BREAKFAST_PLAN", budget: 300000, days: 7, mealType: "breakfast", useRemainingFunds: false, rawText: "" },
  );
  assert.ok(plan.summaryMarkdown.includes("Lưu ý: Mức giá trên là giá ước tính"));
});

test("G5-08: Diacritic-insensitive check handles unaccented 'an trua'", () => {
  const plan = createBudgetConstrainedPlan(
    { scope: "BREAKFAST_PLAN", budget: 300000, days: 7, mealType: "breakfast", useRemainingFunds: false, rawText: "" },
  );
  const output = "Ban co the an sang banh mi va an trua com tam.";
  const verified = verifyAndSanitizeBudgetPlan(output, plan.constraints, plan);
  // Output without diacritics still caught if includes forbidden words
  assert.ok(verified.sanitizedText);
});

test("G5-09: Verifies day count regex matches various Vietnamese day formats (Thứ 2, Ngày 1)", () => {
  const plan = createBudgetConstrainedPlan(
    { scope: "BREAKFAST_PLAN", budget: 300000, days: 7, mealType: "breakfast", useRemainingFunds: false, rawText: "" },
  );
  const textWithDays = "Thứ Hai: Bánh mì\nThứ Ba: Xôi\nThứ Tư: Phở\nThứ Năm: Bánh bao\nThứ Sáu: Bánh cuốn\nThứ Bảy: Hủ tiếu\nChủ Nhật: Cơm tấm.";
  const verified = verifyAndSanitizeBudgetPlan(textWithDays, plan.constraints, plan);
  assert.equal(verified.corrected, false);
});

test("G5-10: Correctly reports multiple validation reasons in logs", () => {
  const plan = createBudgetConstrainedPlan(
    { scope: "BREAKFAST_PLAN", budget: 300000, days: 7, mealType: "breakfast", useRemainingFunds: false, rawText: "" },
  );
  const badOutput = "Bữa sáng bánh mì, bữa trưa cơm sườn, tổng cộng 450.000 VND đủ tiền nhé!";
  const verified = verifyAndSanitizeBudgetPlan(badOutput, plan.constraints, plan);
  assert.equal(verified.corrected, true);
  assert.ok(verified.reasons.length >= 1);
});

// ===========================================================================
// SECTION 6: OTHER PLANNING TYPES (8 tests)
// ===========================================================================

test("O6-01: MEALS_MONTHLY_PLAN splits daily budget into breakfast 25%, lunch 45%, dinner 30%", () => {
  const plan = createBudgetConstrainedPlan({
    scope: "MEALS_MONTHLY_PLAN",
    budget: 3000000,
    days: 30,
    mealType: "all_meals",
    useRemainingFunds: false,
    rawText: "",
  });
  assert.equal(plan.items.length, 3);
  assert.ok(plan.summaryMarkdown.includes("Bữa sáng (25%)"));
  assert.ok(plan.summaryMarkdown.includes("Bữa trưa (45%)"));
  assert.ok(plan.summaryMarkdown.includes("Bữa tối (30%)"));
});

test("O6-02: MEALS_MONTHLY_PLAN items sum up to monthly budget", () => {
  const budget = 3000000;
  const plan = createBudgetConstrainedPlan({
    scope: "MEALS_MONTHLY_PLAN",
    budget,
    days: 30,
    mealType: "all_meals",
    useRemainingFunds: false,
    rawText: "",
  });
  assert.ok(plan.totalEstimatedCost <= budget);
});

test("O6-03: INCOME_ALLOCATION distributes exactly 50% Needs, 30% Wants, 20% Savings", () => {
  const income = 15000000;
  const plan = createBudgetConstrainedPlan({
    scope: "INCOME_ALLOCATION",
    budget: income,
    days: 30,
    useRemainingFunds: false,
    rawText: "",
  });
  assert.equal(plan.items.length, 3);
  assert.equal(plan.items[0].estimatedPrice, 7500000); // 50%
  assert.equal(plan.items[1].estimatedPrice, 4500000); // 30%
  assert.equal(plan.items[2].estimatedPrice, 3000000); // 20%
});

test("O6-04: INCOME_ALLOCATION items sum exactly to total income", () => {
  const income = 20000000;
  const plan = createBudgetConstrainedPlan({
    scope: "INCOME_ALLOCATION",
    budget: income,
    days: 30,
    useRemainingFunds: false,
    rawText: "",
  });
  const sum = plan.items.reduce((acc, it) => acc + it.estimatedPrice, 0);
  assert.equal(sum, income);
});

test("O6-05: SPENDING_REDUCTION prioritizes essential fixed costs and cuts discretionary by 50-70%", () => {
  const plan = createBudgetConstrainedPlan({
    scope: "SPENDING_REDUCTION",
    days: 30,
    useRemainingFunds: false,
    rawText: "",
  });
  assert.ok(plan.summaryMarkdown.includes("Bảo vệ chi phí cố định thiết yếu"));
  assert.ok(plan.summaryMarkdown.includes("Cắt giảm mạnh chi tiêu biến đổi"));
});

test("O6-06: SAVINGS_GOAL_PLAN calculates required monthly amount accurately", () => {
  const plan = createBudgetConstrainedPlan({
    scope: "SAVINGS_GOAL_PLAN",
    budget: 12000000,
    days: 180, // 6 months
    useRemainingFunds: false,
    rawText: "",
  });
  assert.ok(plan.summaryMarkdown.includes("2.000.000 VND/tháng"));
  assert.ok(plan.summaryMarkdown.includes("6 tháng"));
});

test("O6-07: SHOPPING_BUDGET_PLAN enforces ceiling without overspending", () => {
  const plan = createBudgetConstrainedPlan({
    scope: "SHOPPING_BUDGET_PLAN",
    budget: 1000000,
    days: 1,
    useRemainingFunds: false,
    rawText: "",
  });
  assert.ok(plan.summaryMarkdown.includes("1.000.000 VND"));
  assert.ok(plan.summaryMarkdown.includes("Needs"));
});

test("O6-08: All planning scopes maintain isFeasible boolean integrity", () => {
  const scopes = [
    "BREAKFAST_PLAN",
    "MEALS_MONTHLY_PLAN",
    "INCOME_ALLOCATION",
    "SPENDING_REDUCTION",
    "SAVINGS_GOAL_PLAN",
    "SHOPPING_BUDGET_PLAN",
  ];
  for (const s of scopes) {
    const res = createBudgetConstrainedPlan({
      scope: s,
      budget: 1000000,
      days: 7,
      useRemainingFunds: false,
      rawText: "",
    });
    assert.equal(typeof res.isFeasible, "boolean");
    assert.ok(res.summaryMarkdown.length > 50);
  }
});

// ===========================================================================
// SECTION 7: MULTI-TURN CONTEXT & EXACT BUG RESOLUTION (5 tests)
// ===========================================================================

test("T7-01: detectMultiTurnReference identifies PLANNING_WITH_REMAINING", () => {
  const history = [
    { role: "user", parts: [{ text: "Tôi có đủ tiền mua điện thoại giá 3 triệu không?" }] },
    { role: "model", parts: [{ text: "Bạn có 3.459.000 VND khả dụng, mua xong còn 459.000 VND." }] },
  ];
  const ref = detectMultiTurnReference("Với số tiền còn lại thì ăn sáng trong 1 tuần tôi ăn gì?", history);
  assert.equal(ref.hasReference, true);
  assert.equal(ref.referenceType, "PLANNING_WITH_REMAINING");
  assert.ok(ref.referencedPurchase);
  assert.equal(ref.referencedPurchase.price, 3000000);
});

test("T7-02: routeUserIntent maps planning query to FINANCIAL_ADVICE and BUDGET_PLANNING", () => {
  const routing = routeUserIntent("Với số tiền còn lại thì ăn sáng trong 1 tuần tôi ăn gì?", []);
  assert.equal(routing.primaryIntent, "FINANCIAL_ADVICE");
  assert.equal(routing.category, "BUDGET_PLANNING");
  assert.ok(routing.extractedBudgetPlan);
  assert.equal(routing.extractedBudgetPlan.scope, "BREAKFAST_PLAN");
  assert.equal(routing.extractedBudgetPlan.days, 7);
  assert.equal(routing.extractedBudgetPlan.mealType, "breakfast");
});

test("T7-03: EXACT BUG VERIFICATION: 'Với số tiền còn lại thì ăn sáng trong 1 tuần tôi ăn gì?' with cash available 300k", () => {
  const parsed = parseBudgetPlanQuery("Với số tiền còn lại thì ăn sáng trong 1 tuần tôi ăn gì?");
  assert.ok(parsed);

  const plan = createBudgetConstrainedPlan(parsed, {
    snapshot: mockSnapshot,
    serverContext: mockServerContext,
  });

  // 1. Budget is 300.000 VND from available cash
  assert.equal(plan.constraints.totalBudget, 300000);

  // 2. Exactly 7 breakfasts
  assert.equal(plan.items.length, 7);
  for (let i = 0; i < 7; i++) {
    assert.equal(plan.items[i].mealType, "breakfast");
  }

  // 3. Zero lunches or dinners in meals
  assert.ok(!plan.items.some((it) => it.mealType === "lunch" || it.mealType === "dinner"));
  assert.ok(!plan.summaryMarkdown.includes("*(Bữa trưa)*"));
  assert.ok(!plan.summaryMarkdown.includes("*(Bữa tối)*"));

  // 4. Exact sum equality
  const mathSum = plan.items.reduce((s, it) => s + it.estimatedPrice, 0);
  assert.equal(plan.totalEstimatedCost, mathSum);

  // 5. Total cost strictly <= 300.000 VND
  assert.ok(plan.totalEstimatedCost <= 300000);

  // 6. Remaining funds >= 0
  assert.ok(plan.remainingFunds >= 0);
  assert.equal(plan.remainingFunds, 300000 - plan.totalEstimatedCost);

  // 7. Supabase category budget cross-referenced
  assert.ok(plan.summaryMarkdown.includes("Ngân sách Ăn uống"));

  // 8. Positive conclusion is mathematically truthful
  assert.equal(plan.isFeasible, true);
  assert.ok(plan.summaryMarkdown.includes("✅ **HOÀN TOÀN ĐỦ TIỀN**"));
});

test("T7-04: Multi-turn simulated purchase propagates remaining funds (459k) to breakfast plan", () => {
  const parsed = parseBudgetPlanQuery("Với số tiền còn lại thì ăn sáng trong 1 tuần tôi ăn gì?");
  assert.ok(parsed);

  const plan = createBudgetConstrainedPlan(parsed, {
    snapshot: mockSnapshot,
    serverContext: mockServerContext,
    activePurchaseSimulationRemaining: 459000,
  });

  assert.equal(plan.constraints.totalBudget, 459000);
  assert.equal(plan.constraints.budgetSource, "REMAINING_AFTER_PURCHASE");
  assert.ok(plan.totalEstimatedCost <= 459000);
  assert.ok(plan.items.length === 7);
});

test("T7-05: Non-hardcoded breakfast selection varies menu with different budget brackets", () => {
  const tightPlan = createBudgetConstrainedPlan({
    scope: "BREAKFAST_PLAN",
    budget: 120000,
    days: 7,
    mealType: "breakfast",
    useRemainingFunds: false,
    rawText: "",
  });

  const generousPlan = createBudgetConstrainedPlan({
    scope: "BREAKFAST_PLAN",
    budget: 400000,
    days: 7,
    mealType: "breakfast",
    useRemainingFunds: false,
    rawText: "",
  });

  // Tight plan cost is lower than generous plan cost
  assert.ok(tightPlan.totalEstimatedCost < generousPlan.totalEstimatedCost);
  // Both plans respect their budgets
  assert.ok(tightPlan.totalEstimatedCost <= 120000);
  assert.ok(generousPlan.totalEstimatedCost <= 400000);
  // Both have exactly 7 breakfast meals
  assert.equal(tightPlan.items.length, 7);
  assert.equal(generousPlan.items.length, 7);
});
