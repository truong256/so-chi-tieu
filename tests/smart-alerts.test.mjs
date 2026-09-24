import assert from "node:assert/strict";
import test from "node:test";
import { generateSmartAlerts } from "../frontend/services/smart-alerts.service.ts";

const mockWallets = [
  { id: "w1", name: "Ví Tiền mặt", type: "cash", balance: 50000, reserved_amount: 0, currency: "VND" },
];

const mockAvailableBalances = new Map([["w1", 50000]]);

const mockBudgets = [
  {
    id: "b1",
    user_id: "u1",
    name: "Ăn uống",
    amount: 1000000,
    allocated_amount: 1000000,
    spent_amount: 900000,
    remaining_amount: 100000,
    alert_percent: 80,
    status: "active",
    period: "monthly",
  },
];

const mockGoals = [
  {
    id: "g1",
    user_id: "u1",
    title: "Mua laptop",
    target_amount: 20000000,
    current_amount: 20000000, // completed
    deadline: "2026-12-31",
  },
];

const mockRecurring = [
  {
    id: "r1",
    user_id: "u1",
    title: "Tiền trọ",
    amount: 3000000,
    type: "expense",
    frequency: "monthly",
    next_run_at: new Date(Date.now() + 86400000).toISOString(), // tomorrow
    active: true,
  },
];

const mockTransactions = [
  {
    id: "t1",
    type: "expense",
    amount: 850000, // 85% spent
    category_id: null,
    occurred_at: new Date().toISOString(),
  },
];

test("generateSmartAlerts flags budget near limit and low wallet balance", () => {
  const alerts = generateSmartAlerts({
    wallets: mockWallets,
    availableBalances: mockAvailableBalances,
    transactions: mockTransactions,
    budgets: mockBudgets,
    goals: mockGoals,
    recurring: mockRecurring,
    formatMoney: (v) => `${v}đ`,
  });

  // Check budget near limit alert
  const budgetAlert = alerts.find((a) => a.type === "budget_near");
  assert.ok(budgetAlert, "Expected budget_near alert");
  assert.equal(budgetAlert.severity, "warning");

  // Check low balance alert (< 100k)
  const walletAlert = alerts.find((a) => a.type === "low_balance");
  assert.ok(walletAlert, "Expected low_balance alert");

  // Check upcoming recurring alert (tomorrow)
  const recAlert = alerts.find((a) => a.type === "recurring_due");
  assert.ok(recAlert, "Expected recurring_due alert");

  // Check goal completed alert
  const goalAlert = alerts.find((a) => a.type === "goal_done");
  assert.ok(goalAlert, "Expected goal_done alert");
});
