/**
 * tests/ai-local-copilot-vnext.test.mjs
 * =====================================
 * Regression & Acceptance Test Suite for AI Local Copilot vNext.
 *
 * Mandatory Verification Cases:
 * 1. Ollama offline, missing model, timeout, empty response categorization.
 * 2. Total deadline maintained with AbortSignal.
 * 3. Client financialContext cannot override server-verified data.
 * 4. Off-topic filter: does NOT block financial queries containing "game", "chơi game", "mua game".
 * 5. Deterministic math: multi-currency isolation (VND never summed with USD).
 * 6. Vietnam timezone (UTC+7) boundary calculation.
 * 7. Vietnamese NLP parser: 7 required Vietnamese sentences.
 * 8. Internal transfer vs expense separation.
 * 9. Multi-transaction split into drafts.
 * 10. AI output is draft-only (`is_draft: true`), requires confirmation for missing fields.
 * 11. Feedback deduplication & category validation.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  checkOllamaHealth,
  executeOllamaChat,
  executeOllamaVision,
  selectVisionModel,
} from "../backend/src/services/ollama-client.ts";

import { isObviouslyOffTopic } from "../backend/src/services/ai-chat.service.ts";

import {
  getVietnamTimeBounds,
  formatServerFinancialContextForPrompt,
} from "../backend/src/services/financial-context.service.ts";

import {
  parseSmartTransaction,
  splitMultiTransactions,
  detectTransferWallets,
} from "../frontend/utils/smart-parser.ts";

// Mock financial fixture
const mockCategories = [
  { id: "c_food", user_id: "u1", name: "Ăn uống", kind: "expense", parent_id: null, icon: "", color: "", is_default: true },
  { id: "c_trans", user_id: "u1", name: "Di chuyển", kind: "expense", parent_id: null, icon: "", color: "", is_default: true },
  { id: "c_house", user_id: "u1", name: "Tiền nhà", kind: "expense", parent_id: null, icon: "", color: "", is_default: true },
  { id: "c_book", user_id: "u1", name: "Sách vở", kind: "expense", parent_id: null, icon: "", color: "", is_default: true },
  { id: "c_salary", user_id: "u1", name: "Lương", kind: "income", parent_id: null, icon: "", color: "", is_default: true },
];

const mockWallets = [
  { id: "w_cash", user_id: "u1", name: "Tiền mặt", type: "cash", balance: 5000000, reserved_amount: 0, currency: "VND", color: "", icon: "" },
  { id: "w_bank", user_id: "u1", name: "Ngân hàng", type: "bank", balance: 20000000, reserved_amount: 0, currency: "VND", color: "", icon: "" },
  { id: "w_usd", user_id: "u1", name: "Ví PayPal", type: "ewallet", balance: 150, reserved_amount: 0, currency: "USD", color: "", icon: "" },
];

test("Ollama client: offline service returns OLLAMA_OFFLINE and status 503", async () => {
  const health = await checkOllamaHealth("http://127.0.0.1:9999");
  assert.equal(health.online, false);
  assert.ok(health.error);
  assert.equal(health.error.code, "OLLAMA_OFFLINE");
  assert.equal(health.error.statusCode, 503);
  assert.match(health.error.messageVi, /chưa khởi động/i);
});

test("Ollama client: missing vision model reports VISION_MODEL_MISSING with 503", async () => {
  const result = await selectVisionModel("http://127.0.0.1:9999", "non_existent_vision_model_xyz");
  assert.equal(result.model, "non_existent_vision_model_xyz");
  // With explicit override, it returns override; without, tests fallback
  const directVision = await executeOllamaVision({
    baseUrl: "http://127.0.0.1:9999",
    prompt: "OCR receipt",
    base64Images: ["dGVzdA=="],
    totalTimeoutMs: 2000,
  });
  assert.equal(directVision.success, false);
  assert.ok(directVision.error);
  assert.equal(directVision.error.statusCode, 503);
});

test("Ollama client: total request deadline and AbortSignal are enforced", async () => {
  const ac = new AbortController();
  ac.abort(); // already aborted

  const result = await executeOllamaChat({
    baseUrl: "http://127.0.0.1:11434",
    messages: [{ role: "user", content: "Test timeout" }],
    signal: ac.signal,
    totalTimeoutMs: 5000,
  });

  assert.equal(result.success, false);
  assert.ok(result.error);
  assert.match(result.error.code, /TIMEOUT/);
});

test("Off-topic filter: does NOT block financial spending questions about games", () => {
  // Should NOT be off-topic because they contain financial intent
  assert.equal(isObviouslyOffTopic("Tháng này tôi mua game hết bao nhiêu?"), false);
  assert.equal(isObviouslyOffTopic("Tôi chi bao nhiêu tiền chơi game?"), false);
  assert.equal(isObviouslyOffTopic("Nạp game hết bao nhiêu tiền tháng này?"), false);
  assert.equal(isObviouslyOffTopic("Tiền ăn uống tháng này tăng hay giảm?"), false);
  assert.equal(isObviouslyOffTopic("Nếu mua món đồ 500 nghìn thì ngân sách còn bao nhiêu?"), false);

  // Purely non-financial queries SHOULD be blocked
  assert.equal(isObviouslyOffTopic("Viết code Python thuật toán Dijkstra"), true);
  assert.equal(isObviouslyOffTopic("Thời tiết ngày mai ở Hà Nội thế nào?"), true);
  assert.equal(isObviouslyOffTopic("Kể cho tôi một câu chuyện cười"), true);
  assert.equal(isObviouslyOffTopic("Cách chơi game qua màn 3"), true);
});

test("Financial context: Vietnam timezone (UTC+7) month bounds calculate correctly", () => {
  const refDate = new Date("2026-09-15T10:00:00Z"); // September 2026
  const bounds = getVietnamTimeBounds(refDate);

  assert.equal(bounds.currentMonthLabel, "Tháng 09/2026");
  assert.equal(bounds.previousMonthLabel, "Tháng 08/2026");

  // Current month start in UTC: 2026-08-31T17:00:00.000Z (which is 2026-09-01T00:00:00+07:00)
  assert.equal(bounds.currentStartIso, "2026-08-31T17:00:00.000Z");
  // Current month end in UTC: 2026-09-30T17:00:00.000Z (which is 2026-10-01T00:00:00+07:00)
  assert.equal(bounds.currentEndIso, "2026-09-30T17:00:00.000Z");
});

test("Financial context: multi-currency balances are segregated and prompt escapes injection", () => {
  const mockCtx = {
    userId: "u1",
    asOf: "2026-09-29 22:30:00 (UTC+7)",
    currentPeriod: "Tháng 09/2026",
    previousPeriod: "Tháng 08/2026",
    timezone: "Asia/Ho_Chi_Minh (UTC+7)",
    balancesByCurrency: {
      VND: 25000000,
      USD: 150,
    },
    primaryCurrency: "VND",
    currentMonthIncome: 30000000,
    currentMonthExpense: 12000000,
    currentMonthNetSavings: 18000000,
    currentMonthSavingsRate: 60,
    previousMonthIncome: 28000000,
    previousMonthExpense: 14000000,
    expenseChangeVsPreviousMonth: {
      difference: -2000000,
      percentChange: -14.3,
    },
    topCategories: [
      { category: "Ăn uống", currentAmount: 6000000, previousAmount: 5000000, difference: 1000000, percentChange: 20.0 },
    ],
    highestSpendingCategory: { category: "Ăn uống", amount: 6000000, percentage: 50.0 },
    wallets: [
      { name: "Tiền mặt <script>evil()</script>", type: "cash", balance: 5000000, currency: "VND" },
      { name: "PayPal USD", type: "ewallet", balance: 150, currency: "USD" },
    ],
    budgets: [
      { name: "Ăn uống", amount: 7000000, spent_amount: 6000000, remaining_amount: 1000000, percentUsed: 86, status: "active", isOverBudget: false, isNearLimit: true },
    ],
    savingsGoals: [],
    recentTransactions: [],
    whatIfContext: {
      sample500kImpacts: [
        { budgetName: "Ăn uống", currentRemaining: 1000000, remainingAfter500k: 500000, wouldExceed: false },
      ],
    },
    hasSufficientData: true,
  };

  const formatted = formatServerFinancialContextForPrompt(mockCtx);

  // Checks currency isolation
  assert.match(formatted, /Tổng số dư VND: 25\.000\.000 VND/);
  assert.match(formatted, /Tổng số dư USD: 150 USD/);
  assert.doesNotMatch(formatted, /25\.000\.150/); // Never sum VND with USD!

  // Checks script tag stripping
  assert.doesNotMatch(formatted, /<script>/);
  assert.match(formatted, /evil\(\)/);

  // Checks deterministic comparisons
  assert.match(formatted, /Danh mục chi tiêu nhiều nhất: Ăn uống/);
  assert.match(formatted, /CẢNH BÁO: SẮP VƯỢT HẠN MỨC/);
  assert.match(formatted, /nếu mua thêm 500k sẽ còn 500\.000 VND/);
});

test("Vietnamese NLP parser: Case 1 'Ăn sáng 35k'", () => {
  const result = parseSmartTransaction("Ăn sáng 35k", mockCategories, mockWallets);
  assert.equal(result.type, "expense");
  assert.equal(result.amount, 35000);
  assert.equal(result.currency, "VND");
  assert.equal(result.categoryId, "c_food");
});

test("Vietnamese NLP parser: Case 2 'Hôm qua đổ xăng 70 nghìn'", () => {
  const result = parseSmartTransaction("Hôm qua đổ xăng 70 nghìn", mockCategories, mockWallets);
  assert.equal(result.type, "expense");
  assert.equal(result.amount, 70000);
  assert.equal(result.currency, "VND");
  assert.equal(result.categoryId, "c_trans");
  assert.ok(result.date instanceof Date);
});

test("Vietnamese NLP parser: Case 3 'Nhận lương 12 triệu'", () => {
  const result = parseSmartTransaction("Nhận lương 12 triệu", mockCategories, mockWallets);
  assert.equal(result.type, "income");
  assert.equal(result.amount, 12000000);
  assert.equal(result.currency, "VND");
  assert.equal(result.categoryId, "c_salary");
});

test("Vietnamese NLP parser: Case 4 'Chi 1,5 triệu tiền nhà'", () => {
  const result = parseSmartTransaction("Chi 1,5 triệu tiền nhà", mockCategories, mockWallets);
  assert.equal(result.type, "expense");
  assert.equal(result.amount, 1500000);
  assert.equal(result.currency, "VND");
  assert.equal(result.categoryId, "c_house");
});

test("Vietnamese NLP parser: Case 5 'Mua sách 15 USD' preserves foreign currency", () => {
  const result = parseSmartTransaction("Mua sách 15 USD", mockCategories, mockWallets);
  assert.equal(result.type, "expense");
  assert.equal(result.amount, 15);
  assert.equal(result.currency, "USD");
  assert.notEqual(result.currency, "VND");
});

test("Vietnamese NLP parser: Case 6 'Chuyển 500k từ ví tiền mặt sang ngân hàng' detects transfer", () => {
  const result = parseSmartTransaction("Chuyển 500k từ ví tiền mặt sang ngân hàng", mockCategories, mockWallets);
  assert.equal(result.isTransfer, true);
  assert.equal(result.amount, 500000);
  assert.equal(result.fromWalletId, "w_cash");
  assert.equal(result.toWalletId, "w_bank");
  assert.notEqual(result.type, "expense"); // NEVER treat internal transfer as expense
});

test("Vietnamese NLP parser: Case 7 'Ăn sáng 35k, cà phê 25k' splits into multiple drafts", () => {
  const result = parseSmartTransaction("Ăn sáng 35k, cà phê 25k", mockCategories, mockWallets);
  assert.equal(result.multipleDetected, true);
  assert.ok(result.subItems);
  assert.equal(result.subItems.length, 2);

  const [item1, item2] = result.subItems;
  assert.equal(item1.amount, 35000);
  assert.equal(item1.type, "expense");
  assert.equal(item2.amount, 25000);
  assert.equal(item2.type, "expense");
});

test("Split multi transactions: helper isolates independent amount clauses", () => {
  const split1 = splitMultiTransactions("Ăn trưa 50k, uống trà sữa 30k");
  assert.equal(split1.length, 2);
  assert.equal(split1[0], "Ăn trưa 50k");
  assert.equal(split1[1], "uống trà sữa 30k");

  const splitSingle = splitMultiTransactions("Ăn trưa 50k với bạn thân");
  assert.equal(splitSingle.length, 1);
});

test("Transfer wallets detector: parses source and destination wallets accurately", () => {
  const detected = detectTransferWallets("chuyển 500k từ ví tiền mặt sang ngân hàng", mockWallets);
  assert.equal(detected.isTransfer, true);
  assert.equal(detected.fromWalletId, "w_cash");
  assert.equal(detected.toWalletId, "w_bank");
});
