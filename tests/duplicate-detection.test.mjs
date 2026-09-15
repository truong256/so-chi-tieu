import assert from "node:assert/strict";
import test from "node:test";
import { detectDuplicateTransaction } from "../frontend/services/duplicate-detection.service.ts";

const mockExistingTransactions = [
  {
    id: "tx-1",
    user_id: "u-1",
    title: "Ăn trưa cơm tấm",
    amount: 45000,
    type: "expense",
    wallet_id: "w-cash",
    category: "Ăn uống",
    occurred_at: "2026-09-15T12:00:00.000Z",
    payment_source_type: "wallet",
    budget_id: null,
  },
  {
    id: "tx-2",
    user_id: "u-1",
    title: "Nhận lương tháng 9",
    amount: 15000000,
    type: "income",
    wallet_id: "w-bank",
    category: "Lương",
    occurred_at: "2026-09-05T08:00:00.000Z",
    payment_source_type: "wallet",
    budget_id: null,
  },
];

test("detectDuplicateTransaction flags exact match within close timeframe", () => {
  const duplicate = detectDuplicateTransaction(
    {
      title: "Ăn trưa cơm tấm",
      amount: 45000,
      type: "expense",
      walletId: "w-cash",
      occurredAt: "2026-09-15T12:30:00.000Z",
    },
    mockExistingTransactions,
  );

  assert.equal(duplicate.isDuplicate, true);
  assert.ok(duplicate.confidence >= 0.8);
  assert.equal(duplicate.matchedTransaction?.id, "tx-1");
});

test("detectDuplicateTransaction flags similar title with diacritics / casing differences", () => {
  const duplicate = detectDuplicateTransaction(
    {
      title: "an trua com tam",
      amount: 45000,
      type: "expense",
      walletId: "w-cash",
      occurredAt: "2026-09-15T13:00:00.000Z",
    },
    mockExistingTransactions,
  );

  assert.equal(duplicate.isDuplicate, true);
  assert.equal(duplicate.matchedTransaction?.id, "tx-1");
});

test("detectDuplicateTransaction ignores transactions with different amount or type", () => {
  const diffAmount = detectDuplicateTransaction(
    {
      title: "Ăn trưa cơm tấm",
      amount: 55000,
      type: "expense",
      walletId: "w-cash",
      occurredAt: "2026-09-15T12:00:00.000Z",
    },
    mockExistingTransactions,
  );
  assert.equal(diffAmount.isDuplicate, false);

  const diffType = detectDuplicateTransaction(
    {
      title: "Ăn trưa cơm tấm",
      amount: 45000,
      type: "income",
      walletId: "w-cash",
      occurredAt: "2026-09-15T12:00:00.000Z",
    },
    mockExistingTransactions,
  );
  assert.equal(diffType.isDuplicate, false);
});

test("detectDuplicateTransaction skips matching against self when editing", () => {
  const selfCheck = detectDuplicateTransaction(
    {
      id: "tx-1",
      title: "Ăn trưa cơm tấm",
      amount: 45000,
      type: "expense",
      walletId: "w-cash",
      occurredAt: "2026-09-15T12:00:00.000Z",
    },
    mockExistingTransactions,
  );
  assert.equal(selfCheck.isDuplicate, false);
});
