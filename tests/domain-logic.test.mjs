import assert from "node:assert/strict";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";

import { advanceRecurring, periodBounds } from "../frontend/utils/finance.utils.ts";
import {
  calculateAvailableBalances,
  calculateReservedByWallet,
  calculateTransactionTotals,
  calculateWalletBalances,
} from "../frontend/utils/finance-calculations.ts";
import { buildXlsxFile } from "../frontend/services/xlsx-writer.ts";
import { cleanMoneyAmount, normalizeIsoDate } from "../backend/src/services/ai-output-validation.service.ts";
import { extractBearerToken } from "../backend/src/services/supabase-auth.service.ts";
import { readJsonBody } from "../backend/src/services/http-input.service.ts";
import { normalizeClientErrorReport } from "../backend/src/services/client-error.service.ts";
import { parseSmartTransaction, parseVietnameseAmount } from "../frontend/utils/smart-parser.ts";

const categories = [
  { id: "food", user_id: "u", name: "Ăn uống", kind: "expense", parent_id: null, icon: "", color: "", is_default: true },
  { id: "other-income", user_id: "u", name: "Thu khác", kind: "income", parent_id: null, icon: "", color: "", is_default: true },
];
const wallets = [
  { id: "special", user_id: "u", name: "Ví (chính)", type: "cash", balance: 0, reserved_amount: 0, currency: "VND", color: "", icon: "" },
];

test("Vietnamese amount parser handles common large-number expressions", () => {
  assert.equal(parseVietnameseAmount("1 triệu rưỡi").amount, 1_500_000);
  assert.equal(parseVietnameseAmount("2,5 tỷ").amount, 2_500_000_000);
  assert.equal(parseVietnameseAmount("3 củ").amount, 3_000_000);
  assert.equal(parseVietnameseAmount("45k").amount, 45_000);
});

test("smart parser does not invent a transaction type and escapes wallet names", () => {
  const unknown = parseSmartTransaction("50000", categories, wallets);
  assert.equal(unknown.type, null);

  const refund = parseSmartTransaction("được bạn trả lại 50k vào Ví (chính)", categories, wallets);
  assert.equal(refund.type, "income");
  assert.equal(refund.walletId, "special");
});

test("smart parser rejects impossible calendar dates", () => {
  const parsed = parseSmartTransaction("ăn sáng 50k ngày 31/2/2026", categories, wallets);
  assert.equal(parsed.date, null);
});

test("recurring dates clamp month and leap-year boundaries", () => {
  assert.equal(advanceRecurring("2024-01-31T08:00:00.000Z", "monthly"), "2024-02-29T08:00:00.000Z");
  assert.equal(advanceRecurring("2024-02-29T08:00:00.000Z", "yearly"), "2025-02-28T08:00:00.000Z");
  assert.equal(advanceRecurring("2026-01-31T08:00:00.000Z", "monthly", 1, "next_month"), "2026-03-01T08:00:00.000Z");
});

test("period boundaries remain local and exclusive across month and year changes", () => {
  const reference = new Date(2026, 11, 31, 23, 59, 59);
  const day = periodBounds("day", 0, reference);
  const month = periodBounds("month", 0, reference);
  const year = periodBounds("year", 0, reference);

  assert.deepEqual(
    [day.start.getFullYear(), day.start.getMonth(), day.start.getDate()],
    [2026, 11, 31],
  );
  assert.deepEqual(
    [day.end.getFullYear(), day.end.getMonth(), day.end.getDate()],
    [2027, 0, 1],
  );
  assert.deepEqual(
    [month.end.getFullYear(), month.end.getMonth(), month.end.getDate()],
    [2027, 0, 1],
  );
  assert.deepEqual(
    [year.end.getFullYear(), year.end.getMonth(), year.end.getDate()],
    [2027, 0, 1],
  );
});

test("financial calculations include budget-backed expenses and reservations once", () => {
  const walletRows = [
    { id: "w1", balance: 1_000_000 },
    { id: "w2", balance: 200_000 },
  ];
  const budgetRows = [
    { id: "b1", source_wallet_id: "w1", remaining_amount: 300_000, status: "active" },
  ];
  const goalRows = [
    { source_wallet_id: "w1", reserved_in_wallet: 100_000 },
  ];
  const transactionRows = [
    { wallet_id: "w1", budget_id: null, payment_source_type: "wallet", type: "income", amount: 200_000, occurred_at: "2026-09-01T00:00:00.000Z" },
    { wallet_id: "w1", budget_id: null, payment_source_type: "wallet", type: "expense", amount: 100_000, occurred_at: "2026-09-15T12:00:00.000Z" },
    { wallet_id: null, budget_id: "b1", payment_source_type: "budget", type: "expense", amount: 50_000, occurred_at: "2026-09-30T23:59:59.000Z" },
  ];
  const transferRows = [
    { from_wallet_id: "w1", to_wallet_id: "w2", amount: 100_000 },
  ];

  const balances = calculateWalletBalances(
    walletRows,
    transactionRows,
    transferRows,
    budgetRows,
  );
  const reserved = calculateReservedByWallet(walletRows, budgetRows, goalRows);
  const available = calculateAvailableBalances(balances, reserved);
  const totals = calculateTransactionTotals(
    transactionRows,
    new Date("2026-09-01T00:00:00.000Z"),
    new Date("2026-10-01T00:00:00.000Z"),
  );

  assert.equal(balances.get("w1"), 950_000);
  assert.equal(balances.get("w2"), 300_000);
  assert.equal(reserved.get("w1"), 400_000);
  assert.equal(available.get("w1"), 550_000);
  assert.deepEqual(totals, { income: 200_000, expense: 150_000 });
});

test("browser auth remains explicitly session-only", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../config/supabase.ts", import.meta.url), "utf8"));
  assert.match(source, /storage:\s*typeof window[^\n]+window\.sessionStorage/);
  assert.doesNotMatch(source, /storage:\s*(?:window\.)?localStorage/);
});

test("XLSX writer produces a valid OOXML archive and escapes cell content", () => {
  const archive = unzipSync(buildXlsxFile([{ name: "Thu/chi", rows: [{ Name: "A&B <test>", Amount: 50_000 }] }]));
  assert.ok(archive["[Content_Types].xml"]);
  assert.ok(archive["xl/workbook.xml"]);
  const sheet = strFromU8(archive["xl/worksheets/sheet1.xml"]);
  assert.match(sheet, /A&amp;B &lt;test&gt;/);
  assert.match(sheet, /<v>50000<\/v>/);
});

test("AI output validators reject normalized dates and unsafe amounts", () => {
  assert.equal(normalizeIsoDate("2026-02-29"), null);
  assert.equal(normalizeIsoDate("2024-02-29"), "2024-02-29");
  assert.equal(cleanMoneyAmount("1.250.000", false), 1_250_000);
  assert.equal(cleanMoneyAmount("2,5", false), 3);
  assert.equal(cleanMoneyAmount(Number.POSITIVE_INFINITY), null);
});

test("HTTP helpers enforce exact bearer syntax and JSON body limits", async () => {
  assert.equal(extractBearerToken(new Request("https://example.test", { headers: { authorization: "Bearer token" } })), "token");
  assert.throws(() => extractBearerToken(new Request("https://example.test", { headers: { authorization: "Bearer token extra" } })));
  await assert.rejects(
    readJsonBody(new Request("https://example.test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ long: "abcdef" }) }), 8),
    (error) => error?.status === 413,
  );
});

test("client error reports cannot inject arbitrary or sensitive log messages", () => {
  assert.deepEqual(
    normalizeClientErrorReport({
      name: "TypeError",
      digest: "safe_digest-123",
      message: "token=should-not-be-logged",
    }),
    { name: "TypeError", digest: "safe_digest-123" },
  );
  assert.deepEqual(
    normalizeClientErrorReport({
      name: "Bad\nforged log",
      digest: "not allowed!",
    }),
    { name: "ClientError" },
  );
});
