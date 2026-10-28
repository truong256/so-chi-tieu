/**
 * frontend/utils/budget-calculations.ts
 * =====================================
 * Standardized financial domain calculations for Budget Management (Envelope & Limit Budgeting).
 *
 * Implements strict separation between 4 financial concepts:
 * 1. Spending Limit (Hạn mức ngân sách - amount)
 * 2. Allocated Envelope Funds (Tiền đã phân bổ từ ví - allocated_amount)
 * 3. Actual Spending in Category & Period (Chi tiêu thực tế)
 * 4. Funded Remaining Balance (Số dư quỹ ngân sách được cấp vốn - remaining_amount)
 */

import type { Budget, Transaction } from "../types/finance.types";
import { inRange, periodBounds } from "./finance.utils.ts";

export type BudgetStatusVariant =
  | "normal"
  | "near_limit"
  | "reached_limit"
  | "exceeded_limit"
  | "out_of_funds"
  | "closed";

export interface BudgetMetrics {
  /** Hạn mức chi tiêu tối đa trong kỳ (amount) */
  limit: number;
  /** Tiền thực tế đã được trích từ ví để cấp vốn (allocated_amount) */
  allocated: number;
  /** Số dư quỹ ngân sách còn lại được cấp vốn (remaining_amount) */
  fundedRemaining: number;
  /** Tổng chi tiêu thực tế thuộc danh mục trong kỳ */
  actualSpent: number;
  /** Hạn mức chi tiêu còn lại (max(0, limit - actualSpent)) */
  limitRemaining: number;
  /** Tỷ lệ sử dụng hạn mức (0 - 100+%) */
  usagePercent: number;
  /** Đã vượt hạn mức chi tiêu (> 100%) */
  isOverLimit: boolean;
  /** Sắp đạt hạn mức chi tiêu (>= alert_percent và <= 100%) */
  isNearLimit: boolean;
  /** Đạt đúng 100% hạn mức chi tiêu */
  isReachedLimit: boolean;
  /** Có sử dụng cơ chế cấp vốn từ ví */
  isFunded: boolean;
  /** Đã tiêu hết quỹ tiền được cấp vốn từ ví (remaining_amount <= 0) */
  isOutOfFunds: boolean;
  /** Trạng thái nghiệp vụ chuẩn hóa */
  statusVariant: BudgetStatusVariant;
  /** Nhãn trạng thái hiển thị bằng tiếng Việt */
  statusLabelVi: string;
  /** Nhãn trạng thái hiển thị bằng tiếng Anh */
  statusLabelEn: string;
  /** Khoảng thời gian của kỳ ngân sách */
  periodRange: {
    start: Date;
    end: Date;
  };
}

/**
 * Calculates start and end Date for a given budget's current period.
 */
export function getBudgetPeriodBounds(
  budget: Budget,
  referenceDate?: Date,
): { start: Date; end: Date } {
  let ref: Date;
  if (referenceDate) {
    ref = referenceDate;
  } else if (budget.period_start) {
    const parts = String(budget.period_start).split("-").map(Number);
    if (parts.length >= 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
      ref = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
    } else {
      ref = new Date(budget.period_start);
    }
  } else {
    ref = new Date();
  }

  const period = budget.period === "weekly" ? "week" : budget.period === "yearly" ? "year" : "month";
  return periodBounds(period, 0, ref);
}

/**
 * Calculates total actual expenses in the category and period of a budget.
 * Includes both direct wallet expenses and budget envelope expenses.
 * Ensures zero double-counting.
 */
export function calculateBudgetSpending(
  budget: Budget,
  transactions: Transaction[],
  referenceDate?: Date,
): number {
  const bounds = getBudgetPeriodBounds(budget, referenceDate);

  let totalSpent = 0;
  for (const tx of transactions) {
    if (tx.type !== "expense") continue;

    // Must be within current period bounds
    if (!inRange(tx, bounds.start, bounds.end)) continue;

    // If budget specifies a category, must match category
    if (budget.category_id && tx.category_id !== budget.category_id) continue;

    // Add amount
    totalSpent += Number(tx.amount) || 0;
  }

  return totalSpent;
}

/**
 * Comprehensive metrics calculator for a budget.
 */
export function calculateBudgetMetrics(
  budget: Budget,
  transactions: Transaction[],
  referenceDate?: Date,
): BudgetMetrics {
  const limit = Math.max(0, Number(budget.amount) || 0);
  const allocated = Math.max(0, Number(budget.allocated_amount) || 0);
  const fundedRemaining = Math.max(0, Number(budget.remaining_amount) || 0);
  const isFunded = allocated > 0 && Boolean(budget.source_wallet_id);
  const isOutOfFunds = isFunded && fundedRemaining <= 0;

  const periodRange = getBudgetPeriodBounds(budget, referenceDate);
  const actualSpent = calculateBudgetSpending(budget, transactions, referenceDate);
  const limitRemaining = Math.max(0, limit - actualSpent);

  const usagePercent =
    limit > 0 ? Math.round((actualSpent / limit) * 1000) / 10 : 0;

  const isOverLimit = limit > 0 && actualSpent > limit;
  const isReachedLimit = limit > 0 && actualSpent === limit;
  const isNearLimit =
    limit > 0 && !isOverLimit && !isReachedLimit && usagePercent >= (budget.alert_percent || 80);

  const isClosed = budget.status === "completed" || budget.status === "cancelled";

  let statusVariant: BudgetStatusVariant = "normal";
  let statusLabelVi = "Bình thường";
  let statusLabelEn = "Normal";

  if (isClosed) {
    statusVariant = "closed";
    statusLabelVi = budget.status === "completed" ? "Đã hoàn thành" : "Đã đóng";
    statusLabelEn = budget.status === "completed" ? "Completed" : "Closed";
  } else if (isOverLimit) {
    statusVariant = "exceeded_limit";
    statusLabelVi = "Vượt hạn mức";
    statusLabelEn = "Over Limit";
  } else if (isReachedLimit) {
    statusVariant = "reached_limit";
    statusLabelVi = "Đã đạt hạn mức";
    statusLabelEn = "Limit Reached";
  } else if (isNearLimit) {
    statusVariant = "near_limit";
    statusLabelVi = "Sắp đạt hạn mức";
    statusLabelEn = "Near Limit";
  } else if (isOutOfFunds) {
    statusVariant = "out_of_funds";
    statusLabelVi = "Hết tiền cấp vốn";
    statusLabelEn = "Out of Funds";
  }

  return {
    limit,
    allocated,
    fundedRemaining,
    actualSpent,
    limitRemaining,
    usagePercent,
    isOverLimit,
    isNearLimit,
    isReachedLimit,
    isFunded,
    isOutOfFunds,
    statusVariant,
    statusLabelVi,
    statusLabelEn,
    periodRange,
  };
}
