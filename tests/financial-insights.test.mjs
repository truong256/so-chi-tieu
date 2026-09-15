import assert from "node:assert/strict";
import test from "node:test";
import { calculateFinancialInsights } from "../frontend/services/financial-insights.service.ts";

const mockCategories = [
  { id: "c-food", user_id: "u-1", name: "Ăn uống", kind: "expense", parent_id: null, icon: "", color: "#FF9466", is_default: true },
  { id: "c-transport", user_id: "u-1", name: "Di chuyển", kind: "expense", parent_id: null, icon: "", color: "#7C8CFF", is_default: true },
  { id: "c-salary", user_id: "u-1", name: "Lương", kind: "income", parent_id: null, icon: "", color: "#78B732", is_default: true },
];

const mockTransactions = [
  // Current month (September 2026)
  {
    id: "tx-cur-1",
    user_id: "u-1",
    title: "Lương tháng 9",
    amount: 20000000,
    type: "income",
    category_id: "c-salary",
    category: "Lương",
    occurred_at: "2026-09-01T08:00:00.000Z",
  },
  {
    id: "tx-cur-2",
    user_id: "u-1",
    title: "Ăn uống tháng 9",
    amount: 6000000,
    type: "expense",
    category_id: "c-food",
    category: "Ăn uống",
    occurred_at: "2026-09-10T12:00:00.000Z",
  },
  {
    id: "tx-cur-3",
    user_id: "u-1",
    title: "Mua sắm xe máy lớn",
    amount: 4000000,
    type: "expense",
    category_id: "c-transport",
    category: "Di chuyển",
    occurred_at: "2026-09-14T15:00:00.000Z",
  },
  // Previous month (August 2026)
  {
    id: "tx-prev-1",
    user_id: "u-1",
    title: "Lương tháng 8",
    amount: 20000000,
    type: "income",
    category_id: "c-salary",
    category: "Lương",
    occurred_at: "2026-08-01T08:00:00.000Z",
  },
  {
    id: "tx-prev-2",
    user_id: "u-1",
    title: "Ăn uống tháng 8",
    amount: 4000000,
    type: "expense",
    category_id: "c-food",
    category: "Ăn uống",
    occurred_at: "2026-08-10T12:00:00.000Z",
  },
];

test("calculateFinancialInsights accurately calculates savings rate and cash flow", () => {
  const refDate = new Date("2026-09-15T12:00:00.000Z");
  const insights = calculateFinancialInsights(mockTransactions, mockCategories, [], [], refDate);

  assert.equal(insights.currentIncome, 20000000);
  assert.equal(insights.currentExpense, 10000000);
  assert.equal(insights.netCashFlow, 10000000);
  assert.equal(insights.savingsRate, 50); // (20M - 10M) / 20M = 50%
});

test("calculateFinancialInsights detects category spending spikes", () => {
  const refDate = new Date("2026-09-15T12:00:00.000Z");
  const insights = calculateFinancialInsights(mockTransactions, mockCategories, [], [], refDate);

  // Food spending went from 4M to 6M (+50%)
  const foodCmp = insights.categoryComparisons.find((c) => c.categoryId === "c-food");
  assert.ok(foodCmp);
  assert.equal(foodCmp.currentAmount, 6000000);
  assert.equal(foodCmp.previousAmount, 4000000);
  assert.equal(foodCmp.percentChange, 50);

  // Should flag an anomaly for food category spike
  const anomaly = insights.anomalies.find((a) => a.type === "category_spike");
  assert.ok(anomaly, "Expected category spike anomaly to be detected");
});

test("calculateFinancialInsights detects unusually large transactions", () => {
  const refDate = new Date("2026-09-15T12:00:00.000Z");
  const insights = calculateFinancialInsights(mockTransactions, mockCategories, [], [], refDate);

  // Transport tx is 4M out of 10M total expense (40% >= 30%)
  const largeTxAnomalies = insights.anomalies.filter((a) => a.type === "large_transaction");
  assert.ok(largeTxAnomalies.length >= 1, "Expected large transaction anomaly");
  assert.ok(largeTxAnomalies.some((a) => a.relatedId === "tx-cur-3"), "Expected tx-cur-3 to be flagged as large transaction");
});
