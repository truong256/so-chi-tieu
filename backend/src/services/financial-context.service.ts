/**
 * backend/src/services/financial-context.service.ts
 * ==================================================
 * Server-side trusted financial context builder for Financial Copilot AI.
 *
 * CRITICAL SECURITY & ACCURACY RULES:
 * 1. Client-supplied financial figures (balances, expenses, incomes) are NEVER trusted.
 * 2. All data is fetched server-side using the verified user's Supabase token with RLS.
 * 3. Deterministic code performs all math (totals, percentages, period comparisons).
 * 4. Multi-currency awareness: VND and foreign currencies (e.g. USD) are NEVER summed together.
 * 5. Timezone: strictly pinned to Asia/Ho_Chi_Minh (UTC+7).
 * 6. Protection against prompt injection in user-defined wallet names, categories, and titles.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Wallet, Transaction, Budget, SavingsGoal } from "@/frontend/types/finance.types";

export interface ServerWalletSummary {
  name: string;
  type: string;
  balance: number;
  currency: string;
}

export interface ServerCategorySpend {
  category: string;
  currentAmount: number;
  previousAmount: number;
  difference: number;
  percentChange: number | null; // null if previous was 0
}

export interface ServerBudgetSummary {
  name: string;
  amount: number;
  spent_amount: number;
  remaining_amount: number;
  percentUsed: number;
  status: string;
  isOverBudget: boolean;
  isNearLimit: boolean; // >= 80%
}

export interface ServerSavingsGoalSummary {
  title: string;
  current_amount: number;
  target_amount: number;
  percentProgress: number;
  deadline: string | null;
}

export interface ServerFinancialContext {
  userId: string;
  asOf: string; // e.g. "2026-09-29 22:30:00 (UTC+7)"
  currentPeriod: string; // e.g. "Tháng 09/2026"
  previousPeriod: string; // e.g. "Tháng 08/2026"
  timezone: string; // "Asia/Ho_Chi_Minh (UTC+7)"

  // Balances grouped by currency (NO cross-currency additions)
  balancesByCurrency: Record<string, number>;
  primaryCurrency: string;

  // Current Month Totals (per primary currency)
  currentMonthIncome: number;
  currentMonthExpense: number;
  currentMonthNetSavings: number;
  currentMonthSavingsRate: number; // percentage 0-100

  // Previous Month Totals
  previousMonthIncome: number;
  previousMonthExpense: number;
  expenseChangeVsPreviousMonth: {
    difference: number;
    percentChange: number | null;
  };

  // Top spending categories current month
  topCategories: ServerCategorySpend[];
  highestSpendingCategory: { category: string; amount: number; percentage: number } | null;

  // Wallets, Budgets, Savings Goals
  wallets: ServerWalletSummary[];
  budgets: ServerBudgetSummary[];
  savingsGoals: ServerSavingsGoalSummary[];

  // Recent transactions (reference only, max 20)
  recentTransactions: Array<{
    title: string;
    amount: number;
    currency: string;
    type: "income" | "expense";
    category: string;
    date: string;
  }>;

  // Pre-calculated What-If helpers
  whatIfContext: {
    sample500kImpacts: Array<{
      budgetName: string;
      currentRemaining: number;
      remainingAfter500k: number;
      wouldExceed: boolean;
    }>;
  };

  hasSufficientData: boolean;
  dataLimitationsNotice?: string;
}

/**
 * Vietnam Timezone (UTC+7) Date Helper
 */
export function getVietnamTimeBounds(referenceDate = new Date()): {
  nowIso: string;
  currentMonthLabel: string;
  previousMonthLabel: string;
  currentStartIso: string;
  currentEndIso: string;
  previousStartIso: string;
  previousEndIso: string;
} {
  // Offset +7 hours = +420 minutes
  const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
  const vnNow = new Date(referenceDate.getTime() + VN_OFFSET_MS);

  const year = vnNow.getUTCFullYear();
  const month = vnNow.getUTCMonth(); // 0-indexed (0 = Jan, 8 = Sep)

  // Current month bounds in UTC
  const currentStartUtc = new Date(Date.UTC(year, month, 1) - VN_OFFSET_MS);
  const currentEndUtc = new Date(Date.UTC(year, month + 1, 1) - VN_OFFSET_MS);

  // Previous month bounds in UTC
  const prevYear = month === 0 ? year - 1 : year;
  const prevMonth = month === 0 ? 11 : month - 1;
  const previousStartUtc = new Date(Date.UTC(prevYear, prevMonth, 1) - VN_OFFSET_MS);
  const previousEndUtc = currentStartUtc;

  const pad = (n: number) => String(n).padStart(2, "0");
  const currentMonthLabel = `Tháng ${pad(month + 1)}/${year}`;
  const previousMonthLabel = `Tháng ${pad(prevMonth + 1)}/${prevYear}`;

  const nowFormatted = `${year}-${pad(month + 1)}-${pad(vnNow.getUTCDate())} ${pad(vnNow.getUTCHours())}:${pad(vnNow.getUTCMinutes())}:${pad(vnNow.getUTCSeconds())} (UTC+7)`;

  return {
    nowIso: nowFormatted,
    currentMonthLabel,
    previousMonthLabel,
    currentStartIso: currentStartUtc.toISOString(),
    currentEndIso: currentEndUtc.toISOString(),
    previousStartIso: previousStartUtc.toISOString(),
    previousEndIso: previousEndUtc.toISOString(),
  };
}

/**
 * Fetch and build trusted financial context server-side.
 */
export async function buildServerFinancialContext(
  supabaseUrl: string,
  supabaseKey: string,
  userToken: string,
  userId: string,
): Promise<ServerFinancialContext> {
  const userClient: SupabaseClient = createClient(supabaseUrl, supabaseKey, {
    global: {
      headers: {
        Authorization: `Bearer ${userToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const timeBounds = getVietnamTimeBounds();

  // Fetch wallets, budgets, goals, and transactions concurrently with RLS enforcement
  const [walletsRes, budgetsRes, goalsRes, currentTxsRes, prevTxsRes] = await Promise.all([
    userClient
      .from("wallets")
      .select("id, name, type, balance, currency")
      .eq("user_id", userId),
    userClient
      .from("budgets")
      .select("id, name, amount, spent_amount, remaining_amount, period, status")
      .eq("user_id", userId),
    userClient
      .from("savings_goals")
      .select("id, title, target_amount, current_amount, deadline")
      .eq("user_id", userId),
    userClient
      .from("transactions")
      .select("id, title, amount, type, category, occurred_at, wallet_id")
      .eq("user_id", userId)
      .gte("occurred_at", timeBounds.currentStartIso)
      .lt("occurred_at", timeBounds.currentEndIso)
      .order("occurred_at", { ascending: false }),
    userClient
      .from("transactions")
      .select("id, title, amount, type, category, occurred_at, wallet_id")
      .eq("user_id", userId)
      .gte("occurred_at", timeBounds.previousStartIso)
      .lt("occurred_at", timeBounds.previousEndIso),
  ]);

  const wallets = (walletsRes.data ?? []) as Wallet[];
  const budgets = (budgetsRes.data ?? []) as Budget[];
  const goals = (goalsRes.data ?? []) as SavingsGoal[];
  const currentTxs = (currentTxsRes.data ?? []) as Transaction[];
  const prevTxs = (prevTxsRes.data ?? []) as Transaction[];

  // 1. Group balances by currency (NO cross-currency sum)
  const balancesByCurrency: Record<string, number> = {};
  for (const w of wallets) {
    const cur = (w.currency || "VND").toUpperCase();
    const bal = Number.isFinite(Number(w.balance)) ? Number(w.balance) : 0;
    balancesByCurrency[cur] = (balancesByCurrency[cur] || 0) + bal;
  }

  const primaryCurrency = Object.keys(balancesByCurrency)[0] || "VND";

  // 2. Compute current month income and expense
  let currentMonthIncome = 0;
  let currentMonthExpense = 0;
  const currentCategorySpend = new Map<string, number>();

  for (const t of currentTxs) {
    const amt = Number.isFinite(Number(t.amount)) ? Math.max(0, Number(t.amount)) : 0;
    if (t.type === "income") {
      currentMonthIncome += amt;
    } else {
      currentMonthExpense += amt;
      const cat = (t.category || "Khác").trim();
      currentCategorySpend.set(cat, (currentCategorySpend.get(cat) || 0) + amt);
    }
  }

  // 3. Compute previous month income and expense
  let previousMonthIncome = 0;
  let previousMonthExpense = 0;
  const prevCategorySpend = new Map<string, number>();

  for (const t of prevTxs) {
    const amt = Number.isFinite(Number(t.amount)) ? Math.max(0, Number(t.amount)) : 0;
    if (t.type === "income") {
      previousMonthIncome += amt;
    } else {
      previousMonthExpense += amt;
      const cat = (t.category || "Khác").trim();
      prevCategorySpend.set(cat, (prevCategorySpend.get(cat) || 0) + amt);
    }
  }

  // 4. Net savings and rate
  const currentMonthNetSavings = currentMonthIncome - currentMonthExpense;
  const currentMonthSavingsRate =
    currentMonthIncome > 0
      ? Math.round(((currentMonthIncome - currentMonthExpense) / currentMonthIncome) * 100)
      : 0;

  // 5. Expense comparison vs previous month
  const expenseDiff = currentMonthExpense - previousMonthExpense;
  const expensePercentChange =
    previousMonthExpense > 0
      ? Math.round((expenseDiff / previousMonthExpense) * 1000) / 10
      : null;

  // 6. Category breakdown and comparisons
  const allCategories = new Set([
    ...currentCategorySpend.keys(),
    ...prevCategorySpend.keys(),
  ]);

  const topCategories: ServerCategorySpend[] = Array.from(allCategories)
    .map((cat) => {
      const cur = currentCategorySpend.get(cat) || 0;
      const prev = prevCategorySpend.get(cat) || 0;
      const diff = cur - prev;
      const pct = prev > 0 ? Math.round((diff / prev) * 1000) / 10 : null;
      return {
        category: cat,
        currentAmount: cur,
        previousAmount: prev,
        difference: diff,
        percentChange: pct,
      };
    })
    .sort((a, b) => b.currentAmount - a.currentAmount);

  const highestCat = topCategories[0];
  const highestSpendingCategory =
    highestCat && highestCat.currentAmount > 0
      ? {
          category: highestCat.category,
          amount: highestCat.currentAmount,
          percentage:
            currentMonthExpense > 0
              ? Math.round((highestCat.currentAmount / currentMonthExpense) * 1000) / 10
              : 0,
        }
      : null;

  // 7. Process budgets
  const budgetSummaries: ServerBudgetSummary[] = budgets.map((b) => {
    const amt = Number(b.amount) || 0;
    const spent = Number(b.spent_amount) || 0;
    const rem = Number(b.remaining_amount) ?? (amt - spent);
    const pct = amt > 0 ? Math.round((spent / amt) * 100) : 0;
    return {
      name: b.name,
      amount: amt,
      spent_amount: spent,
      remaining_amount: rem,
      percentUsed: pct,
      status: b.status || "active",
      isOverBudget: spent > amt,
      isNearLimit: pct >= 80,
    };
  });

  // 8. Process savings goals
  const goalSummaries: ServerSavingsGoalSummary[] = goals.map((g) => {
    const cur = Number(g.current_amount) || 0;
    const target = Number(g.target_amount) || 0;
    const pct = target > 0 ? Math.round((cur / target) * 100) : 0;
    return {
      title: g.title,
      current_amount: cur,
      target_amount: target,
      percentProgress: pct,
      deadline: g.deadline,
    };
  });

  // 9. Process wallets
  const walletSummaries: ServerWalletSummary[] = wallets.map((w) => ({
    name: w.name,
    type: w.type,
    balance: Number(w.balance) || 0,
    currency: (w.currency || "VND").toUpperCase(),
  }));

  // 10. Recent transactions (clean, max 20)
  const recentTransactions = currentTxs.slice(0, 20).map((t) => ({
    title: t.title,
    amount: Number(t.amount) || 0,
    currency: primaryCurrency,
    type: (t.type === "income" ? "income" : "expense") as "income" | "expense",
    category: t.category || "Khác",
    date: t.occurred_at ? t.occurred_at.slice(0, 10) : "",
  }));

  // 11. Pre-calculate What-If for 500,000 VND
  const sample500kImpacts = budgetSummaries.map((b) => ({
    budgetName: b.name,
    currentRemaining: b.remaining_amount,
    remainingAfter500k: b.remaining_amount - 500_000,
    wouldExceed: b.remaining_amount - 500_000 < 0,
  }));

  const hasSufficientData =
    wallets.length > 0 || currentTxs.length > 0 || budgets.length > 0;

  return {
    userId,
    asOf: timeBounds.nowIso,
    currentPeriod: timeBounds.currentMonthLabel,
    previousPeriod: timeBounds.previousMonthLabel,
    timezone: "Asia/Ho_Chi_Minh (UTC+7)",
    balancesByCurrency,
    primaryCurrency,
    currentMonthIncome,
    currentMonthExpense,
    currentMonthNetSavings,
    currentMonthSavingsRate,
    previousMonthIncome,
    previousMonthExpense,
    expenseChangeVsPreviousMonth: {
      difference: expenseDiff,
      percentChange: expensePercentChange,
    },
    topCategories: topCategories.slice(0, 10),
    highestSpendingCategory,
    wallets: walletSummaries,
    budgets: budgetSummaries,
    savingsGoals: goalSummaries,
    recentTransactions,
    whatIfContext: {
      sample500kImpacts,
    },
    hasSufficientData,
    dataLimitationsNotice: !hasSufficientData
      ? "Người dùng chưa có dữ liệu giao dịch hoặc ví nào trong hệ thống."
      : undefined,
  };
}

/**
 * Format ServerFinancialContext into protected prompt context string.
 * Escapes user-defined fields and encloses them in untrusted data delimiters.
 */
export function formatServerFinancialContextForPrompt(
  ctx: ServerFinancialContext,
  currentPage?: string,
): string {
  const sanitize = (text: string) =>
    text.replace(/[<>{}\\]/g, "").slice(0, 80);

  const formatMoney = (amount: number, currency: string) => {
    return `${amount.toLocaleString("vi-VN")} ${currency}`;
  };

  const lines: string[] = [
    "=== XÁC THỰC DỮ LIỆU TÀI CHÍNH TỪ MÁY CHỦ (SERVER-VERIFIED) ===",
    `Thời điểm cập nhật: ${ctx.asOf}`,
    `Múi giờ hệ thống: ${ctx.timezone}`,
    `Kỳ hiện tại: ${ctx.currentPeriod}`,
    `Kỳ trước: ${ctx.previousPeriod}`,
  ];

  if (currentPage) {
    lines.push(`Màn hình người dùng đang xem: ${sanitize(currentPage)}`);
  }

  // Balances
  lines.push("\n[SỐ DƯ KHẢ DỤNG THEO TIỀN TỆ]");
  for (const [cur, bal] of Object.entries(ctx.balancesByCurrency)) {
    lines.push(`- Tổng số dư ${cur}: ${bal.toLocaleString("vi-VN")} ${cur}`);
  }

  // Current Month Summary
  lines.push(`\n[TỔNG KẾT TÀI CHÍNH ${ctx.currentPeriod.toUpperCase()}]`);
  lines.push(`- Tổng thu nhập: ${formatMoney(ctx.currentMonthIncome, ctx.primaryCurrency)}`);
  lines.push(`- Tổng chi tiêu: ${formatMoney(ctx.currentMonthExpense, ctx.primaryCurrency)}`);
  lines.push(`- Tiết kiệm ròng: ${formatMoney(ctx.currentMonthNetSavings, ctx.primaryCurrency)}`);
  lines.push(`- Tỷ lệ tiết kiệm: ${ctx.currentMonthSavingsRate}%`);

  // Previous Month Comparison
  lines.push(`\n[SO SÁNH VỚI ${ctx.previousPeriod.toUpperCase()}]`);
  lines.push(`- Chi tiêu tháng trước: ${formatMoney(ctx.previousMonthExpense, ctx.primaryCurrency)}`);
  const diffWord = ctx.expenseChangeVsPreviousMonth.difference >= 0 ? "tăng" : "giảm";
  const absDiff = Math.abs(ctx.expenseChangeVsPreviousMonth.difference);
  const pctStr =
    ctx.expenseChangeVsPreviousMonth.percentChange !== null
      ? ` (${ctx.expenseChangeVsPreviousMonth.percentChange > 0 ? "+" : ""}${ctx.expenseChangeVsPreviousMonth.percentChange}%)`
      : "";
  lines.push(`- Chênh lệch chi tiêu: ${diffWord} ${formatMoney(absDiff, ctx.primaryCurrency)}${pctStr}`);

  // Top spending categories
  if (ctx.topCategories.length > 0) {
    lines.push("\n[CHI TIÊU THEO DANH MỤC THÁNG NÀY]");
    for (const cat of ctx.topCategories.slice(0, 5)) {
      const compStr =
        cat.previousAmount > 0
          ? ` (so với tháng trước: ${cat.difference >= 0 ? "+" : ""}${formatMoney(cat.difference, ctx.primaryCurrency)})`
          : "";
      lines.push(`- ${sanitize(cat.category)}: ${formatMoney(cat.currentAmount, ctx.primaryCurrency)}${compStr}`);
    }
  }

  if (ctx.highestSpendingCategory) {
    lines.push(
      `=> Danh mục chi tiêu nhiều nhất: ${sanitize(ctx.highestSpendingCategory.category)} với ${formatMoney(ctx.highestSpendingCategory.amount, ctx.primaryCurrency)} (${ctx.highestSpendingCategory.percentage}% tổng chi)`,
    );
  }

  // Budgets
  if (ctx.budgets.length > 0) {
    lines.push("\n[TÌNH TRẠNG NGÂN SÁCH]");
    for (const b of ctx.budgets) {
      let alert = "An toàn";
      if (b.isOverBudget) {
        alert = "ĐÃ VƯỢT NGÂN SÁCH!";
      } else if (b.isNearLimit) {
        alert = "CẢNH BÁO: SẮP VƯỢT HẠN MỨC (>=80%)";
      }
      lines.push(
        `- ${sanitize(b.name)}: Đã chi ${formatMoney(b.spent_amount, ctx.primaryCurrency)} / ${formatMoney(b.amount, ctx.primaryCurrency)} (${b.percentUsed}%), còn lại ${formatMoney(b.remaining_amount, ctx.primaryCurrency)} [${alert}]`,
      );
    }
  }

  // What-If 500k
  if (ctx.whatIfContext.sample500kImpacts.length > 0) {
    lines.push("\n[DỮ LIỆU TÍNH SẴN CHO PHÂN TÍCH WHAT-IF (NẾU MUA THÊM 500.000đ)]");
    for (const imp of ctx.whatIfContext.sample500kImpacts) {
      lines.push(
        `- Ngân sách ${sanitize(imp.budgetName)}: còn lại ${formatMoney(imp.currentRemaining, ctx.primaryCurrency)}, nếu mua thêm 500k sẽ còn ${formatMoney(imp.remainingAfter500k, ctx.primaryCurrency)} ${imp.wouldExceed ? "(VƯỢT NGÂN SÁCH!)" : "(Vẫn nằm trong hạn mức)"}`,
      );
    }
  }

  // Wallets list
  if (ctx.wallets.length > 0) {
    lines.push("\n<UNTRUSTED_USER_WALLETS>");
    for (const w of ctx.wallets) {
      lines.push(`- ${sanitize(w.name)} (${w.type}): ${formatMoney(w.balance, w.currency)}`);
    }
    lines.push("</UNTRUSTED_USER_WALLETS>");
  }

  // Goals
  if (ctx.savingsGoals.length > 0) {
    lines.push("\n<UNTRUSTED_USER_SAVINGS_GOALS>");
    for (const g of ctx.savingsGoals) {
      lines.push(
        `- ${sanitize(g.title)}: ${formatMoney(g.current_amount, ctx.primaryCurrency)} / ${formatMoney(g.target_amount, ctx.primaryCurrency)} (${g.percentProgress}%)${g.deadline ? `, hạn: ${g.deadline}` : ""}`,
      );
    }
    lines.push("</UNTRUSTED_USER_SAVINGS_GOALS>");
  }

  // Recent transactions
  if (ctx.recentTransactions.length > 0) {
    lines.push(`\n<UNTRUSTED_RECENT_TRANSACTIONS count="${ctx.recentTransactions.length}">`);
    for (const t of ctx.recentTransactions) {
      lines.push(
        `- [${t.type === "income" ? "Thu" : "Chi"}] ${sanitize(t.title)}: ${formatMoney(t.amount, t.currency)} (${sanitize(t.category)}, ${t.date})`,
      );
    }
    lines.push("</UNTRUSTED_RECENT_TRANSACTIONS>");
  }

  if (!ctx.hasSufficientData) {
    lines.push("\nLƯU Ý: Người dùng hiện chưa có đủ dữ liệu giao dịch hoặc ví. Khi người dùng hỏi số liệu, hãy thông báo 'Chưa đủ dữ liệu' thay vì tự bịa.");
  }

  lines.push("=== HẾT DỮ LIỆU TÀI CHÍNH TỪ MÁY CHỦ ===");
  return lines.join("\n");
}
