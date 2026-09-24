import type { Transaction, Category, Budget, SavingsGoal } from "../types/finance.types";
import { inRange, periodBounds } from "../utils/finance.utils.ts";

export interface CategoryComparison {
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  currentAmount: number;
  previousAmount: number;
  percentChange: number; // positive = increased spending, negative = decreased
  difference: number;
}

export interface FinancialAnomaly {
  id: string;
  type: "large_transaction" | "category_spike" | "spending_pace";
  severity: "info" | "warning" | "danger";
  title: string;
  description: string;
  amount?: number;
  relatedId?: string;
}

export interface FinancialInsightsResult {
  currentIncome: number;
  currentExpense: number;
  previousIncome: number;
  previousExpense: number;
  netCashFlow: number;
  savingsRate: number; // percentage 0-100 (or negative if overspent)
  dailyAverageExpense: number;
  projectedMonthExpense: number;
  expenseChangePercent: number; // vs previous month
  incomeChangePercent: number; // vs previous month
  topCategories: Array<{
    id: string;
    name: string;
    amount: number;
    percentage: number;
    color: string;
  }>;
  categoryComparisons: CategoryComparison[];
  anomalies: FinancialAnomaly[];
  insightBullets: string[];
}

/**
 * Calculates deterministic, data-backed financial insights for a specified month.
 * All numbers are computed strictly from verified transactions and budgets without hallucinations.
 */
export function calculateFinancialInsights(
  transactions: Transaction[],
  categories: Category[],
  budgets: Budget[] = [],
  goals: SavingsGoal[] = [],
  referenceDate: Date = new Date(),
): FinancialInsightsResult {
  const categoryMap = new Map(categories.map((c) => [c.id, c]));

  // Bounds for current and previous month
  const currentBounds = periodBounds("month", 0, referenceDate);
  const previousBounds = periodBounds("month", -1, referenceDate);

  const currentTxs = transactions.filter((t) => inRange(t, currentBounds.start, currentBounds.end));
  const previousTxs = transactions.filter((t) => inRange(t, previousBounds.start, previousBounds.end));

  let currentIncome = 0;
  let currentExpense = 0;
  const currentCategoryExpense = new Map<string, number>();

  for (const t of currentTxs) {
    if (t.type === "income") {
      currentIncome += t.amount;
    } else {
      currentExpense += t.amount;
      const catId = t.category_id ?? t.category;
      currentCategoryExpense.set(catId, (currentCategoryExpense.get(catId) ?? 0) + t.amount);
    }
  }

  let previousIncome = 0;
  let previousExpense = 0;
  const previousCategoryExpense = new Map<string, number>();

  for (const t of previousTxs) {
    if (t.type === "income") {
      previousIncome += t.amount;
    } else {
      previousExpense += t.amount;
      const catId = t.category_id ?? t.category;
      previousCategoryExpense.set(catId, (previousCategoryExpense.get(catId) ?? 0) + t.amount);
    }
  }

  const netCashFlow = currentIncome - currentExpense;
  const savingsRate = currentIncome > 0
    ? Math.round(((currentIncome - currentExpense) / currentIncome) * 100)
    : 0;

  // Days in month calculation for spending pace
  const daysInMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0).getDate();
  const isCurrentMonthNow =
    referenceDate.getFullYear() === new Date().getFullYear() &&
    referenceDate.getMonth() === new Date().getMonth();
  const daysPassed = isCurrentMonthNow ? Math.max(1, new Date().getDate()) : daysInMonth;

  const dailyAverageExpense = Math.round(currentExpense / daysPassed);
  const projectedMonthExpense = isCurrentMonthNow
    ? Math.round((currentExpense / daysPassed) * daysInMonth)
    : currentExpense;

  const expenseChangePercent = previousExpense > 0
    ? Math.round(((currentExpense - previousExpense) / previousExpense) * 100)
    : 0;

  const incomeChangePercent = previousIncome > 0
    ? Math.round(((currentIncome - previousIncome) / previousIncome) * 100)
    : 0;

  // Top categories
  const topCategories = [...currentCategoryExpense.entries()]
    .map(([id, amount]) => {
      const cat = categoryMap.get(id);
      const percentage = currentExpense > 0 ? Math.round((amount / currentExpense) * 100) : 0;
      return {
        id,
        name: cat?.name ?? id,
        amount,
        percentage,
        color: cat?.color ?? "#98A1A5",
      };
    })
    .sort((a, b) => b.amount - a.amount);

  // Category comparisons
  const allCategoryIds = new Set([...currentCategoryExpense.keys(), ...previousCategoryExpense.keys()]);
  const categoryComparisons: CategoryComparison[] = [];

  for (const catId of allCategoryIds) {
    const cur = currentCategoryExpense.get(catId) ?? 0;
    const prev = previousCategoryExpense.get(catId) ?? 0;
    const diff = cur - prev;
    const pct = prev > 0 ? Math.round((diff / prev) * 100) : (cur > 0 ? 100 : 0);
    const cat = categoryMap.get(catId);

    categoryComparisons.push({
      categoryId: catId,
      categoryName: cat?.name ?? catId,
      categoryColor: cat?.color ?? "#98A1A5",
      currentAmount: cur,
      previousAmount: prev,
      percentChange: pct,
      difference: diff,
    });
  }
  categoryComparisons.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

  // Anomalies detection
  const anomalies: FinancialAnomaly[] = [];

  // 1. Unusually large single transaction (> 30% of total monthly expense)
  if (currentExpense > 0) {
    for (const t of currentTxs) {
      if (t.type === "expense" && t.amount >= currentExpense * 0.3 && t.amount >= 200_000) {
        anomalies.push({
          id: `large_tx_${t.id}`,
          type: "large_transaction",
          severity: "warning",
          title: "Khoản chi lớn đột biến",
          description: `Giao dịch "${t.title}" chiếm ${Math.round((t.amount / currentExpense) * 100)}% tổng chi tiêu tháng này.`,
          amount: t.amount,
          relatedId: t.id,
        });
      }
    }
  }

  // 2. Category spending spike (> 25% increase vs last month with >= 100k difference)
  for (const cmp of categoryComparisons) {
    if (cmp.previousAmount > 0 && cmp.percentChange >= 25 && cmp.difference >= 100_000) {
      anomalies.push({
        id: `cat_spike_${cmp.categoryId}`,
        type: "category_spike",
        severity: cmp.percentChange >= 50 ? "danger" : "warning",
        title: `Chi tiêu "${cmp.categoryName}" tăng vọt`,
        description: `Chi tiêu cho ${cmp.categoryName} tăng ${cmp.percentChange}% (+${cmp.difference.toLocaleString("vi-VN")}đ) so với tháng trước.`,
        amount: cmp.difference,
        relatedId: cmp.categoryId,
      });
    }
  }

  // Generate structured textual insight bullets
  const insightBullets: string[] = [];

  if (currentExpense > 0 && previousExpense > 0) {
    if (expenseChangePercent > 10) {
      insightBullets.push(
        `Chi tiêu tháng này đang cao hơn tháng trước ${expenseChangePercent}% (+${(currentExpense - previousExpense).toLocaleString("vi-VN")}đ).`,
      );
    } else if (expenseChangePercent < -10) {
      insightBullets.push(
        `Bạn đã tiết kiệm hơn tháng trước ${Math.abs(expenseChangePercent)}% (-${Math.abs(currentExpense - previousExpense).toLocaleString("vi-VN")}đ).`,
      );
    } else {
      insightBullets.push("Mức chi tiêu duy trì ổn định so với tháng trước (chênh lệch dưới 10%).");
    }
  }

  if (savingsRate >= 30) {
    insightBullets.push(`Tỷ lệ tích lũy đạt mức xuất sắc ${savingsRate}% thu nhập.`);
  } else if (savingsRate > 0 && savingsRate < 15) {
    insightBullets.push(`Tỷ lệ tích lũy hiện đạt ${savingsRate}%. Bạn có thể cân nhắc cắt giảm các nhóm chi tiêu không thiết yếu.`);
  } else if (currentIncome > 0 && currentExpense > currentIncome) {
    insightBullets.push(`Cảnh báo dòng tiền âm: Chi tiêu đã vượt thu nhập ${(currentExpense - currentIncome).toLocaleString("vi-VN")}đ.`);
  }

  if (topCategories.length > 0) {
    const top = topCategories[0];
    insightBullets.push(`Nhóm chi nhiều nhất: "${top.name}" với ${top.amount.toLocaleString("vi-VN")}đ (${top.percentage}% tổng chi).`);
  }

  for (const b of budgets) {
    if (b.status === "active" && b.amount > 0) {
      const spent = currentTxs
        .filter((t) => t.type === "expense" && (!b.category_id || t.category_id === b.category_id))
        .reduce((sum, t) => sum + t.amount, 0);
      if (spent > b.amount) {
        insightBullets.push(`Ngân sách "${b.name}" đã chi vượt hạn mức (${Math.round((spent / b.amount) * 100)}%).`);
      }
    }
  }

  for (const g of goals) {
    if (g.target_amount > 0 && g.current_amount >= g.target_amount) {
      insightBullets.push(`Mục tiêu tích lũy "${g.title}" đã hoàn thành 100%!`);
    }
  }

  return {
    currentIncome,
    currentExpense,
    previousIncome,
    previousExpense,
    netCashFlow,
    savingsRate,
    dailyAverageExpense,
    projectedMonthExpense,
    expenseChangePercent,
    incomeChangePercent,
    topCategories,
    categoryComparisons,
    anomalies,
    insightBullets,
  };
}
