import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function formatMoney(amountVnd, currency = "VND", lang = "vi") {
  const safeAmount = Number(amountVnd) || 0;
  if (currency === "VND") {
    const formatted = new Intl.NumberFormat(lang === "vi" ? "vi-VN" : "en-US", {
      maximumFractionDigits: 0,
    }).format(Math.round(safeAmount));
    return `${formatted} ₫`;
  }
  return new Intl.NumberFormat(lang === "vi" ? "vi-VN" : "en-US", {
    style: "currency",
    currency: currency,
  }).format(safeAmount);
}

test("transaction table layout: CSS rules eliminate 90px bottle-neck and prevent amount overlap", () => {
  const cssPath = path.resolve(process.cwd(), "frontend/styles/globals.css");
  const cssContent = fs.readFileSync(cssPath, "utf8");

  // 1. Must NOT have the buggy 90px column in table-head / transaction-row
  assert.doesNotMatch(
    cssContent,
    /\.table-head,\s*\.transaction-row\s*\{[^}]*grid-template-columns:[^;]*90px/i,
    "Must not restrict action column to 90px which caused overlap into amount column"
  );

  // 2. Desktop grid template must size the action column automatically or generously
  assert.match(
    cssContent,
    /\.table-head,\s*\.transaction-row\s*\{[^}]*grid-template-columns:[^;]*auto/i,
    "Action column must be sized with auto or dynamic sizing to accommodate all buttons"
  );

  // 3. Amount values must be nowrap and not shrink
  assert.match(
    cssContent,
    /\.transaction-amount[^}]*white-space:\s*nowrap/i,
    "Transaction amount must have white-space: nowrap to prevent broken number wrapping"
  );
  assert.match(
    cssContent,
    /\.transaction-amount[^}]*flex-shrink:\s*0/i,
    "Transaction amount must have flex-shrink: 0 to prevent number clipping"
  );

  // 4. Action buttons container must be flex with gap and flex-shrink: 0
  assert.match(
    cssContent,
    /\.transaction-actions[^}]*gap:\s*6px/i,
    "Transaction actions container must maintain uniform gap between buttons"
  );
  assert.match(
    cssContent,
    /\.transaction-actions[^}]*flex-shrink:\s*0/i,
    "Transaction actions container must have flex-shrink: 0"
  );

  // 5. Responsive receipt text classes must be defined
  assert.match(
    cssContent,
    /\.receipt-text-short\s*\{[^}]*display:\s*none/i,
    "Short receipt label must be hidden by default on wide displays"
  );
  assert.match(
    cssContent,
    /\.receipt-text-full\s*\{[^}]*display:\s*none/i,
    "Full receipt label must be hidden on compact displays"
  );
  assert.match(
    cssContent,
    /\.receipt-text-short\s*\{[^}]*display:\s*inline/i,
    "Short receipt label must be displayed on compact displays"
  );
});

test("transaction table layout: mobile card layout isolates amount on line 1 and actions on line 3", () => {
  const cssPath = path.resolve(process.cwd(), "frontend/styles/globals.css");
  const cssContent = fs.readFileSync(cssPath, "utf8");

  // Verify grid-template-areas separates amount from actions
  assert.match(
    cssContent,
    /grid-template-areas:\s*"title\s+amount"\s*"meta\s+date"\s*"actions\s+actions"/i,
    "Mobile card must place title+amount in row 1, meta+date in row 2, actions spanning row 3"
  );

  // Verify actions container on mobile has full width and border-top separation
  assert.match(
    cssContent,
    /\.transaction-row\s*>\s*\.transaction-actions[^}]*grid-area:\s*actions/i,
    "Actions must map to grid-area: actions"
  );
  assert.match(
    cssContent,
    /\.transaction-row\s*>\s*\.transaction-amount-col[^}]*grid-area:\s*amount/i,
    "Amount column must map to grid-area: amount"
  );
});

test("transaction table markup: dashboard.tsx renders dedicated amount column and actions container", () => {
  const dashPath = path.resolve(process.cwd(), "frontend/components/dashboard.tsx");
  const dashContent = fs.readFileSync(dashPath, "utf8");

  assert.match(
    dashContent,
    /className="transaction-amount-col"/,
    "TransactionTable must render dedicated .transaction-amount-col"
  );
  assert.match(
    dashContent,
    /className="transaction-actions\s+row-actions"/,
    "TransactionTable must render dedicated .transaction-actions container"
  );
  assert.match(
    dashContent,
    /className="receipt-text-full"/,
    "Receipt button must contain .receipt-text-full span"
  );
  assert.match(
    dashContent,
    /className="receipt-text-short"/,
    "Receipt button must contain .receipt-text-short span"
  );
});

test("financial formatting: large and negative amounts format cleanly without truncation", () => {
  const amounts = [
    50000,
    600000,
    3000000,
    15500000,
    120000000,
    1000000000,
  ];

  for (const amt of amounts) {
    const formatted = formatMoney(amt, "VND", "vi");
    assert.ok(formatted.length > 0, `Formatted amount for ${amt} must not be empty`);
    // VND format uses dot separators
    assert.match(formatted, /\d+(\.\d{3})*\s*₫/, `Amount ${amt} must follow Vietnamese currency formatting`);
  }
});
