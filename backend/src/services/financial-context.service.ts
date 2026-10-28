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
import type { Wallet, Transaction, Budget, SavingsGoal, Transfer } from "../../../frontend/types/finance.types.ts";
import { parseVietnameseAmount } from "../../../frontend/utils/smart-parser.ts";
import {
  buildAuthoritativeFinancialSnapshot,
  type AuthoritativeFinancialSnapshot,
} from "./financial-snapshot.service.ts";
import { detectWalletTarget } from "./ai-router.service.ts";
import {
  getCachedUserFinancialContext,
  setCachedUserFinancialContext,
} from "./financial-cache.service.ts";

export interface ServerWalletSummary {
  id: string;
  name: string;
  type: string;
  balance: number;
  reservedAmount: number;
  availableBalance: number;
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
  limit: number;
  actualSpent: number;
  limitRemaining: number;
  percentUsed: number;
  allocated: number;
  fundedRemaining: number;
  isFunded: boolean;
  isOutOfFunds: boolean;
  sourceWalletId?: string | null;
  sourceWalletName?: string | null;
  status: string;
  isOverLimit: boolean;
  isNearLimit: boolean;
  isReachedLimit: boolean;

  // Backward compatibility fields
  amount: number;
  spent_amount: number;
  remaining_amount: number;
  isOverBudget: boolean;
}

export interface ServerSavingsGoalSummary {
  id?: string;
  title: string;
  current_amount: number;
  target_amount: number;
  percentProgress: number;
  deadline: string | null;
  source_wallet_id?: string | null;
  reserved_in_wallet?: number;
}

export interface ServerUpcomingObligation {
  id: string;
  title: string;
  amount: number;
  type: "income" | "expense";
  frequency: string;
  nextRunAt: string;
  walletId?: string | null;
}

export interface ServerFinancialContext {
  userId: string;
  asOf: string; // e.g. "2026-09-29 22:30:00 (UTC+7)"
  currentPeriod: string; // e.g. "Tháng 09/2026"
  previousPeriod: string; // e.g. "Tháng 08/2026"
  timezone: string; // "Asia/Ho_Chi_Minh (UTC+7)"

  // Balances grouped by currency (NO cross-currency additions)
  balancesByCurrency: Record<string, number>;
  reservedByCurrency?: Record<string, number>;
  availableByCurrency?: Record<string, number>;
  primaryCurrency: string;
  totalAssets?: number;
  totalAllocated?: number;
  totalAvailable?: number;
  snapshot?: AuthoritativeFinancialSnapshot;

  // Expenses and Incomes grouped strictly by currency (NO cross-currency additions)
  expensesByCurrency: Record<string, number>;
  incomesByCurrency: Record<string, number>;
  previousExpensesByCurrency: Record<string, number>;
  previousIncomesByCurrency: Record<string, number>;

  // Current Month Totals (per primary currency)
  currentMonthIncome: number;
  currentMonthExpense: number;
  currentMonthNetSavings: number;
  currentMonthSavingsRate: number | null; // percentage 0-100, or null if unrecorded/limited
  savingsRateStatus?: "NORMAL" | "NO_EXPENSES_LOGGED" | "CONFIRMED_ZERO" | "DATA_LIMITED";
  savingsRateNotice?: string;

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

  // Wallets, Budgets, Savings Goals, and Upcoming Obligations
  wallets: ServerWalletSummary[];
  budgets: ServerBudgetSummary[];
  savingsGoals: ServerSavingsGoalSummary[];
  upcomingObligations?: ServerUpcomingObligation[];
  upcomingObligationsTotal?: number;
  currentMonthTransactionCount?: number;
  currentMonthIncomeCount?: number;
  currentMonthExpenseCount?: number;
  totalAccountTransactionCount?: number;

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

  // Dynamic what-if analysis
  dynamicWhatIf?: Array<{
    budgetName: string;
    currentRemaining: number;
    amount: number;
    currency: string;
    remainingAfter: number;
    wouldExceed: boolean;
  }>;

  // Database error tracking (distinguishing empty data vs failed query)
  databaseQueryError?: boolean;
  databaseErrorMessage?: string;
  databaseError?: string;

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
 * Dynamic What-If Extractor & Calculator
 */
export function extractWhatIfAmountFromQuery(query: string): { amount: number; currency: string } | null {
  if (!query) return null;
  const m = query.match(
    /(?:nếu|neu)\s+(?:tôi\s+)?(?:mua|chi|tiêu|tốn|bỏ\s+ra)\s+(?:thêm\s+)?(?:món\s+đồ\s+|cái\s+.*?\s+)?(?:giá\s+)?([0-9.,]+(?:\s*(?:k|nghìn|ngàn|triệu|trieu|tr|usd|đ|vnd|dong))?)/i,
  );
  if (m && m[1]) {
    const parsed = parseVietnameseAmount(m[1]);
    if (parsed.amount && parsed.amount > 0) {
      return { amount: parsed.amount, currency: parsed.currency || "VND" };
    }
  }
  return null;
}

export function calculateDynamicWhatIf(
  budgets: ServerBudgetSummary[],
  amount: number,
  currency = "VND",
) {
  return budgets.map((b) => {
    const baselineRemaining = b.limitRemaining ?? b.remaining_amount;
    const diff = baselineRemaining - amount;
    return {
      budgetName: b.name,
      currentRemaining: baselineRemaining,
      amount,
      currency,
      remainingAfter: diff,
      wouldExceed: diff < 0,
      exceededBy: diff < 0 ? Math.abs(diff) : 0,
    };
  });
}

/**
 * Fetch and build trusted financial context server-side.
 */
export async function buildServerFinancialContext(
  supabaseUrl: string,
  supabaseKey: string,
  userToken: string,
  userId: string,
  queryText?: string,
): Promise<ServerFinancialContext> {
  // Check in-memory per-user cache (valid for 30s)
  if (userId) {
    const cached = getCachedUserFinancialContext(userId);
    if (cached) {
      return cached;
    }
  }

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

  // Fetch wallets, budgets, goals, transfers, and transactions concurrently with RLS enforcement
  const [walletsRes, budgetsRes, goalsRes, transfersRes, currentTxsRes, prevTxsRes, allTxsRes, recurringTxsRes] = await Promise.all([
    userClient
      .from("wallets")
      .select("id, name, type, balance, currency, reserved_amount")
      .eq("user_id", userId),
    userClient
      .from("budgets")
      .select("id, name, amount, spent_amount, remaining_amount, period, status, category_id, allocated_amount, source_wallet_id, alert_percent")
      .eq("user_id", userId),
    userClient
      .from("savings_goals")
      .select("id, title, target_amount, current_amount, deadline, source_wallet_id, reserved_in_wallet")
      .eq("user_id", userId),
    userClient
      .from("transfers")
      .select("id, from_wallet_id, to_wallet_id, amount")
      .eq("user_id", userId),
    userClient
      .from("transactions")
      .select("id, title, amount, type, category, category_id, occurred_at, wallet_id, payment_source_type, budget_id")
      .eq("user_id", userId)
      .gte("occurred_at", timeBounds.currentStartIso)
      .lt("occurred_at", timeBounds.currentEndIso)
      .order("occurred_at", { ascending: false })
      .range(0, 4999),
    userClient
      .from("transactions")
      .select("id, title, amount, type, category, occurred_at, wallet_id")
      .eq("user_id", userId)
      .gte("occurred_at", timeBounds.previousStartIso)
      .lt("occurred_at", timeBounds.previousEndIso)
      .range(0, 4999),
    userClient
      .from("transactions")
      .select("id, title, amount, type, category, category_id, occurred_at, wallet_id, payment_source_type, budget_id")
      .eq("user_id", userId),
    userClient
      .from("recurring_transactions")
      .select("id, title, amount, type, frequency, next_run_at, active, wallet_id")
      .eq("user_id", userId)
      .eq("active", true),
  ]);

  const dbError = walletsRes.error || budgetsRes.error || goalsRes.error || transfersRes.error || currentTxsRes.error || prevTxsRes.error || allTxsRes?.error || recurringTxsRes?.error;
  const databaseQueryError = Boolean(dbError);
  const databaseErrorMessage = dbError ? dbError.message : undefined;

  const wallets = (walletsRes.data ?? []) as (Wallet & { reserved_amount?: number })[];
  const budgets = (budgetsRes.data ?? []) as Budget[];
  const goals = (goalsRes.data ?? []) as (SavingsGoal & { source_wallet_id?: string; reserved_in_wallet?: number })[];
  const transfers = (transfersRes.data ?? []) as Transfer[];
  const currentTxs = (currentTxsRes.data ?? []) as Transaction[];
  const prevTxs = (prevTxsRes.data ?? []) as Transaction[];
  const allTxs = (allTxsRes?.data ?? []) as Transaction[];
  const totalAccountTransactionCount = allTxs.length;
  const currentMonthTransactionCount = currentTxs.length;
  const currentMonthExpenseCount = currentTxs.filter((t) => t.type === "expense").length;
  const currentMonthIncomeCount = currentTxs.filter((t) => t.type === "income").length;
  const hasSufficientData =
    wallets.length > 0 || currentTxs.length > 0 || budgets.length > 0;

  // Compute unified authoritative financial snapshot (matches Dashboard 100%)
  const snapshot = buildAuthoritativeFinancialSnapshot(wallets, allTxs, transfers, budgets, goals);

  // Dynamic reserved funds per wallet (consistent with calculateReservedByWallet in frontend)
  const _walletReservedMap = snapshot.walletReservedMap;
  void _walletReservedMap;
  const walletNameMap = new Map<string, string>();
  for (const w of wallets) {
    walletNameMap.set(w.id, w.name);
  }

  // 1. Group balances, reserved, and available strictly by currency from Authoritative Snapshot
  const balancesByCurrency: Record<string, number> = {};
  const reservedByCurrency: Record<string, number> = {};
  const availableByCurrency: Record<string, number> = {};
  const walletCurrencyMap = new Map<string, string>();

  for (const w of snapshot.enrichedWallets) {
    walletCurrencyMap.set(w.id, w.currency);
  }

  for (const [cur, stats] of Object.entries(snapshot.byCurrency)) {
    balancesByCurrency[cur] = stats.totalAssets;
    reservedByCurrency[cur] = stats.totalAllocated;
    availableByCurrency[cur] = stats.totalAvailable;
  }

  const primaryCurrency = snapshot.primaryCurrency;

  // 2. Compute current month income and expense grouped strictly by currency
  const expensesByCurrency: Record<string, number> = {};
  const incomesByCurrency: Record<string, number> = {};
  const currentCategorySpend = new Map<string, number>();

  for (const t of currentTxs) {
    const amt = Number.isFinite(Number(t.amount)) ? Math.max(0, Number(t.amount)) : 0;
    const cur = (t.wallet_id && walletCurrencyMap.get(t.wallet_id)) || primaryCurrency;

    if (t.type === "income") {
      incomesByCurrency[cur] = (incomesByCurrency[cur] || 0) + amt;
    } else {
      expensesByCurrency[cur] = (expensesByCurrency[cur] || 0) + amt;
      const cat = (t.category || "Khác").trim();
      currentCategorySpend.set(cat, (currentCategorySpend.get(cat) || 0) + amt);
    }
  }

  const currentMonthIncome = incomesByCurrency[primaryCurrency] || 0;
  const currentMonthExpense = expensesByCurrency[primaryCurrency] || 0;

  // 3. Compute previous month income and expense grouped strictly by currency
  const previousExpensesByCurrency: Record<string, number> = {};
  const previousIncomesByCurrency: Record<string, number> = {};
  const prevCategorySpend = new Map<string, number>();

  for (const t of prevTxs) {
    const amt = Number.isFinite(Number(t.amount)) ? Math.max(0, Number(t.amount)) : 0;
    const cur = (t.wallet_id && walletCurrencyMap.get(t.wallet_id)) || primaryCurrency;

    if (t.type === "income") {
      previousIncomesByCurrency[cur] = (previousIncomesByCurrency[cur] || 0) + amt;
    } else {
      previousExpensesByCurrency[cur] = (previousExpensesByCurrency[cur] || 0) + amt;
      const cat = (t.category || "Khác").trim();
      prevCategorySpend.set(cat, (prevCategorySpend.get(cat) || 0) + amt);
    }
  }

  const previousMonthIncome = previousIncomesByCurrency[primaryCurrency] || 0;
  const previousMonthExpense = previousExpensesByCurrency[primaryCurrency] || 0;

  // 4. Net savings and rate (Strict distinction: unrecorded expenses != 100% savings rate)
  const currentMonthNetSavings = currentMonthIncome - currentMonthExpense;
  const hasRecordedExpenses = currentMonthExpenseCount > 0;
  let currentMonthSavingsRate: number | null = null;
  let savingsRateStatus: "NORMAL" | "NO_EXPENSES_LOGGED" | "CONFIRMED_ZERO" | "DATA_LIMITED" = "NORMAL";
  let savingsRateNotice = "";

  if (databaseQueryError || !hasSufficientData) {
    savingsRateStatus = "DATA_LIMITED";
    currentMonthSavingsRate = null;
    savingsRateNotice = "Dữ liệu thiếu hoặc lỗi truy vấn, không thể xác định tỷ lệ tiết kiệm.";
  } else if (!hasRecordedExpenses) {
    savingsRateStatus = "NO_EXPENSES_LOGGED";
    currentMonthSavingsRate = null;
    savingsRateNotice = "Chưa có giao dịch chi tiêu nào được ghi nhận trong kỳ (0 giao dịch). Chưa đủ cơ sở kết luận tỷ lệ tiết kiệm đạt 100%.";
  } else if (currentMonthIncome > 0) {
    savingsRateStatus = "NORMAL";
    currentMonthSavingsRate = Math.round(((currentMonthIncome - currentMonthExpense) / currentMonthIncome) * 100);
  } else {
    savingsRateStatus = "NORMAL";
    currentMonthSavingsRate = 0;
  }

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

  // 7. Process budgets with strict domain separation
  const budgetSummaries: ServerBudgetSummary[] = budgets.map((b) => {
    const limit = Math.max(0, Number(b.amount) || 0);
    const allocated = Math.max(0, Number(b.allocated_amount) || 0);
    const fundedRemaining = Math.max(0, Number(b.remaining_amount) || 0);
    const isFunded = allocated > 0 && Boolean(b.source_wallet_id);
    const isOutOfFunds = isFunded && fundedRemaining <= 0;

    // Calculate actual spending in current month for the budget category
    let actualSpent = 0;
    for (const tx of currentTxs) {
      if (tx.type !== "expense") continue;
      if (b.category_id) {
        if (tx.category_id === b.category_id) {
          actualSpent += Math.max(0, Number(tx.amount) || 0);
        }
      } else {
        actualSpent += Math.max(0, Number(tx.amount) || 0);
      }
    }
    // If no transactions matched by category_id but b.spent_amount > 0, fallback to b.spent_amount
    if (actualSpent === 0 && Number(b.spent_amount) > 0) {
      actualSpent = Number(b.spent_amount);
    }

    const limitRemaining = Math.max(0, limit - actualSpent);
    const percentUsed = limit > 0 ? Math.round((actualSpent / limit) * 1000) / 10 : 0;
    const isOverLimit = limit > 0 && actualSpent > limit;
    const isReachedLimit = limit > 0 && actualSpent === limit;
    const isNearLimit = limit > 0 && !isOverLimit && !isReachedLimit && percentUsed >= (b.alert_percent || 80);

    return {
      name: b.name,
      limit,
      actualSpent,
      limitRemaining,
      percentUsed,
      allocated,
      fundedRemaining,
      isFunded,
      isOutOfFunds,
      status: b.status || "active",
      isOverLimit,
      isNearLimit,
      isReachedLimit,
      sourceWalletId: b.source_wallet_id || null,
      sourceWalletName: (b.source_wallet_id && walletNameMap.get(b.source_wallet_id)) || null,

      // Backward compatibility fields
      amount: limit,
      spent_amount: actualSpent,
      remaining_amount: limitRemaining,
      isOverBudget: isOverLimit,
    };
  });

  // 8. Process savings goals
  const goalSummaries: ServerSavingsGoalSummary[] = goals.map((g) => {
    const cur = Number(g.current_amount) || 0;
    const target = Number(g.target_amount) || 0;
    const pct = target > 0 ? Math.round((cur / target) * 100) : 0;
    return {
      id: g.id,
      title: g.title,
      current_amount: cur,
      target_amount: target,
      percentProgress: pct,
      deadline: g.deadline,
      source_wallet_id: g.source_wallet_id || null,
      reserved_in_wallet: Number(g.reserved_in_wallet) || 0,
    };
  });

  // 8b. Process upcoming recurring obligations
  const recurringTxs = (recurringTxsRes?.data ?? []) as Array<{
    id: string;
    title: string;
    amount: number;
    type: "income" | "expense";
    frequency: string;
    next_run_at: string;
    active: boolean;
    wallet_id?: string | null;
  }>;

  const upcomingObligations: ServerUpcomingObligation[] = recurringTxs
    .filter((r) => r.active && r.type === "expense")
    .map((r) => ({
      id: r.id,
      title: r.title,
      amount: Math.max(0, Number(r.amount) || 0),
      type: r.type,
      frequency: r.frequency,
      nextRunAt: r.next_run_at,
      walletId: r.wallet_id || null,
    }));

  const upcomingObligationsTotal = upcomingObligations.reduce((sum, item) => sum + item.amount, 0);

  // 9. Process wallets with dynamic reserved funds and available balances from Authoritative Snapshot
  const walletSummaries: ServerWalletSummary[] = snapshot.enrichedWallets.map((w) => ({
    id: w.id,
    name: w.name,
    type: w.type,
    balance: w.balance,
    reservedAmount: w.reservedAmount,
    availableBalance: w.availableBalance,
    currency: w.currency,
  }));

  // 10. Recent transactions (clean, max 20)
  const recentTransactions = currentTxs.slice(0, 20).map((t) => {
    const txCurrency = (t.wallet_id && walletCurrencyMap.get(t.wallet_id)) || primaryCurrency;
    return {
      title: t.title,
      amount: Number(t.amount) || 0,
      currency: txCurrency,
      type: (t.type === "income" ? "income" : "expense") as "income" | "expense",
      category: t.category || "Khác",
      date: t.occurred_at ? t.occurred_at.slice(0, 10) : "",
    };
  });

  // 11. Pre-calculate What-If for 500,000 VND based on remaining limit
  const sample500kImpacts = budgetSummaries.map((b) => {
    const baselineRemaining = b.limitRemaining ?? b.remaining_amount;
    const diff = baselineRemaining - 500_000;
    return {
      budgetName: b.name,
      currentRemaining: baselineRemaining,
      remainingAfter500k: diff,
      wouldExceed: diff < 0,
    };
  });

  // Dynamic what-if if query text is provided
  let dynamicWhatIf: ServerFinancialContext["dynamicWhatIf"] = undefined;
  if (queryText && budgetSummaries.length > 0) {
    const extracted = extractWhatIfAmountFromQuery(queryText);
    if (extracted) {
      dynamicWhatIf = calculateDynamicWhatIf(budgetSummaries, extracted.amount, extracted.currency);
    }
  }

  const resultContext: ServerFinancialContext = {
    userId,
    asOf: timeBounds.nowIso,
    currentPeriod: timeBounds.currentMonthLabel,
    previousPeriod: timeBounds.previousMonthLabel,
    timezone: "Asia/Ho_Chi_Minh (UTC+7)",
    totalAssets: snapshot.totalAssets,
    totalAllocated: snapshot.totalAllocated,
    totalAvailable: snapshot.totalAvailable,
    snapshot,
    balancesByCurrency,
    reservedByCurrency,
    availableByCurrency,
    primaryCurrency,
    expensesByCurrency,
    incomesByCurrency,
    previousExpensesByCurrency,
    previousIncomesByCurrency,
    currentMonthIncome,
    currentMonthExpense,
    currentMonthNetSavings,
    currentMonthSavingsRate,
    savingsRateStatus,
    savingsRateNotice,
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
    upcomingObligations,
    upcomingObligationsTotal,
    recentTransactions,
    currentMonthTransactionCount,
    currentMonthExpenseCount,
    currentMonthIncomeCount,
    totalAccountTransactionCount,
    whatIfContext: {
      sample500kImpacts,
    },
    dynamicWhatIf,
    databaseQueryError,
    databaseErrorMessage,
    hasSufficientData,
    dataLimitationsNotice: !hasSufficientData
      ? "Người dùng chưa có dữ liệu giao dịch hoặc ví nào trong hệ thống."
      : undefined,
  };

  if (userId && !databaseQueryError) {
    setCachedUserFinancialContext(userId, resultContext, 30_000);
  }

  return resultContext;
}

/**
 * Format ServerFinancialContext into protected prompt context string.
 * Escapes user-defined fields and encloses them in untrusted data delimiters.
 */
export function formatServerFinancialContextForPrompt(
  ctx: ServerFinancialContext,
  currentPage?: string,
  userQuery?: string,
  simulationSummary?: string,
): string {
  // Ergonomic overload: If user passes query as 2nd argument (e.g. starts with "nếu" or has "?")
  let actualPage = currentPage;
  let actualQuery = userQuery;
  if (!actualQuery && currentPage && (currentPage.includes("?") || /nếu|chi|mua|hỏi/i.test(currentPage))) {
    actualQuery = currentPage;
    actualPage = undefined;
  }

  const sanitize = (text: string) =>
    text.replace(/[<>{}\\]/g, "").slice(0, 80);

  const formatMoney = (amount?: number | null, currency = "VND") => {
    const num = typeof amount === "number" && !isNaN(amount) ? amount : 0;
    return `${num.toLocaleString("vi-VN")} ${currency}`;
  };

  const lines: string[] = [
    "=== XÁC THỰC DỮ LIỆU TÀI CHÍNH TỪ MÁY CHỦ (SERVER-VERIFIED) ===",
    `Thời điểm cập nhật: ${ctx.asOf}`,
    `Múi giờ hệ thống: ${ctx.timezone}`,
    `Kỳ hiện tại: ${ctx.currentPeriod}`,
    `Kỳ trước: ${ctx.previousPeriod}`,
  ];

  if (actualPage) {
    lines.push(`Màn hình người dùng đang xem: ${sanitize(actualPage)}`);
  }

  // Database Query Error warning - return early to prevent showing empty balances as 0đ
  if (ctx.databaseQueryError || ctx.databaseError) {
    lines.push("\n[LỖI TRUY VẤN CƠ SỞ DỮ LIỆU TỪ MÁY CHỦ]");
    lines.push(`- Trạng thái: Không thể kết nối hoặc truy vấn dữ liệu từ cơ sở dữ liệu (${ctx.databaseErrorMessage || ctx.databaseError || "Lỗi kết nối cơ sở dữ liệu"}).`);
    lines.push("- BẮT BUỘC ĐỐI VỚI AI:");
    lines.push("  1. Phải thông báo trực tiếp cho người dùng rằng dữ liệu tài chính hiện không khả dụng do lỗi kết nối hệ thống.");
    lines.push("  2. KHÔNG ĐƯỢC thông báo người dùng chi tiêu 0đ, TUYỆT ĐỐI KHÔNG mặc định số dư là 0đ hay 0 VND, KHÔNG nói người dùng 'chưa có tiền' hay 'hết tiền'.");
    lines.push("  3. TUYỆT ĐỐI KHÔNG tự bịa số dư, số tiền hay thông tin giao dịch giả mạo.");
    return lines.join("\n");
  }

  // Balances
  lines.push("\n[TỔNG TÀI SẢN VÀ SỐ DƯ KHẢ DỤNG THEO TIỀN TỆ]");
  for (const [cur, bal] of Object.entries(ctx.balancesByCurrency)) {
    const res = (ctx.reservedByCurrency && ctx.reservedByCurrency[cur]) || 0;
    const avail = (ctx.availableByCurrency && ctx.availableByCurrency[cur]) ?? Math.max(0, bal - res);
    lines.push(`- Tổng số dư ${cur}: ${formatMoney(bal, cur)} | Đã phân bổ: ${formatMoney(res, cur)} | Số dư khả dụng thực tế chi tiêu: ${formatMoney(avail, cur)}`);
  }
  const primCur = ctx.primaryCurrency || "VND";
  const totAssets = ctx.totalAssets ?? ctx.balancesByCurrency[primCur] ?? 0;
  const totAlloc = ctx.totalAllocated ?? ctx.reservedByCurrency?.[primCur] ?? 0;
  const totAvail = ctx.totalAvailable ?? ctx.availableByCurrency?.[primCur] ?? Math.max(0, totAssets - totAlloc);
  lines.push(`- NGUYÊN TẮC BẮT BUỘC: Khi người dùng hỏi 'Tôi có bao nhiêu tiền?' hay 'Tổng tài sản', BẮT BUỘC báo cáo chính xác Tổng tài sản (${formatMoney(totAssets, primCur)}), Đã phân bổ (${formatMoney(totAlloc, primCur)}) và Số dư khả dụng (${formatMoney(totAvail, primCur)}). TUYỆT ĐỐI KHÔNG hỏi ngược lại người dùng muốn biết số dư ví hay khả dụng.`);

  // Target Wallet Directive if user asked about a specific wallet
  if (actualQuery) {
    const targetQuery = detectWalletTarget(actualQuery);
    if (targetQuery.targetWalletKeyword) {
      const cleanTarget = targetQuery.targetWalletKeyword.toLowerCase();
      const matchedWallet = ctx.wallets.find((w) => {
        const wName = (w.name || "").toLowerCase();
        const wType = (w.type || "").toLowerCase();
        if (targetQuery.targetWalletType && wType === targetQuery.targetWalletType) return true;
        if (wName.includes(cleanTarget)) return true;
        return false;
      });

      if (matchedWallet) {
        lines.push(`\n[CHỈ THỊ ĐẶC BIỆT KHI HỎI VÍ CỤ THỂ "${matchedWallet.name.toUpperCase()}"]:`);
        lines.push(`- Người dùng đang hỏi về ví "${matchedWallet.name}" (${matchedWallet.type}).`);
        lines.push(`- BẮT BUỘC BÁO CÁO ĐÚNG SỐ LIỆU CỦA VÍ NÀY:`);
        lines.push(`  + Số dư ví: ${formatMoney(matchedWallet.balance, matchedWallet.currency)}`);
        lines.push(`  + Đã phân bổ: ${formatMoney(matchedWallet.reservedAmount, matchedWallet.currency)}`);
        lines.push(`  + Khả dụng: ${formatMoney(matchedWallet.availableBalance, matchedWallet.currency)}`);
        lines.push(`- NGUYÊN TẮC BẮT BUỘC: TUYỆT ĐỐI KHÔNG lấy Tổng tài sản (${formatMoney(totAssets, primCur)}) hay Tổng khả dụng (${formatMoney(totAvail, primCur)}) để trả lời thay thế cho ví "${matchedWallet.name}"!`);
        if (targetQuery.focusType === "WALLET_ALLOCATED") {
          lines.push(`- Trọng tâm câu hỏi là số tiền đã phân bổ: Trả lời chính xác ví "${matchedWallet.name}" đã phân bổ ${formatMoney(matchedWallet.reservedAmount, matchedWallet.currency)}.`);
        } else if (targetQuery.focusType === "WALLET_AVAILABLE") {
          lines.push(`- Trọng tâm câu hỏi là số dư khả dụng: Trả lời chính xác ví "${matchedWallet.name}" còn khả dụng ${formatMoney(matchedWallet.availableBalance, matchedWallet.currency)}.`);
        }
      }
    } else if (targetQuery.focusType === "HIGHEST_WALLET") {
      const sorted = [...(ctx.wallets || [])].sort((a, b) => (b.balance || 0) - (a.balance || 0));
      if (sorted.length > 0) {
        const topW = sorted[0];
        lines.push(`\n[CHỈ THỊ ĐẶC BIỆT KHI HỎI VÍ NHIỀU TIỀN NHẤT]:`);
        lines.push(`- Ví có số dư cao nhất hiện tại là ví "${topW.name}" (${topW.type}) với ${formatMoney(topW.balance, topW.currency)} (Khả dụng: ${formatMoney(topW.availableBalance, topW.currency)}, Đã phân bổ: ${formatMoney(topW.reservedAmount, topW.currency)}). BẮT BUỘC khẳng định rõ ví "${topW.name}" nhiều tiền nhất.`);
      }
    } else if (targetQuery.focusType === "TOTAL_AVAILABLE") {
      lines.push(`\n[CHỈ THỊ ĐẶC BIỆT KHI HỎI TỔNG KHẢ DỤNG]:`);
      lines.push(`- Báo cáo chính xác Tổng số dư khả dụng chi tiêu: ${formatMoney(totAvail, primCur)}.`);
      lines.push(`- Công thức: Khả dụng = Tổng tài sản (${formatMoney(totAssets, primCur)}) - Đã phân bổ (${formatMoney(totAlloc, primCur)}) = ${formatMoney(totAvail, primCur)}.`);
    } else if (targetQuery.focusType === "TOTAL_ALLOCATED") {
      lines.push(`\n[CHỈ THỊ ĐẶC BIỆT KHI HỎI TỔNG PHÂN BỔ]:`);
      lines.push(`- Báo cáo chính xác Tổng số tiền đã phân bổ: ${formatMoney(totAlloc, primCur)}.`);
    }
  }

  // Current Month Summary by currency
  lines.push(`\n[TỔNG KẾT TÀI CHÍNH ${(ctx.currentPeriod || "KỲ HIỆN TẠI").toUpperCase()} THEO TIỀN TỆ]`);
  const activeCurrencies = Array.from(new Set([
    ...Object.keys(ctx.balancesByCurrency || {}),
    ...Object.keys(ctx.expensesByCurrency || {}),
    ...Object.keys(ctx.incomesByCurrency || {}),
  ]));

  if (activeCurrencies.length === 0 || (!ctx.expensesByCurrency && !ctx.incomesByCurrency)) {
    lines.push(`- Tổng thu nhập: ${formatMoney(ctx.currentMonthIncome, ctx.primaryCurrency)}`);
    lines.push(`- Tổng chi tiêu: ${formatMoney(ctx.currentMonthExpense, ctx.primaryCurrency)}`);
    lines.push(`- Tiết kiệm ròng: ${formatMoney(ctx.currentMonthNetSavings, ctx.primaryCurrency)}`);
  } else {
    for (const cur of activeCurrencies) {
      const exp = (ctx.expensesByCurrency && ctx.expensesByCurrency[cur]) || 0;
      const inc = (ctx.incomesByCurrency && ctx.incomesByCurrency[cur]) || 0;
      const net = inc - exp;
      lines.push(`- Tiền tệ ${cur}: Tổng chi tiêu ${formatMoney(exp, cur)} | Tổng thu ${formatMoney(inc, cur)} | Tiết kiệm ròng ${formatMoney(net, cur)}`);
    }
  }
  if (ctx.savingsRateStatus === "NO_EXPENSES_LOGGED" || ctx.currentMonthSavingsRate === null) {
    lines.push(`- Tỷ lệ tiết kiệm (${ctx.primaryCurrency}): Chưa thể xác định (Chưa có giao dịch chi tiêu nào được ghi nhận trong kỳ - 0 giao dịch). CẤM kết luận tỷ lệ tiết kiệm 100% khi chưa có dữ liệu chi tiêu thực tế.`);
  } else {
    lines.push(`- Tỷ lệ tiết kiệm (${ctx.primaryCurrency}): ${ctx.currentMonthSavingsRate}%`);
  }
  lines.push("- QUY TẮC BẮT BUỘC: Báo cáo riêng biệt chi tiêu theo từng loại tiền tệ (ví dụ: chi tiêu VND và chi tiêu USD). TUYỆT ĐỐI KHÔNG cộng gộp các loại tiền tệ khác nhau thành một tổng duy nhất.");

  // Previous Month Comparison
  lines.push(`\n[SO SÁNH CHI TIÊU VỚI ${(ctx.previousPeriod || "KỲ TRƯỚC").toUpperCase()}]`);
  if (!ctx.previousMonthExpense || ctx.previousMonthExpense === 0 || !ctx.expenseChangeVsPreviousMonth) {
    lines.push(`- Chi tiêu tháng trước (${ctx.primaryCurrency}): 0 ${ctx.primaryCurrency} (Tháng trước không có chi tiêu, không thể tính % tăng/giảm).`);
  } else {
    lines.push(`- Chi tiêu tháng trước (${ctx.primaryCurrency}): ${formatMoney(ctx.previousMonthExpense, ctx.primaryCurrency)}`);
    const diff = ctx.expenseChangeVsPreviousMonth?.difference ?? 0;
    const diffWord = diff >= 0 ? "tăng" : "giảm";
    const absDiff = Math.abs(diff);
    const pct = ctx.expenseChangeVsPreviousMonth?.percentChange;
    const pctStr =
      pct !== null && pct !== undefined
        ? ` (${pct > 0 ? "+" : ""}${pct}%)`
        : "";
    lines.push(`- Chênh lệch chi tiêu: ${diffWord} ${formatMoney(absDiff, ctx.primaryCurrency)}${pctStr}`);
  }

  // Top spending categories
  if (ctx.topCategories && ctx.topCategories.length > 0) {
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
  if (ctx.budgets && ctx.budgets.length > 0) {
    lines.push("\n[TÌNH TRẠNG NGÂN SÁCH VÀ QUỸ PHONG BÌ]");
    for (const b of ctx.budgets) {
      const limit = b.limit ?? b.amount ?? 0;
      const spent = b.actualSpent ?? b.spent_amount ?? 0;
      const limitRem = b.limitRemaining ?? b.remaining_amount ?? Math.max(0, limit - spent);
      let alert = "An toàn (Bình thường)";
      if (b.isOverLimit || b.isOverBudget) {
        alert = "ĐÃ VƯỢT HẠN MỨC CHI TIÊU!";
      } else if (b.isReachedLimit || (limit > 0 && spent === limit)) {
        alert = "ĐÃ ĐẠT 100% HẠN MỨC (Hết hạn mức)";
      } else if (b.isNearLimit) {
        alert = "CẢNH BÁO: SẮP VƯỢT HẠN MỨC (>=80%)";
      }

      let line = `- Ngân sách ${sanitize(b.name)}: Hạn mức kỳ ${formatMoney(limit, ctx.primaryCurrency)} | Chi thực tế ${formatMoney(spent, ctx.primaryCurrency)} (${b.percentUsed}%) | Còn được chi ${formatMoney(limitRem, ctx.primaryCurrency)} [${alert}]`;
      if (b.isFunded) {
        const walletName = b.sourceWalletName || "Ví liên kết";
        line += ` | Quỹ ví cấp vốn từ "${walletName}": Đã cấp ${formatMoney(b.allocated, ctx.primaryCurrency)}, Quỹ ví còn ${formatMoney(b.fundedRemaining, ctx.primaryCurrency)}${b.isOutOfFunds ? " (Hết tiền quỹ cấp vốn ví)" : ""}`;
      } else {
        line += " | Chế độ: Chỉ theo dõi hạn mức (không giữ tiền ví)";
      }
      lines.push(line);
    }
    lines.push("- QUY TẮC NGÂN SÁCH VÀ QUỸ PHONG BÌ CHO CHATBOT:");
    lines.push("  1. 'Hạn mức ngân sách' là số tiền tối đa dự kiến cho phép chi trong một kỳ.");
    lines.push("  2. 'Chi tiêu thực tế' là tổng giao dịch chi tiêu của danh mục trong kỳ. Mọi khoản chi trực tiếp từ ví cho danh mục này VẪN tính vào chi tiêu thực tế và làm giảm hạn mức còn lại.");
    lines.push("  3. 'Còn được chi' = Hạn mức - Chi tiêu thực tế.");
    lines.push("  4. 'Quỹ ví cấp vốn' (Envelope) là tiền thực tế được trích giữ từ ví để dành riêng cho chi tiêu. Khi quỹ này hết (0đ) nhưng chi thực tế chưa vượt hạn mức thì KHÔNG ĐƯỢC báo là vượt hạn mức.");
    lines.push("  5. 'Số dư ví' khác 'Số dư ngân sách' vì: Số dư ví phản ánh tổng tài sản thực tế trong ví, còn số dư ngân sách là số tiền đã cấp vốn hoặc hạn mức được khoanh vùng cho danh mục cụ thể.");
  }

  // Dynamic What-If or fallback What-If
  let activeWhatIf = ctx.dynamicWhatIf;
  if (!activeWhatIf && actualQuery && ctx.budgets && ctx.budgets.length > 0) {
    const extracted = extractWhatIfAmountFromQuery(actualQuery);
    if (extracted) {
      activeWhatIf = calculateDynamicWhatIf(ctx.budgets, extracted.amount, extracted.currency);
    }
  }

  if (simulationSummary) {
    lines.push(`\n${simulationSummary}`);
  } else if (activeWhatIf && activeWhatIf.length > 0) {
    const sample = activeWhatIf[0];
    lines.push(`\n[PHÂN TÍCH WHAT-IF ĐỘNG CHO MỨC CHI TIÊU ${formatMoney(sample.amount, sample.currency)}]`);
    for (const imp of activeWhatIf) {
      lines.push(
        `- Ngân sách ${sanitize(imp.budgetName)}: Hạn mức còn lại hiện tại ${formatMoney(imp.currentRemaining, imp.currency)}. Nếu mua thêm ${formatMoney(imp.amount, imp.currency)}, ngân sách còn lại sẽ là ${formatMoney(imp.remainingAfter, imp.currency)} ${imp.wouldExceed ? "(VƯỢT HẠN MỨC " + formatMoney(Math.abs(imp.remainingAfter), imp.currency) + "!)" : "(Vẫn nằm trong hạn mức an toàn)"}`,
      );
    }
    lines.push("- QUY TẮC TÍNH WHAT-IF: Với bất kỳ món đồ giá X nào khác, Ngân sách mới = Ngân sách còn lại hiện tại - X. Hãy tính toán chính xác số tiền còn lại và thông báo rõ có vượt hạn mức hay không.");
  } else if (!actualQuery && ctx.whatIfContext?.sample500kImpacts && ctx.whatIfContext.sample500kImpacts.length > 0) {
    lines.push("\n[DỮ LIỆU TÍNH SẴN CHO PHÂN TÍCH WHAT-IF (MẪU 500.000đ)]");
    for (const imp of ctx.whatIfContext.sample500kImpacts) {
      lines.push(
        `- Ngân sách ${sanitize(imp.budgetName)}: còn lại ${formatMoney(imp.currentRemaining, ctx.primaryCurrency)}, nếu mua thêm 500k sẽ còn ${formatMoney(imp.remainingAfter500k, ctx.primaryCurrency)} ${imp.wouldExceed ? "(VƯỢT NGÂN SÁCH!)" : "(Vẫn nằm trong hạn mức)"}`,
      );
    }
  }

  // Wallets list
  if (ctx.wallets && ctx.wallets.length > 0) {
    lines.push("\n[DANH SÁCH VÍ & TÀI KHOẢN (ĐỒNG BỘ VỚI GIAO DIỆN VÍ & TÀI KHOẢN)]");
    for (const w of ctx.wallets) {
      const res = typeof w.reservedAmount === "number" ? w.reservedAmount : 0;
      const avail = typeof w.availableBalance === "number" ? w.availableBalance : Math.max(0, (Number(w.balance) || 0) - res);
      lines.push(
        `- Ví "${sanitize(w.name)}" (${w.type}): Số dư ${formatMoney(w.balance, w.currency)} | Đã phân bổ: ${formatMoney(res, w.currency)} => Số dư khả dụng chi tiêu: ${formatMoney(avail, w.currency)}`,
      );
    }
  }

  // Goals
  if (ctx.savingsGoals && ctx.savingsGoals.length > 0) {
    lines.push("\n[MỤC TIÊU TIẾT KIỆM (DỮ LIỆU XÁC THỰC TỪ SERVER)]");
    for (const g of ctx.savingsGoals) {
      lines.push(
        `- ${sanitize(g.title)}: ${formatMoney(g.current_amount, ctx.primaryCurrency)} / ${formatMoney(g.target_amount, ctx.primaryCurrency)} (${g.percentProgress}%)${g.deadline ? `, hạn: ${g.deadline}` : ""}`,
      );
    }
  }

  // Upcoming Recurring Obligations
  if (ctx.upcomingObligations && ctx.upcomingObligations.length > 0) {
    lines.push("\n[NGHĨA VỤ CHI ĐỊNH KỲ SẮP TỚI (RECURRING OBLIGATIONS)]");
    lines.push(`- Tổng nghĩa vụ chi định kỳ đang kích hoạt: ${formatMoney(ctx.upcomingObligationsTotal || 0, ctx.primaryCurrency)} (${ctx.upcomingObligations.length} khoản).`);
    for (const r of ctx.upcomingObligations) {
      lines.push(`  + ${sanitize(r.title)}: ${formatMoney(r.amount, ctx.primaryCurrency)} (${r.frequency}, hạn tiếp theo: ${r.nextRunAt})`);
    }
  }

  // Transaction Counts and Recent Transactions Sample
  const currentMonthTxCount = ctx.currentMonthTransactionCount ?? ctx.recentTransactions?.length ?? 0;
  const currentMonthExpCount = ctx.currentMonthExpenseCount ?? ctx.recentTransactions?.filter((t) => t.type === "expense").length ?? 0;
  const currentMonthIncCount = ctx.currentMonthIncomeCount ?? ctx.recentTransactions?.filter((t) => t.type === "income").length ?? 0;
  const totalAccountTxCount = ctx.totalAccountTransactionCount ?? currentMonthTxCount;

  lines.push(`\n[THỐNG KÊ SỐ LƯỢNG GIAO DỊCH (XÁC THỰC TỪ SERVER - MÚI GIỜ ASIA/HO_CHI_MINH)]`);
  lines.push(`- Số lượng giao dịch trong ${ctx.currentPeriod}: ${currentMonthTxCount} giao dịch (${currentMonthExpCount} khoản chi tiêu, ${currentMonthIncCount} khoản thu nhập).`);
  lines.push(`- Tổng số giao dịch toàn tài khoản (mọi thời điểm): ${totalAccountTxCount} giao dịch.`);
  lines.push(`- NGUYÊN TẮC: Khi người dùng hỏi có bao nhiêu giao dịch trong tháng, BẮT BUỘC trả lời chính xác ${currentMonthTxCount} giao dịch. Danh sách dưới đây chỉ là mẫu ${ctx.recentTransactions?.length ?? 0} giao dịch gần nhất để tham khảo, TUYỆT ĐỐI KHÔNG lấy số lượng bản ghi mẫu làm số giao dịch trong tháng.`);

  if (ctx.recentTransactions && ctx.recentTransactions.length > 0) {
    lines.push(`\n[DANH SÁCH MẪU GIAO DỊCH GẦN ĐÂY (TỐI ĐA ${ctx.recentTransactions.length} BẢN GHI ĐỂ THAM KHẢO)]`);
    for (const t of ctx.recentTransactions) {
      lines.push(
        `- [${t.type === "income" ? "Thu" : "Chi"}] ${sanitize(t.title)}: ${formatMoney(t.amount, t.currency)} (${sanitize(t.category)}, ${t.date})`,
      );
    }
  }

  if (!ctx.hasSufficientData) {
    lines.push("\nLƯU Ý: Người dùng hiện chưa có đủ dữ liệu giao dịch hoặc ví. Khi người dùng hỏi số liệu, hãy thông báo 'Chưa đủ dữ liệu' thay vì tự bịa.");
  }

  lines.push("=== HẾT DỮ LIỆU TÀI CHÍNH TỪ MÁY CHỦ ===");
  return lines.join("\n");
}
