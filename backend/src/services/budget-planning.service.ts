/**
 * backend/src/services/budget-planning.service.ts
 * ===============================================
 * Deterministic Financial Planning & Budget-Constrained Reasoning Engine.
 *
 * Capabilities:
 * 1. Scope Detection:
 *    - BREAKFAST_PLAN: 7-day / 1-week breakfast menu within budget.
 *    - MEALS_MONTHLY_PLAN: Monthly / multi-day full meals within budget.
 *    - SHOPPING_BUDGET_PLAN: Purchasing goods within a fixed spending ceiling.
 *    - SAVINGS_GOAL_PLAN: Goal savings timeline and monthly target feasibility.
 *    - INCOME_ALLOCATION: 50/30/20 income distribution or personalized allocation.
 *    - SPENDING_REDUCTION: Spending adjustment strategy when income drops.
 * 2. Strict Mathematical Constraints:
 *    - Total cost must equal the sum of individual items (sum(cost) === totalCost).
 *    - Total cost must NOT exceed the effective budget limit (totalCost <= budgetLimit).
 *    - Remaining funds must be calculated correctly (remaining = budget - totalCost >= 0).
 *    - Never conclude "đủ tiền" when totalCost > budget.
 * 3. Scope Isolation:
 *    - Breakfast queries NEVER inject lunch or dinner.
 *    - Exact day count is enforced (e.g. exactly 7 breakfasts for a 1-week request).
 * 4. Supabase Integration:
 *    - Automatically checks category budgets (e.g. "Ngân sách Ăn uống") in Supabase.
 *    - Distinguishes available cash from allocated savings.
 * 5. Post-Generation Verification Guardrail:
 *    - Validates and sanitizes LLM-generated responses against backend constraints.
 */

import type { AuthoritativeFinancialSnapshot } from "./financial-snapshot.service.ts";
import type { ServerFinancialContext } from "./financial-context.service.ts";
import type { MultiTurnReferenceResult } from "./financial-simulation.service.ts";

export type PlanningScope =
  | "BREAKFAST_PLAN"
  | "MEALS_MONTHLY_PLAN"
  | "SHOPPING_BUDGET_PLAN"
  | "SAVINGS_GOAL_PLAN"
  | "INCOME_ALLOCATION"
  | "SPENDING_REDUCTION";

export type SavingsQueryMode =
  | "TARGET_GOAL"          // e.g. "Mục tiêu tiết kiệm 500.000đ"
  | "ADDITIONAL_SAVINGS"   // e.g. "Tiết kiệm thêm 500.000đ", "để dành thêm 500k"
  | "SAVINGS_STATUS"       // e.g. "Tôi đã tiết kiệm được bao nhiêu?", "tiến độ tiết kiệm"
  | "MAX_SAVINGS_CAPACITY" // e.g. "Tôi có thể tiết kiệm được bao nhiêu?", "tối đa tiết kiệm"
  | "GENERAL_PLAN";        // e.g. "Lập kế hoạch tiết kiệm", "làm sao để tiết kiệm"

export interface ParsedBudgetPlanQuery {
  scope: PlanningScope;
  budget?: number;
  days: number;
  mealType?: "breakfast" | "all_meals" | "lunch" | "dinner";
  targetCategory?: string;
  useRemainingFunds: boolean;
  rawText: string;
  savingsMode?: SavingsQueryMode;
  targetGoalTitle?: string;
}

export interface PlanConstraints {
  scope: PlanningScope;
  totalBudget: number;
  periodDays: number;
  mealType: "breakfast" | "all_meals" | "lunch" | "dinner";
  targetCategory?: string;
  userBudgetInput?: number;
  budgetSource:
  | "USER_INPUT"
  | "REMAINING_AFTER_PURCHASE"
  | "CASH_AVAILABLE"
  | "CATEGORY_BUDGET"
  | "TOTAL_AVAILABLE";
  sourceExplanation: string;
  categoryBudgetStatus?: {
    name: string;
    limit: number;
    spent: number;
    remaining: number;
  };
  savingsMode?: SavingsQueryMode;
  targetGoalTitle?: string;
}

export interface PlanItem {
  dayIndex: number;
  dayLabel: string;
  mealType: "breakfast" | "lunch" | "dinner" | "general";
  itemName: string;
  estimatedPrice: number;
  notes?: string;
}

export interface BudgetConstrainedPlanResult {
  scope: PlanningScope;
  constraints: PlanConstraints;
  isFeasible: boolean;
  totalEstimatedCost: number;
  remainingFunds: number;
  dailyAverageCost: number;
  items: PlanItem[];
  summaryMarkdown: string;
  validationNotes: string[];

  // Programmatic financial details for savings reasoning
  savingsDetails?: {
    mode: SavingsQueryMode;
    targetAmount: number;
    currentSavedAmount: number;
    effectiveRequiredAmount: number;
    totalAssets: number;
    totalAvailable: number;
    upcomingObligationsTotal: number;
    discretionaryAvailable: number;
    shortfall: number;
    maxSpendingAllowed: number;
    feasibilityStatus:
      | "ALREADY_ACHIEVED"
      | "FEASIBLE_IMMEDIATELY"
      | "FEASIBLE_WITH_BUDGET_DISCIPLINE"
      | "INSUFFICIENT_FUNDS_SHORTFALL"
      | "DATA_LIMITED";
    hasRecordedExpenses: boolean;
    recommendedWalletName?: string;
    recommendedWalletAvailable?: number;
    safetyNotice: string;
  };
}

export interface RealisticDishOption {
  name: string;
  mealType: "breakfast" | "lunch" | "dinner";
  minPrice: number;
  maxPrice: number;
  estimatedPrice: number;
  category: "eating_out" | "home_cook";
  description: string;
}

// ---------------------------------------------------------------------------
// 1. Realistic Vietnamese Dish Catalog with Estimated Price Brackets
// ---------------------------------------------------------------------------

export const VIETNAMESE_BREAKFAST_OPTIONS: RealisticDishOption[] = [
  {
    name: "Bánh mì pate chả lụa / ốp la",
    mealType: "breakfast",
    minPrice: 15_000,
    maxPrice: 25_000,
    estimatedPrice: 20_000,
    category: "eating_out",
    description: "Bánh mì giòn kẹp pate, chả lụa hoặc trứng ốp la",
  },
  {
    name: "Xôi xéo / Xôi gà / Xôi bắp",
    mealType: "breakfast",
    minPrice: 15_000,
    maxPrice: 25_000,
    estimatedPrice: 20_000,
    category: "eating_out",
    description: "Xôi nóng ăn kèm hành phi, đậu xanh hoặc chả lụa",
  },
  {
    name: "Bánh bao nhân thịt trứng cút",
    mealType: "breakfast",
    minPrice: 15_000,
    maxPrice: 20_000,
    estimatedPrice: 18_000,
    category: "eating_out",
    description: "Bánh bao nóng nhân thịt xay, mộc nhĩ và trứng cút",
  },
  {
    name: "Mì trứng xúc xích tự nấu tại nhà",
    mealType: "breakfast",
    minPrice: 10_000,
    maxPrice: 15_000,
    estimatedPrice: 12_000,
    category: "home_cook",
    description: "1 gói mì kèm 1 quả trứng gà và rau thơm tự nấu",
  },
  {
    name: "Bánh cuốn nóng chả lụa",
    mealType: "breakfast",
    minPrice: 20_000,
    maxPrice: 30_000,
    estimatedPrice: 25_000,
    category: "eating_out",
    description: "Bánh cuốn tráng nóng ăn kèm chả lụa và nước mắm chua ngọt",
  },
  {
    name: "Bún riêu cua bình dân",
    mealType: "breakfast",
    minPrice: 30_000,
    maxPrice: 40_000,
    estimatedPrice: 35_000,
    category: "eating_out",
    description: "Tô bún riêu đậu hũ, cà chua và chả lụa quán bình dân",
  },
  {
    name: "Phở bò / Phở gà bình dân",
    mealType: "breakfast",
    minPrice: 35_000,
    maxPrice: 45_000,
    estimatedPrice: 40_000,
    category: "eating_out",
    description: "Phở bò tái nạm hoặc phở gà quán bình dân",
  },
  {
    name: "Hủ tiếu Nam Vang / gõ",
    mealType: "breakfast",
    minPrice: 25_000,
    maxPrice: 35_000,
    estimatedPrice: 30_000,
    category: "eating_out",
    description: "Tô hủ tiếu thịt bằm hoặc hủ tiếu gõ",
  },
  {
    name: "Cơm tấm sườn bình dân",
    mealType: "breakfast",
    minPrice: 25_000,
    maxPrice: 35_000,
    estimatedPrice: 30_000,
    category: "eating_out",
    description: "Đĩa cơm tấm sườn nướng kèm đồ chua",
  },
  {
    name: "Cháo sườn / cháo trai nóng",
    mealType: "breakfast",
    minPrice: 15_000,
    maxPrice: 25_000,
    estimatedPrice: 20_000,
    category: "eating_out",
    description: "Bát cháo sườn quẩy hoặc cháo trai thơm ngậy",
  },
  {
    name: "Bánh giò nóng kèm chả cốm",
    mealType: "breakfast",
    minPrice: 15_000,
    maxPrice: 25_000,
    estimatedPrice: 20_000,
    category: "eating_out",
    description: "Bánh giò nóng nhân thịt mộc nhĩ ăn kèm lát chả cốm",
  },
  {
    name: "Bánh mì sandwich bơ đậu phộng / trứng tự làm",
    mealType: "breakfast",
    minPrice: 10_000,
    maxPrice: 18_000,
    estimatedPrice: 15_000,
    category: "home_cook",
    description: "2 lát sandwich nướng kèm trứng ốp la hoặc bơ đậu phộng",
  },
];

// ---------------------------------------------------------------------------
// 2. Query Parser for Planning Requests
// ---------------------------------------------------------------------------

function stripAccents(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

/**
 * Parses user input for financial planning, meal scheduling, income allocation, or budget adjustments.
 */
export function parseBudgetPlanQuery(
  text: string,
  _history?: Array<{ role: string; parts?: Array<{ text: string }> }>,
  multiTurnRef?: MultiTurnReferenceResult | null,
): ParsedBudgetPlanQuery | null {
  void _history;
  const normalized = text.toLowerCase().trim();
  const unaccented = stripAccents(text);

  // 1. Extract days (e.g. "7 ngày", "1 tuần" = 7 days, "30 ngày" = 30 days, "1 tháng" = 30 days)
  let days = 7;
  const weekMatch = normalized.match(/(\d+)\s*(?:tuần|tuan)\b/i);
  if (weekMatch) {
    days = parseInt(weekMatch[1], 10) * 7;
  } else if (/1\s*tuần|một tuần|mot tuan/i.test(normalized)) {
    days = 7;
  } else if (/cả tháng|trong tháng|1\s*tháng|một tháng|mot thang|ca thang/i.test(normalized)) {
    days = 30;
  } else {
    const dayMatch = normalized.match(/(\d+)\s*(?:ngày|ngay|hôm|hom)\b/i);
    if (dayMatch) {
      days = parseInt(dayMatch[1], 10);
    }
  }

  // 2. Extract numeric budget amount if provided in query
  let budget: number | undefined;
  const pricePatterns = [
    /(\d+(?:[.,]\d+)?)\s*(triệu|tr|m)\b/i,
    /(\d+(?:[.,]\d+)?)\s*(nghìn|ngàn|k)\b/i,
    /(\d{1,3}(?:\.\d{3})+|\d{4,9})\s*(?:đ|vnd|đồng)?\b/i,
  ];
  for (const pat of pricePatterns) {
    const m = normalized.match(pat);
    if (m) {
      const numStr = m[1].replace(",", ".");
      const unit = m[2]?.toLowerCase();
      if (unit === "triệu" || unit === "tr" || unit === "m") {
        budget = parseFloat(numStr) * 1_000_000;
      } else if (unit === "nghìn" || unit === "ngàn" || unit === "k") {
        budget = parseFloat(numStr) * 1_000;
      } else {
        const cleanDigits = m[1].replace(/\./g, "");
        budget = parseFloat(cleanDigits);
      }
      break;
    }
  }

  const useRemainingFunds =
    /(?:với|bằng|cho|dùng)?\s*(?:số tiền còn lại|tiền còn lại|tiền thừa|khoản còn lại|số tiền đó|tiền đó)/i.test(
      normalized,
    ) ||
    multiTurnRef?.referenceType === "PLANNING_WITH_REMAINING" ||
    multiTurnRef?.referenceType === "REMAINING_FUNDS";

  // 3. Detect BREAKFAST_PLAN
  const isBreakfast =
    /ăn sáng|bữa sáng|thực đơn sáng|điểm tâm/i.test(normalized) ||
    /an sang|bua sang|thuc don sang|diem tam/i.test(unaccented);

  if (isBreakfast) {
    return {
      scope: "BREAKFAST_PLAN",
      budget,
      days: days || 7,
      mealType: "breakfast",
      targetCategory: "Ăn uống",
      useRemainingFunds,
      rawText: text,
    };
  }

  // 4. Detect MEALS_MONTHLY_PLAN / General Meals
  const isMeals =
    /(?:kế hoạch|thực đơn|chi phí)\s*(?:ăn uống|ăn cơm|ăn cả tháng|ăn trong)/i.test(normalized) ||
    /(?:ăn uống|tiền ăn)\s*(?:trong\s*)?(?:1\s*tháng|một tháng|\d+\s*ngày)/i.test(normalized) ||
    /ke hoach an uong|tien an mot thang|an uong trong thang/i.test(unaccented);

  if (isMeals) {
    return {
      scope: "MEALS_MONTHLY_PLAN",
      budget,
      days: days || 30,
      mealType: "all_meals",
      targetCategory: "Ăn uống",
      useRemainingFunds,
      rawText: text,
    };
  }

  // 5. Detect INCOME_ALLOCATION (50/30/20, chia lương, phân bổ thu nhập)
  const isIncomeAllocation =
    /(?:phân bổ|chia|quản lý).*(?:thu nhập|tiền lương|lương)|(?:thu nhập|tiền lương|lương).*(?:phân bổ|chia|quản lý|50\/30\/20)|quy tắc 50\/30\/20/i.test(
      normalized,
    ) ||
    /(?:phan bo|chia|quan ly).*(?:thu nhap|tien luong|luong)|(?:thu nhap|tien luong|luong).*(?:phan bo|chia|quan ly|50\/30\/20)/i.test(
      unaccented,
    );

  if (isIncomeAllocation) {
    return {
      scope: "INCOME_ALLOCATION",
      budget,
      days: 30,
      targetCategory: "Thu nhập",
      useRemainingFunds: false,
      rawText: text,
    };
  }

  // 6. Detect SPENDING_REDUCTION (Giảm thu nhập, cắt giảm chi tiêu)
  const isSpendingReduction =
    /điều chỉnh chi tiêu khi thu nhập giảm|giảm thu nhập|thu nhập bị giảm|bị giảm lương|cắt giảm chi tiêu/i.test(
      normalized,
    ) ||
    /dieu chinh chi tieu khi thu nhap giam|giam luong|cat giam chi tieu/i.test(unaccented);

  if (isSpendingReduction) {
    return {
      scope: "SPENDING_REDUCTION",
      budget,
      days: 30,
      useRemainingFunds: false,
      rawText: text,
    };
  }

  // 7. Detect SAVINGS_GOAL_PLAN
  // Guard against definition or comparison queries ("sự khác biệt", "là gì", "như thế nào")
  const isDefinitionQuery =
    /sự khác biệt|khác nhau|dùng để làm gì|hoạt động như thế nào/i.test(
      normalized,
    );

  if (!isDefinitionQuery) {
    // 7.1. Max potential savings capacity (Requirement 5)
    // E.g. "Tháng này tôi có thể tiết kiệm được bao nhiêu?", "tối đa có thể tiết kiệm"
    const isMaxSavingsCapacity =
      /(?:tôi\s+)?(?:có thể|nên)\s+tiết kiệm\s+(?:được\s+)?(?:bao nhiêu|tối đa)|tối đa.*tiết kiệm|tiết kiệm được tối đa/i.test(
        normalized,
      ) ||
      /co the tiet kiem duoc bao nhieu|tiet kiem toi da/i.test(unaccented);

    if (isMaxSavingsCapacity) {
      return {
        scope: "SAVINGS_GOAL_PLAN",
        savingsMode: "MAX_SAVINGS_CAPACITY",
        budget,
        days: days || 30,
        targetCategory: "Tiết kiệm",
        useRemainingFunds,
        rawText: text,
      };
    }

    // 7.2. Saving ADDITIONAL money (Requirement 2)
    // E.g. "Tiết kiệm thêm 500.000đ", "để dành thêm 500k", "trích thêm 500k vào mục tiêu"
    const isAdditionalSavings =
      /(?:tiết kiệm|để dành|trích|bỏ vào|bỏ ống)\s+(?:thêm|nữa)\b/i.test(normalized) ||
      /(?:thêm|nữa)\s+[0-9.,]+\s*(?:k|nghìn|ngàn|triệu|tr|đ|vnd)?.*(?:tiết kiệm|vào mục tiêu)/i.test(normalized) ||
      /tiet kiem them|de danh them|trich them/i.test(unaccented);

    if (isAdditionalSavings) {
      return {
        scope: "SAVINGS_GOAL_PLAN",
        savingsMode: "ADDITIONAL_SAVINGS",
        budget,
        days: days || 30,
        targetCategory: "Tiết kiệm",
        useRemainingFunds,
        rawText: text,
      };
    }

    // 7.3. Querying already saved amounts / status (Requirement 2)
    const isSavingsStatus =
      /(?:tôi\s+)?(?:đã\s+)(?:tiết kiệm|tích lũy)\s+(?:được\s+)?(?:bao nhiêu|như thế nào)|số tiền\s+(?:đã\s+)?(?:tiết kiệm|tích lũy)|tiến độ\s+(?:các\s+)?mục tiêu\s+tiết kiệm|tôi có bao nhiêu tiền tiết kiệm|đang tiết kiệm được bao nhiêu/i.test(
        normalized,
      ) ||
      /toi da tiet kiem duoc bao nhieu|so tien da tiet kiem|tien do muc tieu tiet kiem/i.test(
        unaccented,
      );

    if (isSavingsStatus) {
      return {
        scope: "SAVINGS_GOAL_PLAN",
        savingsMode: "SAVINGS_STATUS",
        budget,
        days: days || 30,
        targetCategory: "Tiết kiệm",
        useRemainingFunds,
        rawText: text,
      };
    }

    // 7.4. Target savings goal or General Savings Plan (Requirement 2)
    // E.g. "Mục tiêu tiết kiệm 500.000đ", "Tôi muốn tiết kiệm 500k", "Tôi có tiết kiệm được 200k không?", "Với số tiền còn lại đó tôi có tiết kiệm được 200k không?"
    const isTargetOrGeneralSavings =
      /(?:mục tiêu\s+tiết kiệm|mục tiêu\s+tích lũy|đặt\s+mục tiêu|mục tiêu\s+là)\s*(\d+...)?/i.test(normalized) ||
      /(?:tôi\s+)?(?:muốn|cần|định|liệu có thể)\s+tiết kiệm\s+(?:được\s+)?[0-9.,]+/i.test(normalized) ||
      /(?:có\s+(?:đủ\s+)?(?:tiền\s+)?(?:để\s+)?)tiết kiệm\s+(?:được\s+)?[0-9.,]+/i.test(normalized) ||
      /(?:tiết kiệm|để dành)\s+(?:được\s+)?[0-9.,]+/i.test(normalized) ||
      /(?:lập\s+|lên\s+)?kế hoạch tiết kiệm|kế hoạch tích lũy|làm sao để tiết kiệm/i.test(normalized) ||
      /muc tieu tiet kiem|muon tiet kiem|lap ke hoach tiet kiem|co tiet kiem duoc/i.test(unaccented);

    if (isTargetOrGeneralSavings) {
      const defaultMode = useRemainingFunds
        ? "ADDITIONAL_SAVINGS"
        : (budget ? "TARGET_GOAL" : "GENERAL_PLAN");
      return {
        scope: "SAVINGS_GOAL_PLAN",
        savingsMode: defaultMode,
        budget,
        days: days || 180, // default 6 months
        targetCategory: "Tiết kiệm",
        useRemainingFunds,
        rawText: text,
      };
    }
  }

  // 8. Detect SHOPPING_BUDGET_PLAN
  const isShoppingPlan =
    /mua sắm trong ngân sách|kế hoạch mua sắm|lập kế hoạch mua sắm|lên danh sách mua đồ|kế hoạch mua đồ/i.test(
      normalized,
    ) ||
    /mua sam trong ngan sach|ke hoach mua sam|lap ke hoach mua sam/i.test(unaccented);

  if (isShoppingPlan) {
    return {
      scope: "SHOPPING_BUDGET_PLAN",
      budget,
      days: 1,
      targetCategory: "Mua sắm",
      useRemainingFunds,
      rawText: text,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// 3. Core Engine: Create Budget-Constrained Plan
// ---------------------------------------------------------------------------

export interface PlanningContext {
  snapshot?: AuthoritativeFinancialSnapshot | null;
  serverContext?: ServerFinancialContext | null;
  activePurchaseSimulationRemaining?: number;
}

/**
 * Resolves effective budget amount and generates a 100% mathematically verified plan.
 */
export function createBudgetConstrainedPlan(
  parsed: ParsedBudgetPlanQuery,
  ctx?: PlanningContext,
): BudgetConstrainedPlanResult {
  const snapshot = ctx?.snapshot || ctx?.serverContext?.snapshot;
  const validationNotes: string[] = [];

  // 1. Determine Effective Budget & Source
  let totalBudget = 0;
  let budgetSource: PlanConstraints["budgetSource"] = "USER_INPUT";
  let sourceExplanation = "";

  // Check Supabase category budget from serverContext or ctx
  const budgetsList = ctx?.serverContext?.budgets;
  const categoryBudget = budgetsList?.find(
    (b) =>
      b.name.toLowerCase().includes("ăn") ||
      (parsed.targetCategory && b.name.toLowerCase().includes(parsed.targetCategory.toLowerCase())),
  );

  let categoryBudgetStatus: PlanConstraints["categoryBudgetStatus"] | undefined;
  if (categoryBudget) {
    categoryBudgetStatus = {
      name: categoryBudget.name,
      limit: categoryBudget.limit,
      spent: categoryBudget.actualSpent,
      remaining: categoryBudget.limitRemaining,
    };
  }

  // Find cash wallet from snapshot or serverContext
  const cashWallet =
    snapshot?.enrichedWallets?.find(
      (w) => w.type === "cash" || w.name.toLowerCase().includes("tiền mặt"),
    ) ||
    ctx?.serverContext?.wallets?.find(
      (w) => w.type === "cash" || w.name.toLowerCase().includes("tiền mặt"),
    );

  if (parsed.useRemainingFunds) {
    if (ctx?.activePurchaseSimulationRemaining !== undefined && ctx.activePurchaseSimulationRemaining >= 0) {
      totalBudget = ctx.activePurchaseSimulationRemaining;
      budgetSource = "REMAINING_AFTER_PURCHASE";
      sourceExplanation = `Số tiền khả dụng còn lại sau khi mua món hàng vừa trao đổi: ${totalBudget.toLocaleString("vi-VN")} VND.`;
    } else if (cashWallet && cashWallet.availableBalance > 0) {
      totalBudget = cashWallet.availableBalance;
      budgetSource = "CASH_AVAILABLE";
      sourceExplanation = `Số tiền khả dụng ví Tiền mặt của bạn: ${totalBudget.toLocaleString("vi-VN")} VND (Số dư: ${cashWallet.balance.toLocaleString("vi-VN")} VND, đã phân bổ: ${cashWallet.reservedAmount.toLocaleString("vi-VN")} VND).`;
    } else if (categoryBudgetStatus && categoryBudgetStatus.remaining > 0) {
      totalBudget = categoryBudgetStatus.remaining;
      budgetSource = "CATEGORY_BUDGET";
      sourceExplanation = `Hạn mức còn lại của "${categoryBudgetStatus.name}" trong Supabase: ${totalBudget.toLocaleString("vi-VN")} VND.`;
    } else if (snapshot && snapshot.totalAvailable > 0) {
      totalBudget = snapshot.totalAvailable;
      budgetSource = "TOTAL_AVAILABLE";
      sourceExplanation = `Tổng tiền khả dụng chi tiêu của bạn: ${totalBudget.toLocaleString("vi-VN")} VND.`;
    } else {
      // Default realistic fallbacks for testing / empty state
      totalBudget = parsed.scope === "BREAKFAST_PLAN" ? 300_000 : 2_000_000;
      budgetSource = "USER_INPUT";
      sourceExplanation = `Ngân sách mặc định ước tính: ${totalBudget.toLocaleString("vi-VN")} VND.`;
    }
  } else if (parsed.budget && parsed.budget > 0) {
    totalBudget = parsed.budget;
    budgetSource = "USER_INPUT";
    sourceExplanation = `Ngân sách người dùng yêu cầu: ${totalBudget.toLocaleString("vi-VN")} VND.`;
  } else if (categoryBudgetStatus && categoryBudgetStatus.remaining > 0) {
    totalBudget = categoryBudgetStatus.remaining;
    budgetSource = "CATEGORY_BUDGET";
    sourceExplanation = `Hạn mức còn lại của "${categoryBudgetStatus.name}": ${totalBudget.toLocaleString("vi-VN")} VND.`;
  } else if (snapshot && snapshot.totalAvailable > 0) {
    totalBudget = snapshot.totalAvailable;
    budgetSource = "TOTAL_AVAILABLE";
    sourceExplanation = `Tổng tiền khả dụng: ${totalBudget.toLocaleString("vi-VN")} VND.`;
  } else {
    totalBudget = parsed.scope === "BREAKFAST_PLAN" ? 300_000 : 2_000_000;
    budgetSource = "USER_INPUT";
    sourceExplanation = `Ngân sách tiêu chuẩn: ${totalBudget.toLocaleString("vi-VN")} VND.`;
  }

  const periodDays = parsed.days || (parsed.scope === "BREAKFAST_PLAN" ? 7 : 30);

  const constraints: PlanConstraints = {
    scope: parsed.scope,
    totalBudget,
    periodDays,
    mealType: parsed.mealType || "breakfast",
    targetCategory: parsed.targetCategory || "Ăn uống",
    userBudgetInput: parsed.budget,
    budgetSource,
    sourceExplanation,
    categoryBudgetStatus,
    savingsMode: parsed.savingsMode,
    targetGoalTitle: parsed.targetGoalTitle,
  };

  // Route specific plan generation
  switch (parsed.scope) {
    case "BREAKFAST_PLAN":
      return generateBreakfastPlan(constraints, validationNotes);
    case "MEALS_MONTHLY_PLAN":
      return generateMonthlyMealsPlan(constraints, validationNotes);
    case "INCOME_ALLOCATION":
      return generateIncomeAllocationPlan(constraints, validationNotes);
    case "SPENDING_REDUCTION":
      return generateSpendingReductionPlan(constraints, validationNotes);
    case "SAVINGS_GOAL_PLAN":
      return generateSavingsGoalPlan(constraints, validationNotes, ctx);
    case "SHOPPING_BUDGET_PLAN":
    default:
      return generateShoppingBudgetPlan(constraints, validationNotes);
  }
}

// ---------------------------------------------------------------------------
// 4. Detailed Plan Generators
// ---------------------------------------------------------------------------

function generateBreakfastPlan(
  constraints: PlanConstraints,
  validationNotes: string[],
): BudgetConstrainedPlanResult {
  const days = constraints.periodDays || 7;
  const budget = constraints.totalBudget;
  const dailyBudget = Math.floor(budget / days);

  // Check Feasibility: At least 10,000 VND / day is required for minimal food in Vietnam
  if (dailyBudget < 10_000) {
    validationNotes.push(
      `Ngân sách ${budget.toLocaleString("vi-VN")} VND cho ${days} ngày ăn sáng (~${dailyBudget.toLocaleString("vi-VN")} VND/ngày) là quá thấp, không đủ để ăn sáng bình thường.`,
    );
    const items: PlanItem[] = [];
    for (let i = 1; i <= days; i++) {
      items.push({
        dayIndex: i,
        dayLabel: `Ngày ${i}`,
        mealType: "breakfast",
        itemName: "Mì gói tự nấu tại nhà (tiết kiệm khẩn cấp)",
        estimatedPrice: 7_000,
        notes: "Giải pháp sinh tồn tạm thời khi ngân sách cực thấp",
      });
    }
    const totalEstimatedCost = items.reduce((sum, item) => sum + item.estimatedPrice, 0);
    const isFeasible = totalEstimatedCost <= budget;
    const remainingFunds = budget - totalEstimatedCost;

    const summaryMarkdown = buildBreakfastMarkdown(
      constraints,
      items,
      totalEstimatedCost,
      remainingFunds,
      isFeasible,
    );

    return {
      scope: "BREAKFAST_PLAN",
      constraints,
      isFeasible,
      totalEstimatedCost,
      remainingFunds,
      dailyAverageCost: Math.round(totalEstimatedCost / days),
      items,
      summaryMarkdown,
      validationNotes,
    };
  }

  // Dynamic selection of 7 varied Vietnamese breakfasts
  const dayNames = ["Thứ Hai (Ngày 1)", "Thứ Ba (Ngày 2)", "Thứ Tư (Ngày 3)", "Thứ Năm (Ngày 4)", "Thứ Sáu (Ngày 5)", "Thứ Bảy (Ngày 6)", "Chủ Nhật (Ngày 7)"];

  // Diverse pool of breakfasts
  const candidatePool = [...VIETNAMESE_BREAKFAST_OPTIONS];

  // Desired price target per meal ~ dailyBudget
  // If dailyBudget is generous (e.g. >= 40k), include Phở / Bún riêu.
  // If tight (e.g. 20-30k), prioritize Bánh mì, Xôi, Bánh bao, Bánh cuốn.
  const selectedDishes: RealisticDishOption[] = [];

  // Seed varied 7 breakfasts
  const balancedSelection: RealisticDishOption[] = [
    candidatePool[0], // Bánh mì pate chả lụa (20k)
    candidatePool[1], // Xôi xéo / xôi gà (20k)
    dailyBudget >= 35_000 ? candidatePool[5] : candidatePool[2], // Bún riêu (35k) or Bánh bao (18k)
    candidatePool[2], // Bánh bao trứng cút (18k)
    candidatePool[3], // Mì trứng tự nấu (12k)
    candidatePool[4], // Bánh cuốn nóng (25k)
    dailyBudget >= 40_000 ? candidatePool[6] : (dailyBudget >= 30_000 ? candidatePool[8] : candidatePool[0]), // Phở (40k) / Cơm tấm (30k) / Bánh mì (20k)
  ];

  // Adjust if days !== 7
  for (let i = 0; i < days; i++) {
    const dish = balancedSelection[i % balancedSelection.length];
    selectedDishes.push({ ...dish });
  }

  // Calculate current total
  let totalCost = selectedDishes.reduce((s, d) => s + d.estimatedPrice, 0);

  // If totalCost exceeds budget, progressively downgrade expensive dishes to fit budget
  if (totalCost > budget) {
    validationNotes.push(
      `Phương án ban đầu (${totalCost.toLocaleString("vi-VN")} VND) vượt ngân sách (${budget.toLocaleString("vi-VN")} VND). Đang tự động điều chỉnh các món giá cao xuống mức phù hợp hơn...`,
    );
    for (let i = 0; i < selectedDishes.length && totalCost > budget; i++) {
      if (selectedDishes[i].estimatedPrice > 25_000) {
        selectedDishes[i] = candidatePool[0]; // Bánh mì 20k
        totalCost = selectedDishes.reduce((s, d) => s + d.estimatedPrice, 0);
      }
    }
    // Second pass if still exceeding
    for (let i = 0; i < selectedDishes.length && totalCost > budget; i++) {
      if (selectedDishes[i].estimatedPrice > 15_000) {
        selectedDishes[i] = candidatePool[3]; // Mì trứng tự nấu 12k
        totalCost = selectedDishes.reduce((s, d) => s + d.estimatedPrice, 0);
      }
    }
  }

  // Final mathematical integrity check
  const items: PlanItem[] = selectedDishes.map((d, idx) => ({
    dayIndex: idx + 1,
    dayLabel: dayNames[idx] || `Ngày ${idx + 1}`,
    mealType: "breakfast",
    itemName: d.name,
    estimatedPrice: d.estimatedPrice,
    notes: d.description,
  }));

  const finalTotalCost = items.reduce((s, it) => s + it.estimatedPrice, 0);
  const isFeasible = finalTotalCost <= budget;
  const remainingFunds = budget - finalTotalCost;

  const summaryMarkdown = buildBreakfastMarkdown(
    constraints,
    items,
    finalTotalCost,
    remainingFunds,
    isFeasible,
  );

  return {
    scope: "BREAKFAST_PLAN",
    constraints,
    isFeasible,
    totalEstimatedCost: finalTotalCost,
    remainingFunds,
    dailyAverageCost: Math.round(finalTotalCost / days),
    items,
    summaryMarkdown,
    validationNotes,
  };
}

function buildBreakfastMarkdown(
  constraints: PlanConstraints,
  items: PlanItem[],
  totalCost: number,
  remainingFunds: number,
  isFeasible: boolean,
): string {
  const lines: string[] = [];

  lines.push(`### 🍳 KẾ HOẠCH ĂN SÁNG TRONG ${constraints.periodDays} NGÀY (RÀNG BUỘC NGÂN SÁCH)`);
  lines.push(`- **Ngân sách cho phép sử dụng:** **${constraints.totalBudget.toLocaleString("vi-VN")} VND**`);
  lines.push(`- **Nguồn xác định ngân sách:** ${constraints.sourceExplanation}`);

  if (constraints.categoryBudgetStatus) {
    lines.push(
      `- **Đối chiếu Ngân sách Supabase ("${constraints.categoryBudgetStatus.name}"):** Hạn mức: ${constraints.categoryBudgetStatus.limit.toLocaleString("vi-VN")} VND | Đã chi: ${constraints.categoryBudgetStatus.spent.toLocaleString("vi-VN")} VND | Hạn mức còn lại: ${constraints.categoryBudgetStatus.remaining.toLocaleString("vi-VN")} VND`,
    );
  }

  lines.push(`- **Ràng buộc phạm vi:** **CHỈ BỮA ĂN SÁNG** (Chỉ điểm tâm buổi sáng, hoàn toàn không gồm các bữa chính/phụ khác).`);
  lines.push(`- **Số ngày áp dụng:** Đúng **${items.length} ngày** (Từ Ngày 1 đến Ngày ${items.length}).`);
  lines.push(`- **Định mức trung bình mỗi ngày:** ~${Math.floor(constraints.totalBudget / constraints.periodDays).toLocaleString("vi-VN")} VND/bữa sáng.`);
  lines.push("");

  lines.push(`#### 📋 Thực đơn gợi ý chi tiết từng ngày (Giá ước tính theo thị trường Việt Nam):`);
  items.forEach((it) => {
    lines.push(`- **${it.dayLabel}:** ${it.itemName} — **${it.estimatedPrice.toLocaleString("vi-VN")} VND** *(Bữa sáng)*`);
  });
  lines.push("");

  lines.push(`#### 💰 Tổng kết toán học & Tính khả thi:`);
  lines.push(`- **Tổng chi phí ăn sáng 7 ngày:** **${totalCost.toLocaleString("vi-VN")} VND** *(Bằng chính xác tổng cộng 7 bữa)*`);
  lines.push(`- **Số tiền còn lại sau 7 ngày:** **${remainingFunds.toLocaleString("vi-VN")} VND**`);

  if (isFeasible) {
    lines.push(`- **Kết luận:** ✅ **HOÀN TOÀN ĐỦ TIỀN**. Chi phí (${totalCost.toLocaleString("vi-VN")} VND) nằm gọn trong ngân sách cho phép (${constraints.totalBudget.toLocaleString("vi-VN")} VND). Bạn còn dư **${remainingFunds.toLocaleString("vi-VN")} VND** để dự phòng hoặc uống trà đá, nước suối.`);
  } else {
    lines.push(`- **Kết luận:** ⚠️ **KHÔNG ĐỦ TIỀN**. Tổng chi phí (${totalCost.toLocaleString("vi-VN")} VND) vượt ngân sách cho phép (${constraints.totalBudget.toLocaleString("vi-VN")} VND). Cần điều chỉnh tự nấu ăn hoàn toàn tại nhà.`);
  }

  lines.push("");
  lines.push(`*(Lưu ý: Mức giá trên là giá ước tính phổ biến tại các quán ăn bình dân hoặc tự nấu tại Việt Nam, có thể chênh lệch nhẹ theo khu vực).*`);

  return lines.join("\n");
}

function generateMonthlyMealsPlan(
  constraints: PlanConstraints,
  validationNotes: string[],
): BudgetConstrainedPlanResult {
  const days = constraints.periodDays || 30;
  const budget = constraints.totalBudget;
  const dailyBudget = Math.floor(budget / days);

  const breakfastRatio = 0.25;
  const lunchRatio = 0.45;
  const dinnerRatio = 0.30;

  const breakfastDaily = Math.floor(dailyBudget * breakfastRatio);
  const lunchDaily = Math.floor(dailyBudget * lunchRatio);
  const dinnerDaily = Math.floor(dailyBudget * dinnerRatio);

  const items: PlanItem[] = [
    {
      dayIndex: 1,
      dayLabel: "Bữa sáng hàng ngày (Trung bình)",
      mealType: "breakfast",
      itemName: "Bánh mì / Xôi / Mì trứng tự nấu",
      estimatedPrice: breakfastDaily * days,
      notes: `~${breakfastDaily.toLocaleString("vi-VN")} VND/ngày x ${days} ngày`,
    },
    {
      dayIndex: 2,
      dayLabel: "Bữa trưa hàng ngày (Trung bình)",
      mealType: "lunch",
      itemName: "Cơm văn phòng bình dân / Cơm hộp mang đi",
      estimatedPrice: lunchDaily * days,
      notes: `~${lunchDaily.toLocaleString("vi-VN")} VND/ngày x ${days} ngày`,
    },
    {
      dayIndex: 3,
      dayLabel: "Bữa tối hàng ngày (Trung bình)",
      mealType: "dinner",
      itemName: "Cơm gia đình tự nấu tại nhà",
      estimatedPrice: dinnerDaily * days,
      notes: `~${dinnerDaily.toLocaleString("vi-VN")} VND/ngày x ${days} ngày`,
    },
  ];

  const totalCost = items.reduce((s, it) => s + it.estimatedPrice, 0);
  const isFeasible = totalCost <= budget && dailyBudget >= 40_000;
  const remainingFunds = budget - totalCost;

  const lines: string[] = [
    `### 🍱 KẾ HOẠCH ĂN UỐNG TRONG ${days} NGÀY (NGÂN SÁCH THÁNG)`,
    `- **Tổng ngân sách ăn uống:** **${budget.toLocaleString("vi-VN")} VND** (${constraints.sourceExplanation})`,
    `- **Định mức chi tiêu mỗi ngày:** **~${dailyBudget.toLocaleString("vi-VN")} VND/ngày**`,
    `- **Phân bổ 3 bữa mỗi ngày:**`,
    `  + **Bữa sáng (25%):** ~${breakfastDaily.toLocaleString("vi-VN")} VND/ngày (Bánh mì, xôi, mì trứng).`,
    `  + **Bữa trưa (45%):** ~${lunchDaily.toLocaleString("vi-VN")} VND/ngày (Cơm suất bình dân hoặc nấu mang đi).`,
    `  + **Bữa tối (30%):** ~${dinnerDaily.toLocaleString("vi-VN")} VND/ngày (Nấu ăn tối tại nhà).`,
    `- **Tổng chi phí ước tính ${days} ngày:** **${totalCost.toLocaleString("vi-VN")} VND**`,
    `- **Số tiền còn lại dự phòng:** **${remainingFunds.toLocaleString("vi-VN")} VND**`,
    isFeasible
      ? `- **Đánh giá:** ✅ Kế hoạch khả thi và đảm bảo dinh dưỡng nếu kết hợp nấu ăn tại nhà.`
      : `- **Đánh giá:** ⚠️ Ngân sách khá eo hẹp (${dailyBudget.toLocaleString("vi-VN")} VND/ngày). Bạn nên nấu ăn tại nhà cả 3 bữa để tiết kiệm chi phí.`,
  ];

  return {
    scope: "MEALS_MONTHLY_PLAN",
    constraints,
    isFeasible,
    totalEstimatedCost: totalCost,
    remainingFunds,
    dailyAverageCost: dailyBudget,
    items,
    summaryMarkdown: lines.join("\n"),
    validationNotes,
  };
}

function generateIncomeAllocationPlan(
  constraints: PlanConstraints,
  validationNotes: string[],
): BudgetConstrainedPlanResult {
  const income = constraints.totalBudget;

  const needsAmount = Math.round(income * 0.5);
  const wantsAmount = Math.round(income * 0.3);
  const savingsAmount = Math.round(income * 0.2);

  const items: PlanItem[] = [
    {
      dayIndex: 1,
      dayLabel: "50% Nhu cầu thiết yếu (Needs)",
      mealType: "general",
      itemName: "Tiền thuê nhà, điện nước, ăn uống cơ bản, xăng xe đi lại",
      estimatedPrice: needsAmount,
    },
    {
      dayIndex: 2,
      dayLabel: "30% Mong muốn & Linh hoạt (Wants)",
      mealType: "general",
      itemName: "Cà phê, giải trí, mua sắm cá nhân, ăn ngoài giao lưu",
      estimatedPrice: wantsAmount,
    },
    {
      dayIndex: 3,
      dayLabel: "20% Tiết kiệm & Quỹ dự phòng (Savings/Debt)",
      mealType: "general",
      itemName: "Quỹ khẩn cấp, mục tiêu tiết kiệm dài hạn, trả nợ (nếu có)",
      estimatedPrice: savingsAmount,
    },
  ];

  const totalCost = items.reduce((s, it) => s + it.estimatedPrice, 0);

  const lines: string[] = [
    `### 📊 PHÂN BỔ THU NHẬP THEO NGUYÊN TẮC 50/30/20`,
    `- **Tổng thu nhập cần phân bổ:** **${income.toLocaleString("vi-VN")} VND**`,
    "",
    `1. **50% Nhu cầu thiết yếu (${needsAmount.toLocaleString("vi-VN")} VND):** Dành cho chi phí cố định bắt buộc như nhà ở, thực phẩm cơ bản, điện nước và phương tiện đi lại.`,
    `2. **30% Mong muốn & Nhu cầu cá nhân (${wantsAmount.toLocaleString("vi-VN")} VND):** Dành cho vui chơi, cà phê, sở thích, mua sắm linh hoạt.`,
    `3. **20% Tiết kiệm & Tích lũy (${savingsAmount.toLocaleString("vi-VN")} VND):** Bắt buộc chuyển ngay vào mục tiêu tiết kiệm hoặc quỹ khẩn cấp khi nhận lương.`,
    "",
    `- **Tổng tiền phân bổ:** **${totalCost.toLocaleString("vi-VN")} VND** (Khớp chính xác 100% thu nhập).`,
  ];

  return {
    scope: "INCOME_ALLOCATION",
    constraints,
    isFeasible: true,
    totalEstimatedCost: totalCost,
    remainingFunds: income - totalCost,
    dailyAverageCost: Math.round(income / 30),
    items,
    summaryMarkdown: lines.join("\n"),
    validationNotes,
  };
}

function generateSpendingReductionPlan(
  constraints: PlanConstraints,
  validationNotes: string[],
): BudgetConstrainedPlanResult {
  const budget = constraints.totalBudget;

  const lines: string[] = [
    `### 🛡️ CHIẾN LƯỢC ĐIỀU CHỈNH CHI TIÊU KHI THU NHẬP GIẢM`,
    `- **Mục tiêu:** Cân đối lại dòng tiền, không để thâm hụt số dư khả dụng khi nguồn thu giảm.`,
    "",
    `1. **Bảo vệ chi phí cố định thiết yếu (Ưu tiên số 1):**`,
    `   - Giữ nguyên tiền thuê nhà, học phí, tiền thuốc men.`,
    `   - Kiểm tra điện, nước, internet để giảm hao phí 10-15%.`,
    `2. **Cắt giảm mạnh chi tiêu biến đổi & không thiết yếu (Cắt 50% - 70%):**`,
    `   - Chuyển từ ăn ngoài hàng sang tự nấu ăn tại nhà (tiết kiệm ít nhất 40-50% chi phí ăn uống).`,
    `   - Tạm dừng mua sắm đồ công nghệ, thời trang xa xỉ.`,
    `   - Hủy bỏ các gói xem phim, dịch vụ đăng ký định kỳ không cần thiết.`,
    `3. **Duy trì quỹ khẩn cấp tối thiểu:**`,
    `   - Dù thu nhập giảm, vẫn cố gắng trích tối thiểu 5% - 10% thu nhập để giữ thói quen tích lũy phòng rủi ro.`,
  ];

  return {
    scope: "SPENDING_REDUCTION",
    constraints,
    isFeasible: true,
    totalEstimatedCost: budget,
    remainingFunds: 0,
    dailyAverageCost: Math.round(budget / 30),
    items: [],
    summaryMarkdown: lines.join("\n"),
    validationNotes,
  };
}

function generateSavingsGoalPlan(
  constraints: PlanConstraints,
  validationNotes: string[],
  ctx?: PlanningContext,
): BudgetConstrainedPlanResult {
  const snapshot = ctx?.snapshot || ctx?.serverContext?.snapshot;
  const serverContext = ctx?.serverContext;
  const mode: SavingsQueryMode = constraints.savingsMode || "TARGET_GOAL";

  // 1. Existing goals and current savings state
  const savingsGoals = serverContext?.savingsGoals || [];
  const totalCurrentSaved = savingsGoals.reduce((sum, g) => sum + (Number(g.current_amount) || 0), 0);

  // Match specific goal if user provided a title/keyword
  let targetGoal = savingsGoals[0];
  if (constraints.targetGoalTitle) {
    const keyword = constraints.targetGoalTitle.toLowerCase();
    const found = savingsGoals.find((g) => g.title.toLowerCase().includes(keyword));
    if (found) targetGoal = found;
  }

  // 2. Authoritative Balances & Liquidity
  const totalAssets = snapshot?.totalAssets ?? serverContext?.totalAssets ?? 0;
  const totalAllocated = snapshot?.totalAllocated ?? serverContext?.totalAllocated ?? 0;
  let totalAvailable = snapshot?.totalAvailable ?? serverContext?.totalAvailable ?? 0;

  // Multi-turn active remaining funds override if applicable
  if (constraints.budgetSource === "REMAINING_AFTER_PURCHASE" && ctx?.activePurchaseSimulationRemaining !== undefined) {
    totalAvailable = ctx.activePurchaseSimulationRemaining;
  } else if (constraints.budgetSource === "CASH_AVAILABLE") {
    const cash = snapshot?.enrichedWallets?.find((w) => w.type === "cash" || w.name.toLowerCase().includes("tiền mặt"));
    if (cash) totalAvailable = cash.availableBalance;
  }

  // Upcoming recurring obligations
  const upcomingObligations = serverContext?.upcomingObligations || [];
  const upcomingObligationsTotal =
    serverContext?.upcomingObligationsTotal ??
    upcomingObligations.reduce((sum, r) => sum + r.amount, 0);

  const discretionaryAvailable = Math.max(0, totalAvailable - upcomingObligationsTotal);

  // 3. Data completeness & zero-expense check (Requirement 4)
  const isDataLimited = Boolean(serverContext?.databaseQueryError || serverContext?.hasSufficientData === false);
  const expenseCount = serverContext?.currentMonthExpenseCount ?? 0;
  const hasRecordedExpenses = expenseCount > 0;

  let zeroExpenseNotice = "";
  if (isDataLimited) {
    zeroExpenseNotice = "⚠️ Cảnh báo: Dữ liệu tài chính chưa tải đầy đủ hoặc có lỗi truy vấn cơ sở dữ liệu. Kết quả tính toán có thể chưa phản ánh toàn bộ trạng thái tài khoản.";
    validationNotes.push(zeroExpenseNotice);
  } else if (!hasRecordedExpenses) {
    zeroExpenseNotice = "ℹ️ Lưu ý về chi tiêu: Kỳ này chưa ghi nhận giao dịch chi tiêu nào (0 giao dịch). Hệ thống không mặc định tỷ lệ tiết kiệm đạt 100% khi chưa có dữ liệu chi tiêu thực tế.";
    validationNotes.push(zeroExpenseNotice);
  }

  // Find candidate wallet for concrete allocation proposal (Requirement 6)
  const candidateWallets = snapshot?.enrichedWallets || [];
  const suitableWallet =
    candidateWallets.find((w) => w.availableBalance >= (constraints.userBudgetInput || 0) && w.availableBalance > 0) ||
    candidateWallets.slice().sort((a, b) => b.availableBalance - a.availableBalance)[0];

  const recommendedWalletName = suitableWallet?.name || "Ví khả dụng chính";
  const recommendedWalletAvailable = suitableWallet?.availableBalance ?? totalAvailable;

  const lines: string[] = [];
  let isFeasible = true;
  let targetAmount = constraints.userBudgetInput || constraints.totalBudget || 500_000;
  let effectiveRequired = targetAmount;
  const currentSaved = targetGoal ? Number(targetGoal.current_amount) : totalCurrentSaved;
  let shortfall = 0;
  let maxSpendingAllowed = discretionaryAvailable;
  let feasibilityStatus:
    | "ALREADY_ACHIEVED"
    | "FEASIBLE_IMMEDIATELY"
    | "FEASIBLE_WITH_BUDGET_DISCIPLINE"
    | "INSUFFICIENT_FUNDS_SHORTFALL"
    | "DATA_LIMITED" = "FEASIBLE_IMMEDIATELY";

  if (isDataLimited) {
    feasibilityStatus = "DATA_LIMITED";
  }

  // -------------------------------------------------------------------------
  // Handle MODE: SAVINGS_STATUS (Requirement 2 & 3)
  // -------------------------------------------------------------------------
  if (mode === "SAVINGS_STATUS") {
    lines.push(`### 📊 BÁO CÁO TIẾN ĐỘ VÀ SỐ TIỀN ĐÃ TIẾT KIỆM`);
    lines.push(`- **Tổng số tiền đã tích lũy trong các mục tiêu:** **${totalCurrentSaved.toLocaleString("vi-VN")} VND**`);
    lines.push(`- **Tổng tiền đang phân bổ giữ chỗ trên các ví:** **${totalAllocated.toLocaleString("vi-VN")} VND**`);
    lines.push(`- **Tổng tài sản hiện tại:** **${totalAssets.toLocaleString("vi-VN")} VND**`);
    lines.push(`- **Tổng số dư khả dụng sẵn sàng chi tiêu/tích lũy:** **${totalAvailable.toLocaleString("vi-VN")} VND**`);

    if (upcomingObligationsTotal > 0) {
      lines.push(`- **Nghĩa vụ chi định kỳ sắp tới (Bills/Subscriptions):** **${upcomingObligationsTotal.toLocaleString("vi-VN")} VND** (${upcomingObligations.length} khoản).`);
      lines.push(`- **Khả dụng an toàn sau nghĩa vụ định kỳ:** **${discretionaryAvailable.toLocaleString("vi-VN")} VND**`);
    }

    lines.push("");
    lines.push(`#### 📋 Chi tiết các mục tiêu tiết kiệm trong Supabase:`);
    if (savingsGoals.length === 0) {
      lines.push(`- Bạn chưa tạo mục tiêu tiết kiệm nào trên Sổ Chi Tiêu.`);
      lines.push(`- Bạn có thể vào màn hình **Mục tiêu** để tạo mục tiêu tiết kiệm mới bất cứ lúc nào.`);
    } else {
      for (const g of savingsGoals) {
        const tAmt = Number(g.target_amount) || 0;
        const cAmt = Number(g.current_amount) || 0;
        const rem = Math.max(0, tAmt - cAmt);
        lines.push(`- **Mục tiêu "${g.title}":** Đã tích lũy **${cAmt.toLocaleString("vi-VN")} VND** / **${tAmt.toLocaleString("vi-VN")} VND** (${g.percentProgress}%). Còn thiếu: **${rem.toLocaleString("vi-VN")} VND**${g.deadline ? ` (Hạn chót: ${g.deadline})` : ""}.`);
      }
    }

    if (zeroExpenseNotice) {
      lines.push("");
      lines.push(zeroExpenseNotice);
    }

    lines.push("");
    lines.push(`🔒 **Bảo đảm an toàn giao dịch:** Sổ Chi Tiêu không tự ý thực hiện giao dịch hay chuyển tiền. Bạn vui lòng vào màn hình **Mục tiêu** hoặc **Ví & Tài khoản** trên ứng dụng để quản lý phân bổ an toàn.`);

    return {
      scope: "SAVINGS_GOAL_PLAN",
      constraints,
      isFeasible: true,
      totalEstimatedCost: totalCurrentSaved,
      remainingFunds: totalAvailable,
      dailyAverageCost: Math.round(totalCurrentSaved / 30),
      items: [],
      summaryMarkdown: lines.join("\n"),
      validationNotes,
      savingsDetails: {
        mode: "SAVINGS_STATUS",
        targetAmount: savingsGoals.reduce((s, g) => s + (Number(g.target_amount) || 0), 0),
        currentSavedAmount: totalCurrentSaved,
        effectiveRequiredAmount: 0,
        totalAssets,
        totalAvailable,
        upcomingObligationsTotal,
        discretionaryAvailable,
        shortfall: 0,
        maxSpendingAllowed: discretionaryAvailable,
        feasibilityStatus: "ALREADY_ACHIEVED",
        hasRecordedExpenses,
        safetyNotice: "Sổ Chi Tiêu không tự ý thực hiện giao dịch hay chuyển tiền khi chưa có xác nhận của bạn.",
      },
    };
  }

  // -------------------------------------------------------------------------
  // Handle MODE: ADDITIONAL_SAVINGS (Requirement 2 & 5 & 6)
  // E.g. "Tôi muốn tiết kiệm thêm 500.000đ"
  // -------------------------------------------------------------------------
  if (mode === "ADDITIONAL_SAVINGS") {
    const additionalAmount = constraints.userBudgetInput || constraints.totalBudget || 500_000;
    targetAmount = additionalAmount;
    effectiveRequired = additionalAmount;
    const newTotalSaved = currentSaved + additionalAmount;

    lines.push(`### ➕ KẾ HOẠCH TIẾT KIỆM THÊM (ADDITIONAL SAVINGS)`);
    lines.push(`- **Số tiền muốn tiết kiệm thêm:** **${additionalAmount.toLocaleString("vi-VN")} VND** *(Trích thêm ngoài số tiền đã tích lũy trước đó)*`);
    lines.push(`- **Số tiền đã tích lũy hiện có:** **${currentSaved.toLocaleString("vi-VN")} VND**`);
    lines.push(`- **Tổng tiền tích lũy dự kiến sau khi trích:** **${newTotalSaved.toLocaleString("vi-VN")} VND**`);
    lines.push(`- **Đối chiếu khả dụng tài khoản:**`);
    lines.push(`  + Tổng tài sản: **${totalAssets.toLocaleString("vi-VN")} VND** (Đã phân bổ: ${totalAllocated.toLocaleString("vi-VN")} VND).`);
    lines.push(`  + **Tổng tiền khả dụng chi tiêu/tích lũy:** **${totalAvailable.toLocaleString("vi-VN")} VND** (${constraints.sourceExplanation})`);

    if (upcomingObligationsTotal > 0) {
      lines.push(`  + Nghĩa vụ chi định kỳ sắp tới: **${upcomingObligationsTotal.toLocaleString("vi-VN")} VND** (${upcomingObligations.length} khoản).`);
      lines.push(`  + Khả dụng an toàn (sau nghĩa vụ định kỳ): **${discretionaryAvailable.toLocaleString("vi-VN")} VND**.`);
    }

    lines.push("");
    lines.push(`#### 💰 Kết luận tính khả thi & Đề xuất phân bổ:`);

    if (isDataLimited) {
      feasibilityStatus = "DATA_LIMITED";
      isFeasible = totalAvailable >= effectiveRequired;
      shortfall = Math.max(0, effectiveRequired - totalAvailable);
      maxSpendingAllowed = Math.max(0, totalAvailable - effectiveRequired - upcomingObligationsTotal);
      lines.push(`- **Đánh giá:** ⚠️ **DỮ LIỆU TÀI CHÍNH CHƯA ĐẦY ĐỦ HOẶC LỖI KẾT NỐI**. Kết quả phân tích mang tính chất tham khảo.`);
    } else if (totalAvailable >= effectiveRequired) {
      if (discretionaryAvailable >= effectiveRequired) {
        feasibilityStatus = "FEASIBLE_IMMEDIATELY";
      } else {
        feasibilityStatus = "FEASIBLE_WITH_BUDGET_DISCIPLINE";
      }
      isFeasible = true;
      shortfall = 0;
      maxSpendingAllowed = Math.max(0, totalAvailable - effectiveRequired - upcomingObligationsTotal);

      lines.push(`- **Đánh giá:** ✅ **HOÀN TOÀN ĐỦ TIỀN ĐỂ TIẾT KIỆM THÊM**.`);
      lines.push(`- **Đề xuất phân bổ cụ thể:** Trích **${additionalAmount.toLocaleString("vi-VN")} VND** từ **${recommendedWalletName}** (Hiện có khả dụng **${recommendedWalletAvailable.toLocaleString("vi-VN")} VND**) để chuyển vào quỹ/mục tiêu tiết kiệm.`);
      lines.push(`- **Mức chi tiêu tối đa còn lại:** Sau khi trích tiết kiệm thêm ${additionalAmount.toLocaleString("vi-VN")} VND, bạn còn tối đa **${maxSpendingAllowed.toLocaleString("vi-VN")} VND** khả dụng cho các nhu cầu sinh hoạt khác.`);
    } else {
      feasibilityStatus = "INSUFFICIENT_FUNDS_SHORTFALL";
      isFeasible = false;
      shortfall = effectiveRequired - totalAvailable;
      maxSpendingAllowed = 0;

      lines.push(`- **Đánh giá:** ⚠️ **CHƯA ĐỦ TIỀN ĐỂ TIẾT KIỆM THÊM**.`);
      lines.push(`- **Phần thiếu hụt (Shortfall):** Còn thiếu **${shortfall.toLocaleString("vi-VN")} VND** (Bạn cần ${effectiveRequired.toLocaleString("vi-VN")} VND nhưng hiện chỉ có ${totalAvailable.toLocaleString("vi-VN")} VND khả dụng).`);
      lines.push(`- **Khuyến nghị khắc phục:** Bạn cần gia tăng thu nhập hoặc cắt giảm các chi phí sinh hoạt linh hoạt/không thiết yếu để bù đắp phần thiếu hụt **${shortfall.toLocaleString("vi-VN")} VND** trước khi trích thêm.`);
    }

    if (zeroExpenseNotice) {
      lines.push("");
      lines.push(zeroExpenseNotice);
    }

    lines.push("");
    lines.push(`🔒 **Bảo đảm an toàn giao dịch:** Sổ Chi Tiêu không tự ý thực hiện giao dịch hay chuyển tiền. Bạn vui lòng vào màn hình **Mục tiêu** hoặc **Ví & Tài khoản** trên ứng dụng để xác nhận phân bổ an toàn.`);

    return {
      scope: "SAVINGS_GOAL_PLAN",
      constraints,
      isFeasible,
      totalEstimatedCost: effectiveRequired,
      remainingFunds: isFeasible ? Math.max(0, totalAvailable - effectiveRequired) : 0,
      dailyAverageCost: Math.round(effectiveRequired / 30),
      items: [],
      summaryMarkdown: lines.join("\n"),
      validationNotes,
      savingsDetails: {
        mode: "ADDITIONAL_SAVINGS",
        targetAmount,
        currentSavedAmount: currentSaved,
        effectiveRequiredAmount: effectiveRequired,
        totalAssets,
        totalAvailable,
        upcomingObligationsTotal,
        discretionaryAvailable,
        shortfall,
        maxSpendingAllowed,
        feasibilityStatus,
        hasRecordedExpenses,
        recommendedWalletName,
        recommendedWalletAvailable,
        safetyNotice: "Sổ Chi Tiêu không tự ý thực hiện giao dịch hay chuyển tiền khi chưa có xác nhận của bạn.",
      },
    };
  }

  // -------------------------------------------------------------------------
  // Handle MODE: MAX_SAVINGS_CAPACITY (Requirement 5)
  // E.g. "Tháng này tôi có thể tiết kiệm được bao nhiêu?"
  // -------------------------------------------------------------------------
  if (mode === "MAX_SAVINGS_CAPACITY") {
    const safeCapacity = Math.max(0, discretionaryAvailable);
    isFeasible = safeCapacity > 0;

    lines.push(`### 📈 ĐÁNH GIÁ NĂNG LỰC TIẾT KIỆM TỐI ĐA (MAX SAVINGS CAPACITY)`);
    lines.push(`- **Tổng tài sản hiện có:** **${totalAssets.toLocaleString("vi-VN")} VND** (Đã phân bổ: ${totalAllocated.toLocaleString("vi-VN")} VND).`);
    lines.push(`- **Tổng tiền khả dụng hiện tại:** **${totalAvailable.toLocaleString("vi-VN")} VND** (${constraints.sourceExplanation})`);

    if (upcomingObligationsTotal > 0) {
      lines.push(`- **Nghĩa vụ chi định kỳ sắp tới (Recurring Bills):** **${upcomingObligationsTotal.toLocaleString("vi-VN")} VND** (${upcomingObligations.length} khoản đang kích hoạt).`);
    }

    lines.push(`- **Hạn mức tiết kiệm tối đa an toàn:** **${safeCapacity.toLocaleString("vi-VN")} VND**.`);
    lines.push("");
    lines.push(`#### 💡 Khuyến nghị phân bổ:`);
    if (safeCapacity > 0) {
      lines.push(`- Bạn có thể trích tối đa **${safeCapacity.toLocaleString("vi-VN")} VND** vào quỹ tiết kiệm mà vẫn đảm bảo tuyệt đối khả năng thanh toán các hóa đơn và nghĩa vụ định kỳ.`);
      lines.push(`- **Gợi ý phân bổ:** Trích từ **${recommendedWalletName}** (Hiện có khả dụng: **${recommendedWalletAvailable.toLocaleString("vi-VN")} VND**).`);
    } else {
      lines.push(`- Hiện tại số dư khả dụng không có phần thặng dư sau khi trừ các nghĩa vụ chi. Bạn nên tập trung bảo đảm thanh toán hóa đơn định kỳ trước khi trích thêm quỹ tiết kiệm.`);
    }

    if (zeroExpenseNotice) {
      lines.push("");
      lines.push(zeroExpenseNotice);
    }

    lines.push("");
    lines.push(`🔒 **Bảo đảm an toàn giao dịch:** Sổ Chi Tiêu không tự ý thực hiện giao dịch hay chuyển tiền. Bạn vui lòng vào màn hình **Mục tiêu** hoặc **Ví & Tài khoản** trên ứng dụng để xác nhận phân bổ an toàn.`);

    return {
      scope: "SAVINGS_GOAL_PLAN",
      constraints,
      isFeasible,
      totalEstimatedCost: safeCapacity,
      remainingFunds: Math.max(0, totalAvailable - safeCapacity),
      dailyAverageCost: Math.round(safeCapacity / 30),
      items: [],
      summaryMarkdown: lines.join("\n"),
      validationNotes,
      savingsDetails: {
        mode: "MAX_SAVINGS_CAPACITY",
        targetAmount: safeCapacity,
        currentSavedAmount: totalCurrentSaved,
        effectiveRequiredAmount: safeCapacity,
        totalAssets,
        totalAvailable,
        upcomingObligationsTotal,
        discretionaryAvailable,
        shortfall: 0,
        maxSpendingAllowed: 0,
        feasibilityStatus: safeCapacity > 0 ? "FEASIBLE_IMMEDIATELY" : "INSUFFICIENT_FUNDS_SHORTFALL",
        hasRecordedExpenses,
        recommendedWalletName,
        recommendedWalletAvailable,
        safetyNotice: "Sổ Chi Tiêu không tự ý thực hiện giao dịch hay chuyển tiền khi chưa có xác nhận của bạn.",
      },
    };
  }

  // -------------------------------------------------------------------------
  // Handle MODE: TARGET_GOAL / GENERAL_PLAN (Requirements 2, 4, 5, 6, 7)
  // E.g. "Mục tiêu tiết kiệm 500.000đ", "Tôi muốn tiết kiệm 500k"
  // -------------------------------------------------------------------------
  targetAmount = constraints.userBudgetInput || constraints.totalBudget || 500_000;
  const isGoalAlreadyAchieved = currentSaved >= targetAmount;

  lines.push(`### 🎯 ĐÁNH GIÁ MỤC TIÊU TIẾT KIỆM`);
  lines.push(`- **Mục tiêu đặt ra:** **${targetAmount.toLocaleString("vi-VN")} VND**`);
  lines.push(`- **Số tiền đã tích lũy hiện có:** **${currentSaved.toLocaleString("vi-VN")} VND**${targetGoal ? ` (Mục tiêu "${targetGoal.title}")` : ""}`);

  if (isGoalAlreadyAchieved) {
    feasibilityStatus = "ALREADY_ACHIEVED";
    isFeasible = true;
    effectiveRequired = 0;
    shortfall = 0;
    maxSpendingAllowed = discretionaryAvailable;

    lines.push(`- **Đánh giá:** 🎉 **MỤC TIÊU ĐÃ HOÀN THÀNH (HOÀN TOÀN KHẢ THI)!**`);
    lines.push(`- Bạn đã tích lũy đủ **${currentSaved.toLocaleString("vi-VN")} VND** / **${targetAmount.toLocaleString("vi-VN")} VND** (Đạt ${(Math.round((currentSaved / targetAmount) * 100))}%).`);
    lines.push(`- Bạn không cần phải trích thêm tiền cho mục tiêu này. Số dư khả dụng hiện tại **${totalAvailable.toLocaleString("vi-VN")} VND** có thể sử dụng cho chi tiêu sinh hoạt hoặc đặt mục tiêu mới cao hơn.`);
  } else {
    effectiveRequired = targetAmount - currentSaved;
    const targetMonths = Math.max(1, Math.round(constraints.periodDays / 30));
    const monthlyRequired = Math.round(effectiveRequired / targetMonths);

    lines.push(`- **Số tiền cần bổ sung để về đích:** **${effectiveRequired.toLocaleString("vi-VN")} VND**`);
    if (targetMonths > 1) {
      lines.push(`- **Thời gian thực hiện:** **${targetMonths} tháng** (${constraints.periodDays} ngày)`);
      lines.push(`- **Số tiền cần tiết kiệm mỗi tháng:** **${monthlyRequired.toLocaleString("vi-VN")} VND/tháng** (~${Math.round(monthlyRequired / 30).toLocaleString("vi-VN")} VND/ngày)`);
    }
    lines.push(`- **Đối chiếu khả dụng tài khoản:**`);
    lines.push(`  + Tổng tài sản: **${totalAssets.toLocaleString("vi-VN")} VND** (Đã phân bổ: ${totalAllocated.toLocaleString("vi-VN")} VND).`);
    lines.push(`  + **Tổng tiền khả dụng chi tiêu/tích lũy:** **${totalAvailable.toLocaleString("vi-VN")} VND** (${constraints.sourceExplanation})`);

    if (upcomingObligationsTotal > 0) {
      lines.push(`  + Nghĩa vụ chi định kỳ sắp tới: **${upcomingObligationsTotal.toLocaleString("vi-VN")} VND** (${upcomingObligations.length} khoản).`);
      lines.push(`  + Khả dụng an toàn (sau nghĩa vụ định kỳ): **${discretionaryAvailable.toLocaleString("vi-VN")} VND**.`);
    }

    lines.push("");
    lines.push(`#### 💰 Kết luận tính khả thi & Đề xuất phân bổ:`);

    if (isDataLimited) {
      feasibilityStatus = "DATA_LIMITED";
      isFeasible = totalAvailable >= effectiveRequired;
      shortfall = Math.max(0, effectiveRequired - totalAvailable);
      maxSpendingAllowed = Math.max(0, totalAvailable - effectiveRequired - upcomingObligationsTotal);
      lines.push(`- **Đánh giá:** ⚠️ **DỮ LIỆU TÀI CHÍNH CHƯA ĐẦY ĐỦ HOẶC LỖI KẾT NỐI**. Kết quả phân tích mang tính chất tham khảo.`);
    } else if (totalAvailable >= effectiveRequired) {
      if (discretionaryAvailable >= effectiveRequired) {
        feasibilityStatus = "FEASIBLE_IMMEDIATELY";
      } else {
        feasibilityStatus = "FEASIBLE_WITH_BUDGET_DISCIPLINE";
      }
      isFeasible = true;
      shortfall = 0;
      maxSpendingAllowed = Math.max(0, totalAvailable - effectiveRequired - upcomingObligationsTotal);

      lines.push(`- **Đánh giá:** ✅ **HOÀN TOÀN ĐỦ TIỀN ĐẠT MỤC TIÊU**.`);
      lines.push(`- **Đề xuất phân bổ cụ thể:** Trích **${effectiveRequired.toLocaleString("vi-VN")} VND** từ **${recommendedWalletName}** (Hiện có khả dụng **${recommendedWalletAvailable.toLocaleString("vi-VN")} VND**) để hoàn thành mục tiêu tiết kiệm.`);
      lines.push(`- **Mức chi tiêu tối đa còn lại:** Sau khi phân bổ ${effectiveRequired.toLocaleString("vi-VN")} VND, bạn còn tối đa **${maxSpendingAllowed.toLocaleString("vi-VN")} VND** khả dụng cho các nhu cầu sinh hoạt khác.`);
    } else {
      feasibilityStatus = "INSUFFICIENT_FUNDS_SHORTFALL";
      isFeasible = false;
      shortfall = effectiveRequired - totalAvailable;
      maxSpendingAllowed = 0;

      lines.push(`- **Đánh giá:** ⚠️ **CHƯA ĐỦ TIỀN ĐỂ ĐẠT MỤC TIÊU NGAY**.`);
      lines.push(`- **Phần thiếu hụt (Shortfall):** Còn thiếu **${shortfall.toLocaleString("vi-VN")} VND** (Cần bổ sung ${effectiveRequired.toLocaleString("vi-VN")} VND nhưng hiện chỉ có ${totalAvailable.toLocaleString("vi-VN")} VND khả dụng).`);
      lines.push(`- **Khuyến nghị khắc phục:** Để đạt được mục tiêu ${targetAmount.toLocaleString("vi-VN")} VND, bạn cần gia tăng thu nhập hoặc cắt giảm các chi phí sinh hoạt không thiết yếu để bù đắp phần thiếu hụt **${shortfall.toLocaleString("vi-VN")} VND**.`);
    }
  }

  if (zeroExpenseNotice) {
    lines.push("");
    lines.push(zeroExpenseNotice);
  }

  lines.push("");
  lines.push(`🔒 **Bảo đảm an toàn giao dịch:** Sổ Chi Tiêu không tự ý thực hiện giao dịch hay chuyển tiền. Bạn vui lòng vào màn hình **Mục tiêu** hoặc **Ví & Tài khoản** trên ứng dụng để xác nhận phân bổ an toàn.`);

  return {
    scope: "SAVINGS_GOAL_PLAN",
    constraints,
    isFeasible,
    totalEstimatedCost: effectiveRequired,
    remainingFunds: isFeasible ? Math.max(0, totalAvailable - effectiveRequired) : 0,
    dailyAverageCost: Math.round(effectiveRequired / 30),
    items: [],
    summaryMarkdown: lines.join("\n"),
    validationNotes,
    savingsDetails: {
      mode: "TARGET_GOAL",
      targetAmount,
      currentSavedAmount: currentSaved,
      effectiveRequiredAmount: effectiveRequired,
      totalAssets,
      totalAvailable,
      upcomingObligationsTotal,
      discretionaryAvailable,
      shortfall,
      maxSpendingAllowed,
      feasibilityStatus,
      hasRecordedExpenses,
      recommendedWalletName,
      recommendedWalletAvailable,
      safetyNotice: "Sổ Chi Tiêu không tự ý thực hiện giao dịch hay chuyển tiền khi chưa có xác nhận của bạn.",
    },
  };
}

function generateShoppingBudgetPlan(
  constraints: PlanConstraints,
  validationNotes: string[],
): BudgetConstrainedPlanResult {
  const budget = constraints.totalBudget;

  const lines: string[] = [
    `### 🛍️ KẾ HOẠCH MUA SẮM TRONG NGÂN SÁCH ${budget.toLocaleString("vi-VN")} VND`,
    `- **Ngân sách tối đa cho phép:** **${budget.toLocaleString("vi-VN")} VND**`,
    `- **Nguyên tắc mua sắm thông minh:**`,
    `  1. Lên danh sách những món đồ bắt buộc phải mua trước (Needs), không mua sắm theo cảm hứng ngẫu hứng.`,
    `  2. Tìm kiếm mã giảm giá, khuyến mãi và so sánh giá giữa các nền tảng trước khi thanh toán.`,
    `  3. Luôn giữ lại 10% ngân sách dự phòng cho chi phí phát sinh (phí giao hàng, phụ kiện).`,
  ];

  return {
    scope: "SHOPPING_BUDGET_PLAN",
    constraints,
    isFeasible: true,
    totalEstimatedCost: budget,
    remainingFunds: 0,
    dailyAverageCost: budget,
    items: [],
    summaryMarkdown: lines.join("\n"),
    validationNotes,
  };
}

// ---------------------------------------------------------------------------
// 5. Verification & Sanitization Guardrail for LLM Generated Output
// ---------------------------------------------------------------------------

/**
 * Checks LLM text output against deterministic constraints.
 * If LLM hallucinated lunch/dinner for breakfast query, or math is incorrect,
 * or concluded "enough money" when over budget, this function corrects the text.
 */
export function verifyAndSanitizeBudgetPlan(
  llmOutput: string,
  constraints: PlanConstraints,
  verifiedPlan: BudgetConstrainedPlanResult,
): { sanitizedText: string; corrected: boolean; reasons: string[] } {
  const reasons: string[] = [];
  let corrected = false;
  const text = llmOutput;

  // 1. For BREAKFAST_PLAN: Check for forbidden lunch / dinner mentions
  if (constraints.scope === "BREAKFAST_PLAN") {
    const hasForbiddenLunch = /(?:bữa trưa|ăn trưa|cơm trưa)\b/i.test(text);
    const hasForbiddenDinner = /(?:bữa tối|ăn tối|cơm tối)\b/i.test(text);

    if (hasForbiddenLunch || hasForbiddenDinner) {
      corrected = true;
      reasons.push(
        "Phát hiện LLM tự ý thêm bữa trưa/bữa tối trong khi người dùng chỉ yêu cầu lên thực đơn ăn sáng.",
      );
    }

    // 2. Check day count: Must contain all 7 days for 1 week
    if (constraints.periodDays === 7) {
      const dayMatches = text.match(/(?:ngày\s*[1-7]|thứ\s*(?:hai|ba|tư|năm|sáu|bảy)|chủ nhật)/gi) || [];
      if (dayMatches.length < 5) {
        corrected = true;
        reasons.push("LLM không liệt kê đủ 7 ngày ăn sáng như yêu cầu.");
      }
    }
  }

  // 1b. For SAVINGS_GOAL_PLAN: Guardrails for savings reasoning
  if (constraints.scope === "SAVINGS_GOAL_PLAN") {
    // Check A: 100% savings rate claim when no expenses recorded
    if (verifiedPlan.savingsDetails && !verifiedPlan.savingsDetails.hasRecordedExpenses) {
      if (/tiết kiệm\s*(?:được\s*)?100%|tỷ lệ tiết kiệm\s*(?:là\s*)?100%/i.test(text)) {
        corrected = true;
        reasons.push("LLM kết luận tỷ lệ tiết kiệm 100% trong khi kỳ này chưa có giao dịch chi tiêu nào được ghi nhận.");
      }
    }

    // Check B: Saying user lacks money / needs to cut expenses when verified plan is feasible
    if (verifiedPlan.isFeasible) {
      const saysLacksMoney =
        /(?:không đủ tiền|thiếu tiền|cần cắt giảm|phải cắt giảm|cắt giảm chi tiêu|gia tăng thu nhập|kiếm thêm thu nhập)/i.test(text) &&
        !/không cần cắt giảm|không bắt buộc cắt giảm/i.test(text);
      if (saysLacksMoney) {
        corrected = true;
        reasons.push("LLM khuyên cắt giảm chi tiêu hoặc tăng thu nhập trong khi người dùng hoàn toàn đủ tiền đạt mục tiêu.");
      }
    }

    // Check C: Saying user has enough money when verified plan has a shortfall
    if (!verifiedPlan.isFeasible) {
      const saysHasEnough = /(?:hoàn toàn đủ|đủ tiền|dư sức đạt|dư dả để tiết kiệm)/i.test(text);
      if (saysHasEnough) {
        corrected = true;
        reasons.push("LLM kết luận đủ tiền tiết kiệm trong khi tài khoản đang bị thiếu hụt so với mục tiêu.");
      }
    }

    // Check D: False promise of automatic transaction creation or fund transfer
    if (/(?:tôi đã (?:tạo|trích|chuyển|thực hiện)|hệ thống đã tự động (?:chuyển|trích))/i.test(text)) {
      corrected = true;
      reasons.push("LLM tự nhận đã thực hiện chuyển tiền/tạo giao dịch mà không có xác nhận của người dùng.");
    }
  }

  // 3. Check Over-budget Hallucination:
  // If verifiedPlan is NOT feasible, but LLM says "hoàn toàn đủ", "đủ tiền", "dư dả"
  if (!verifiedPlan.isFeasible) {
    const saysEnough = /(?:hoàn toàn đủ|đủ tiền|thừa tiền|dư dả|dư tiền)/i.test(text);
    if (saysEnough) {
      corrected = true;
      reasons.push("LLM kết luận đủ tiền trong khi tổng chi phí vượt ngân sách cho phép.");
    }
  }

  // 4. Check whether numbers in LLM text claim an over-budget plan is sufficient
  // E.g. "450.000" when budget is "300.000" and concluding "đủ tiền"
  if (constraints.totalBudget > 0) {
    const costMatches = text.matchAll(
      /(?:tổng chi phí|tổng cộng|tổng tiền|hết|phương án|kế hoạch).*?(\d{1,3}(?:\.\d{3})+|\d{4,9})\s*(?:vnd|đ|đồng)?/gi,
    );
    for (const m of costMatches) {
      const val = parseFloat(m[1].replace(/\./g, ""));
      if (val > constraints.totalBudget && /(?:đủ|hoàn toàn đủ|vẫn còn)/i.test(text)) {
        corrected = true;
        reasons.push(
          `LLM đưa ra tổng tiền ${val.toLocaleString("vi-VN")} VND vượt ngân sách ${constraints.totalBudget.toLocaleString("vi-VN")} VND nhưng vẫn kết luận đủ tiền.`,
        );
      }
    }
  }

  // 5. Arithmetic Integrity Check: Sum of individual meal prices must match claimed total
  const itemPriceMatches = Array.from(
    text.matchAll(
      /(?:ngày\s*[1-7]|thứ\s*[^:\n]+):\s*[^-\n]+-\s*(\d{1,3}(?:\.\d{3})+|\d{4,9})\s*(?:vnd|đ|đồng)?/gi,
    ),
  );
  if (itemPriceMatches.length >= 3) {
    const sumOfItems = itemPriceMatches.reduce(
      (acc, m) => acc + parseFloat(m[1].replace(/\./g, "")),
      0,
    );
    const claimedTotalMatch = text.match(
      /(?:tổng cộng|tổng chi phí|tổng tiền|hết).*?(\d{1,3}(?:\.\d{3})+|\d{4,9})\s*(?:vnd|đ|đồng)?/i,
    );
    if (claimedTotalMatch) {
      const claimedVal = parseFloat(claimedTotalMatch[1].replace(/\./g, ""));
      if (Math.abs(sumOfItems - claimedVal) > 1000) {
        corrected = true;
        reasons.push(
          `Sai lệch toán học: tổng cộng các bữa ăn (${sumOfItems.toLocaleString("vi-VN")} VND) không khớp với số tiền công bố (${claimedVal.toLocaleString("vi-VN")} VND).`,
        );
      }
    }
  }

  // 6. Check Supabase budget cross-reference & price estimate notice
  if (
    constraints.categoryBudgetStatus &&
    !text.includes(constraints.categoryBudgetStatus.name) &&
    !text.includes("Ngân sách")
  ) {
    corrected = true;
    reasons.push("Thiếu đối chiếu ngân sách danh mục hiện có trong Supabase.");
  }
  // 6. Check price estimate notice & append disclaimer if missing
  let finalSanitizedText = text;
  if (!finalSanitizedText.toLowerCase().includes("ước tính") && !finalSanitizedText.toLowerCase().includes("uoc tinh")) {
    finalSanitizedText += "\n\n*(Lưu ý: Mức giá trên là giá ước tính theo thị trường Việt Nam).*";
  }

  if (corrected) {
    return {
      sanitizedText: verifiedPlan.summaryMarkdown,
      corrected: true,
      reasons,
    };
  }

  return { sanitizedText: finalSanitizedText, corrected: false, reasons: [] };
}
