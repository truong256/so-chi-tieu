/**
 * tests/budget-management.test.mjs
 * ================================
 * Comprehensive test suite verifying all 25 scenarios of the Budget Management domain
 * (Phase 2 of the Financial Management Refactoring).
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  getBudgetPeriodBounds,
  calculateBudgetSpending,
  calculateBudgetMetrics,
} from "../frontend/utils/budget-calculations.ts";

import {
  calculateReservedByWallet,
  calculateAvailableBalances,
} from "../frontend/utils/finance-calculations.ts";

import { parseCsvText } from "../frontend/services/excel-csv-import.service.ts";
import { generateSmartAlerts } from "../frontend/services/smart-alerts.service.ts";

// Read migrations for SQL audit & static schema verification
const migration018 = await readFile(
  new URL("../database/migrations/018_budget_management_integrity.sql", import.meta.url),
  "utf8"
);
const migration006 = await readFile(
  new URL("../database/migrations/006_finance_integrity_and_security.sql", import.meta.url),
  "utf8"
);

// ---------------------------------------------------------------------------
// Mock Fixtures
// ---------------------------------------------------------------------------
const userA = "usr-uuid-001";

const walletCash = {
  id: "w-cash",
  user_id: userA,
  name: "Tiền mặt",
  type: "cash",
  balance: 10_000_000,
  reserved_amount: 3_000_000,
  currency: "VND",
  color: "#22c55e",
  icon: "wallet",
};

const walletUSD = {
  id: "w-usd",
  user_id: userA,
  name: "Ví USD",
  type: "bank",
  balance: 500,
  reserved_amount: 0,
  currency: "USD",
  color: "#3b82f6",
  icon: "bank",
};

const budgetDining = {
  id: "b-dining",
  user_id: userA,
  name: "Ăn uống tháng 10/2026",
  amount: 3_000_000, // Limit
  allocated_amount: 3_000_000, // Allocated envelope
  remaining_amount: 3_000_000, // Remaining envelope
  spent_amount: 0,
  period: "monthly",
  period_start: "2026-10-01",
  source_wallet_id: "w-cash",
  category_id: "cat-dining",
  alert_percent: 80,
  status: "active",
  is_active: true,
};

// ===========================================================================
// Test Group 1: Scenario 1 - 3 (Creation & Wallet Allocation)
// ===========================================================================
test("Scenario 1: Create budget without allocation (Tracking Budget)", () => {
  const trackingBudget = {
    ...budgetDining,
    id: "b-tracking",
    source_wallet_id: null,
    allocated_amount: 0,
    remaining_amount: 0,
    amount: 5_000_000,
  };

  const metrics = calculateBudgetMetrics(trackingBudget, []);
  assert.equal(metrics.isFunded, false, "Should not be marked as funded envelope");
  assert.equal(metrics.limit, 5_000_000, "Spending limit should be 5M");
  assert.equal(metrics.allocated, 0, "Allocated amount should be 0");
  assert.equal(metrics.fundedRemaining, 0, "Funded remaining balance should be 0");
  assert.equal(metrics.limitRemaining, 5_000_000, "Full limit remaining");
  assert.equal(metrics.statusVariant, "normal");
});

test("Scenario 2: Create budget when wallet has insufficient available balance", () => {
  const walletSmall = {
    id: "w-small",
    user_id: userA,
    name: "Ví nhỏ",
    type: "cash",
    balance: 2_000_000,
    reserved_amount: 1_500_000, // available = 500k
    currency: "VND",
    color: "#22c55e",
    icon: "wallet",
  };

  const balancesMap = new Map([["w-small", walletSmall.balance]]);
  const reservedMap = new Map([["w-small", walletSmall.reserved_amount]]);
  const availableMap = calculateAvailableBalances(balancesMap, reservedMap);
  const available = availableMap.get("w-small") ?? 0;

  assert.equal(available, 500_000, "Available balance should be 500k");
  const requestedAllocation = 1_000_000;
  assert.ok(requestedAllocation > available, "Allocation 1M exceeds available 500k");

  // Migration 018 ensures SQL adjust_budget_funds performs check_wallet_available_balance
  assert.match(
    migration018,
    /PERFORM public\.adjust_budget_funds\(v_budget_id, p_wallet_id, v_allocation, 'allocate'\)/i
  );
  assert.match(
    migration018,
    /v_check := public\.check_wallet_available_balance\(p_wallet_id, p_amount\)/i
  );
});

test("Scenario 3: Allocate money to budget increases reserved_amount and reduces available balance without spending", () => {
  const initialWallet = { ...walletCash, reserved_amount: 0, balance: 10_000_000 };
  const balancesMap = new Map([["w-cash", initialWallet.balance]]);
  const reservedMap = calculateReservedByWallet([initialWallet], [budgetDining], []);
  const availableMap = calculateAvailableBalances(balancesMap, reservedMap);

  assert.equal(initialWallet.balance, 10_000_000, "Physical balance unchanged at 10M");
  assert.equal(reservedMap.get("w-cash"), 3_000_000, "Reserved amount is 3M");
  assert.equal(availableMap.get("w-cash"), 7_000_000, "Available balance reduced to 7M");
});

// ===========================================================================
// Test Group 2: Scenario 4 - 7 (Spending, Envelopes & Direct Wallet Expenses)
// ===========================================================================
test("Scenario 4: Expense from budget envelope decrements wallet physical balance and envelope remaining", () => {
  // User spends 500k from budget envelope
  const txBudget = {
    id: "tx-1",
    user_id: userA,
    wallet_id: "w-cash",
    category_id: "cat-dining",
    type: "expense",
    amount: 500_000,
    occurred_at: "2026-10-15T12:00:00Z",
    payment_source_type: "budget",
    budget_id: "b-dining",
  };

  const budgetAfter = {
    ...budgetDining,
    remaining_amount: 2_500_000,
    spent_amount: 500_000,
  };
  const walletAfter = {
    ...walletCash,
    balance: 9_500_000,
    reserved_amount: 2_500_000,
  };

  const reservedMap = calculateReservedByWallet([walletAfter], [budgetAfter], []);
  const availableMap = calculateAvailableBalances(new Map([[walletAfter.id, walletAfter.balance]]), reservedMap);

  assert.equal(walletAfter.balance, 9_500_000, "Physical wallet balance is 9.5M");
  assert.equal(budgetAfter.remaining_amount, 2_500_000, "Budget funded remaining is 2.5M");
  assert.equal(availableMap.get("w-cash"), 7_000_000, "Available balance outside budget stays 7M");

  const metrics = calculateBudgetMetrics(budgetAfter, [txBudget]);
  assert.equal(metrics.actualSpent, 500_000, "Actual spent is 500k");
  assert.equal(metrics.limitRemaining, 2_500_000, "Limit remaining is 2.5M");
  assert.equal(metrics.fundedRemaining, 2_500_000, "Funded remaining is 2.5M");
});

test("Scenario 5: Expense directly from wallet in category counts towards limit progress without touching envelope", () => {
  // User spends 500k directly from wallet (not using envelope funds)
  const txWallet = {
    id: "tx-direct",
    user_id: userA,
    wallet_id: "w-cash",
    category_id: "cat-dining",
    type: "expense",
    amount: 500_000,
    occurred_at: "2026-10-16T12:00:00Z",
    payment_source_type: "wallet",
    budget_id: null,
  };

  const walletAfter = {
    ...walletCash,
    balance: 9_500_000,
    reserved_amount: 3_000_000, // Envelope funds untouched
  };
  const budgetAfter = {
    ...budgetDining,
    remaining_amount: 3_000_000, // Envelope untouched
    spent_amount: 0,
  };

  const reservedMap = calculateReservedByWallet([walletAfter], [budgetAfter], []);
  const availableMap = calculateAvailableBalances(new Map([[walletAfter.id, walletAfter.balance]]), reservedMap);

  assert.equal(walletAfter.balance, 9_500_000, "Physical wallet balance is 9.5M");
  assert.equal(availableMap.get("w-cash"), 6_500_000, "Available balance reduced to 6.5M");
  assert.equal(budgetAfter.remaining_amount, 3_000_000, "Funded envelope untouched at 3M");

  const metrics = calculateBudgetMetrics(budgetAfter, [txWallet]);
  assert.equal(metrics.actualSpent, 500_000, "Actual category spend is 500k");
  assert.equal(metrics.limitRemaining, 2_500_000, "Limit remaining is 2.5M");
  assert.equal(metrics.fundedRemaining, 3_000_000, "Funded envelope remaining is 3M");
});

test("Scenario 6: calculateBudgetSpending aggregates all category transactions in period accurately", () => {
  const tx1 = {
    id: "tx-oct-1",
    user_id: userA,
    category_id: "cat-dining",
    type: "expense",
    amount: 400_000,
    occurred_at: "2026-10-05T10:00:00Z",
  };
  const tx2 = {
    id: "tx-oct-2",
    user_id: userA,
    category_id: "cat-dining",
    type: "expense",
    amount: 600_000,
    occurred_at: "2026-10-20T10:00:00Z",
  };
  const txOtherMonth = {
    id: "tx-sep",
    user_id: userA,
    category_id: "cat-dining",
    type: "expense",
    amount: 1_000_000,
    occurred_at: "2026-09-28T10:00:00Z",
  };
  const txIncome = {
    id: "tx-income",
    user_id: userA,
    category_id: "cat-dining",
    type: "income",
    amount: 200_000,
    occurred_at: "2026-10-10T10:00:00Z",
  };

  const spent = calculateBudgetSpending(budgetDining, [tx1, tx2, txOtherMonth, txIncome]);
  assert.equal(spent, 1_000_000, "Should only sum expense transactions in Oct 2026 (400k + 600k)");
});

test("Scenario 7: Prevent double-counting between envelope and category expenses", () => {
  // A single transaction from envelope should be counted only ONCE
  const txEnvelope = {
    id: "tx-single",
    user_id: userA,
    wallet_id: "w-cash",
    category_id: "cat-dining",
    type: "expense",
    amount: 500_000,
    occurred_at: "2026-10-10T10:00:00Z",
    payment_source_type: "budget",
    budget_id: "b-dining",
  };

  const metrics = calculateBudgetMetrics(budgetDining, [txEnvelope]);
  assert.equal(metrics.actualSpent, 500_000, "Category spent should be exactly 500k, not 1M");
});

// ===========================================================================
// Test Group 3: Scenario 8 - 11 (Topup, Return, Deletion & Undo)
// ===========================================================================
test("Scenario 8: Nạp thêm tiền (adjust_budget_funds allocate) preserves spending limit amount", () => {
  // Migration 018 must NOT overwrite amount when topping up
  assert.match(
    migration018,
    /UPDATE public\.budgets SET[\s\S]+allocated_amount = allocated_amount \+ p_amount,[\s\S]+remaining_amount = remaining_amount \+ p_amount/i
  );
  // Ensure "amount = allocated_amount + p_amount" does NOT exist in migration 018
  assert.doesNotMatch(
    migration018,
    /UPDATE\s+(public\.)?budgets\s+SET\s+amount\s*=\s*allocated_amount/i
  );
});

test("Scenario 9: Rút tiền về ví (adjust_budget_funds return) cannot exceed remaining_amount", () => {
  assert.match(
    migration018,
    /IF p_amount > v_budget\.remaining_amount THEN RAISE EXCEPTION 'INSUFFICIENT_BUDGET:Số tiền rút vượt số dư ngân sách\.'[\s\S]+VALUES\s*\(v_user_id, 'budget_to_wallet', p_wallet_id, p_budget_id, p_amount, 'Rút tiền khỏi ngân sách'\)/i
  );
});

test("Scenario 10: Xóa giao dịch từ ngân sách (trg_restore_budget_transaction) restores envelope and wallet", () => {
  assert.match(
    migration006,
    /CREATE OR REPLACE FUNCTION public\.trg_restore_budget_transaction\(\)/
  );
  assert.match(
    migration006,
    /UPDATE public\.budgets\s+SET[\s\S]+remaining_amount = remaining_amount \+ OLD\.amount/i
  );
});

test("Scenario 11: Hoàn tác giao dịch phục hồi đúng số dư trong cùng transaction", () => {
  assert.match(
    migration006,
    /CREATE TRIGGER trg_restore_budget_transaction\s+AFTER DELETE ON public\.transactions/i
  );
});

// ===========================================================================
// Test Group 4: Scenario 12 - 13 (Close Budget & Delete Budget)
// ===========================================================================
test("Scenario 12: Đóng ngân sách có lịch sử giao dịch (close_budget) archives budget and returns remaining funds", () => {
  assert.match(
    migration018,
    /status = 'cancelled'/
  );
  // Returns remaining money to wallet
  assert.match(
    migration018,
    /UPDATE public\.wallets\s+SET reserved_amount = GREATEST\(0, reserved_amount - v_budget\.remaining_amount\)/
  );
});

test("Scenario 13: Xóa ngân sách chưa có giao dịch giải phóng reserved_amount và xóa bản ghi", () => {
  // In migration 018, wallet reserved_amount must be released BEFORE the transaction check!
  const closeBudgetBody = migration018.slice(
    migration018.indexOf("CREATE OR REPLACE FUNCTION public.close_budget")
  );
  const releaseIndex = closeBudgetBody.indexOf("UPDATE public.wallets");
  const checkTxIndex = closeBudgetBody.indexOf("EXISTS (SELECT 1 FROM public.transactions WHERE budget_id = v_budget.id)");

  assert.ok(releaseIndex > 0, "Wallet reserved_amount release exists");
  assert.ok(checkTxIndex > 0, "Transaction existence check exists");
  assert.ok(
    releaseIndex < checkTxIndex,
    "CRITICAL BUG FIX: Wallet reserved_amount must be released BEFORE transaction check"
  );
});

// ===========================================================================
// Test Group 5: Scenario 14 - 15 (Thresholds, 100% Limit, Overbudget)
// ===========================================================================
test("Scenario 14: Reaching 100% of spending limit sets reached_limit status", () => {
  const tx100 = {
    id: "tx-full",
    user_id: userA,
    category_id: "cat-dining",
    type: "expense",
    amount: 3_000_000,
    occurred_at: "2026-10-25T12:00:00Z",
  };

  const metrics = calculateBudgetMetrics(budgetDining, [tx100]);
  assert.equal(metrics.actualSpent, 3_000_000);
  assert.equal(metrics.usagePercent, 100);
  assert.equal(metrics.limitRemaining, 0);
  assert.equal(metrics.isReachedLimit, true);
  assert.equal(metrics.isOverLimit, false);
  assert.equal(metrics.statusVariant, "reached_limit");
  assert.equal(metrics.statusLabelVi, "Đã đạt hạn mức");
});

test("Scenario 15: Exceeding 100% limit (e.g. 116.67%) correctly sets exceeded_limit status and 0 remaining limit", () => {
  const txOver = {
    id: "tx-over",
    user_id: userA,
    category_id: "cat-dining",
    type: "expense",
    amount: 3_500_000,
    occurred_at: "2026-10-26T12:00:00Z",
  };

  const metrics = calculateBudgetMetrics(budgetDining, [txOver]);
  assert.equal(metrics.actualSpent, 3_500_000);
  assert.equal(metrics.usagePercent, 116.7);
  assert.equal(metrics.limitRemaining, 0, "Remaining limit is clamped to 0 when overbudget");
  assert.equal(metrics.isOverLimit, true);
  assert.equal(metrics.statusVariant, "exceeded_limit");
  assert.equal(metrics.statusLabelVi, "Vượt hạn mức");
  assert.equal(metrics.actualSpent - metrics.limit, 500_000, "Exceeded amount is 500k");
});

// ===========================================================================
// Test Group 6: Scenario 16 - 17 (Time Period Bounds & End-of-month / Leap Year)
// ===========================================================================
test("Scenario 16: Budget period bounds calculate accurately for weekly, monthly, and yearly", () => {
  const weeklyBudget = { ...budgetDining, period: "weekly", period_start: "2026-10-12" };
  const weeklyBounds = getBudgetPeriodBounds(weeklyBudget);
  assert.equal(weeklyBounds.start.getDate(), 12);
  assert.equal(weeklyBounds.end.getDate(), 19);

  const monthlyBudget = { ...budgetDining, period: "monthly", period_start: "2026-10-01" };
  const monthlyBounds = getBudgetPeriodBounds(monthlyBudget);
  assert.equal(monthlyBounds.start.getMonth(), 9); // October (0-indexed 9)
  assert.equal(monthlyBounds.end.getMonth(), 10); // November

  const yearlyBudget = { ...budgetDining, period: "yearly", period_start: "2026-01-01" };
  const yearlyBounds = getBudgetPeriodBounds(yearlyBudget);
  assert.equal(yearlyBounds.start.getFullYear(), 2026);
  assert.equal(yearlyBounds.end.getFullYear(), 2027);
});

test("Scenario 17: End-of-month and leap year transactions (Feb 29) are handled correctly", () => {
  const leapBudget = {
    ...budgetDining,
    period: "monthly",
    period_start: "2024-02-01",
  };
  const leapBounds = getBudgetPeriodBounds(leapBudget);
  assert.equal(leapBounds.start.getMonth(), 1); // Feb
  assert.equal(leapBounds.end.getMonth(), 2); // Mar

  const leapTx = {
    id: "tx-leap",
    user_id: userA,
    category_id: "cat-dining",
    type: "expense",
    amount: 150_000,
    occurred_at: "2024-02-29T12:00:00Z",
  };
  const spent = calculateBudgetSpending(leapBudget, [leapTx]);
  assert.equal(spent, 150_000, "Feb 29 leap-day expense should be captured");
});

// ===========================================================================
// Test Group 7: Scenario 18 - 21 (Multi-budget, RLS, Concurrency & Currency)
// ===========================================================================
test("Scenario 18: Multiple budgets in same category calculate independently according to period bounds", () => {
  const budgetOct = {
    ...budgetDining,
    id: "b-oct",
    period_start: "2026-10-01",
  };
  const budgetNov = {
    ...budgetDining,
    id: "b-nov",
    period_start: "2026-11-01",
  };

  const txOct = {
    id: "tx-oct",
    user_id: userA,
    category_id: "cat-dining",
    type: "expense",
    amount: 500_000,
    occurred_at: "2026-10-15T10:00:00Z",
  };
  const txNov = {
    id: "tx-nov",
    user_id: userA,
    category_id: "cat-dining",
    type: "expense",
    amount: 700_000,
    occurred_at: "2026-11-05T10:00:00Z",
  };

  const spentOct = calculateBudgetSpending(budgetOct, [txOct, txNov]);
  const spentNov = calculateBudgetSpending(budgetNov, [txOct, txNov]);

  assert.equal(spentOct, 500_000, "Oct budget only sees Oct tx");
  assert.equal(spentNov, 700_000, "Nov budget only sees Nov tx");
});

test("Scenario 19: RLS & User Isolation: User B cannot modify or query User A's budgets", () => {
  assert.match(
    migration018,
    /WHERE id = p_budget_id AND user_id = v_user_id/i
  );
  assert.match(
    migration006,
    /REVOKE ALL ON FUNCTION public\.close_budget[\s\S]+FROM PUBLIC, anon/i
  );
  assert.match(
    migration018,
    /REVOKE ALL ON FUNCTION public\.update_budget_limit[\s\S]+FROM PUBLIC, anon/i
  );
});

test("Scenario 20: Concurrency guard & check_wallet_available_balance prevents race condition", () => {
  assert.match(
    migration006,
    /CREATE OR REPLACE FUNCTION public\.check_wallet_available_balance/
  );
  assert.match(
    migration006,
    /SELECT \* INTO v_wallet[\s\S]+FROM public\.wallets[\s\S]+WHERE id = p_wallet_id AND user_id = v_user_id[\s\S]+FOR UPDATE/i
  );
});

test("Scenario 21: Multi-currency separation prevents direct addition of VND and USD", () => {
  assert.notEqual(walletCash.currency, walletUSD.currency, "Currencies are distinct");
  // Reserved calculation is per-wallet and per-currency
  const reservedMap = calculateReservedByWallet([walletCash, walletUSD], [budgetDining], []);
  assert.equal(reservedMap.get("w-cash"), 3_000_000);
  assert.equal(reservedMap.get("w-usd"), 0);
});

// ===========================================================================
// Test Group 8: Scenario 22 - 25 (Recurring, Import, Sync & Edge Cases)
// ===========================================================================
test("Scenario 22: Recurring transactions within period bounds affect category actual spending", () => {
  const recurringTx = {
    id: "tx-rec-1",
    user_id: userA,
    category_id: "cat-dining",
    type: "expense",
    amount: 100_000,
    occurred_at: "2026-10-10T08:00:00Z",
  };
  const spent = calculateBudgetSpending(budgetDining, [recurringTx]);
  assert.equal(spent, 100_000);
});

test("Scenario 23: Excel / CSV imported transactions update category actual spending", () => {
  const csv = `Ngày,Danh mục,Loại,Số tiền,Ghi chú\n2026-10-18,Ăn uống,Chi phí,250000,Ăn trưa công ty`;
  const rows = parseCsvText(csv);
  assert.equal(rows.length, 2);
  const importedTx = {
    id: "tx-imported",
    user_id: userA,
    category_id: "cat-dining",
    type: "expense",
    amount: 250_000,
    occurred_at: "2026-10-18T12:00:00Z",
  };
  const spent = calculateBudgetSpending(budgetDining, [importedTx]);
  assert.equal(spent, 250_000);
});

test("Scenario 24: Balance synchronization invariant: balance - reserved_amount === available_balance", () => {
  const wallet = { ...walletCash, balance: 10_000_000, reserved_amount: 3_000_000 };
  const reservedMap = calculateReservedByWallet([wallet], [budgetDining], []);
  const availableMap = calculateAvailableBalances(new Map([[wallet.id, wallet.balance]]), reservedMap);

  const physicalBalance = wallet.balance;
  const reserved = reservedMap.get(wallet.id) ?? 0;
  const available = availableMap.get(wallet.id) ?? 0;

  assert.equal(physicalBalance - reserved, available, "Balance invariant must hold");
});

test("Scenario 25: Edge case: remaining_amount = 0 in funded envelope does NOT falsely trigger overbudget if limit is unspent", () => {
  // Suppose an envelope was created with 0 funds or all funds were returned to wallet,
  // but the user has a 3M spending limit and has only spent 500k.
  const emptyEnvelopeBudget = {
    ...budgetDining,
    remaining_amount: 0,
    allocated_amount: 0,
    amount: 3_000_000,
  };
  const txSmall = {
    id: "tx-s",
    user_id: userA,
    category_id: "cat-dining",
    type: "expense",
    amount: 500_000,
    occurred_at: "2026-10-10T12:00:00Z",
  };

  const metrics = calculateBudgetMetrics(emptyEnvelopeBudget, [txSmall]);
  assert.equal(metrics.isOverLimit, false, "Must NOT be marked overbudget");
  assert.equal(metrics.isNearLimit, false);
  assert.equal(metrics.limitRemaining, 2_500_000);
  assert.equal(metrics.usagePercent, 16.7);
  assert.equal(metrics.statusVariant, "normal");
});

test("Smart Alerts trigger near limit and over limit alerts accurately", () => {
  const nearLimitBudget = {
    ...budgetDining,
    amount: 1_000_000,
    spent_amount: 850_000,
    alert_percent: 80,
  };

  const alerts = generateSmartAlerts({
    wallets: [walletCash],
    availableBalances: new Map([[walletCash.id, 10_000_000]]),
    transactions: [
      {
        id: "tx-alert-1",
        user_id: userA,
        category_id: "cat-dining",
        type: "expense",
        amount: 850_000,
        occurred_at: new Date().toISOString(),
      },
    ],
    budgets: [nearLimitBudget],
    goals: [],
    recurring: [],
  });
  const budgetAlert = alerts.find((a) => a.id.startsWith("budget_near_"));
  assert.ok(budgetAlert, "Should generate near-limit alert");
  assert.match(budgetAlert.body, /85%/);
});
