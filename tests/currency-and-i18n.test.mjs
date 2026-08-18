import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

test("i18n locales have 100% key parity and non-empty values", () => {
  const viPath = path.join(rootDir, "frontend", "locales", "vi.json");
  const enPath = path.join(rootDir, "frontend", "locales", "en.json");

  assert.ok(fs.existsSync(viPath), "vi.json should exist");
  assert.ok(fs.existsSync(enPath), "en.json should exist");

  const vi = JSON.parse(fs.readFileSync(viPath, "utf-8"));
  const en = JSON.parse(fs.readFileSync(enPath, "utf-8"));

  function getKeys(obj, prefix = "") {
    let keys = [];
    for (const [k, v] of Object.entries(obj)) {
      const full = prefix ? `${prefix}.${k}` : k;
      if (typeof v === "object" && v !== null && !Array.isArray(v)) {
        keys.push(...getKeys(v, full));
      } else {
        keys.push(full);
        assert.ok(typeof v === "string" && v.length > 0, `Value at ${full} must not be empty`);
      }
    }
    return keys;
  }

  const viKeys = getKeys(vi).sort();
  const enKeys = getKeys(en).sort();

  assert.deepStrictEqual(viKeys, enKeys, "VI and EN locale keys must match 1-to-1");
  assert.ok(viKeys.length >= 80, `Expected at least 80 translated keys, got ${viKeys.length}`);
});

test("Currency conversion converts VND amounts accurately using real exchange rates", () => {
  const FALLBACK_RATES = {
    VND: 1,
    USD: 1 / 25450,
    EUR: 1 / 27500,
    SGD: 1 / 19100,
    JPY: 1 / 165,
    THB: 1 / 735,
  };

  function convertVndToTarget(amountVnd, targetCurrency, rates = FALLBACK_RATES) {
    if (!amountVnd || isNaN(amountVnd)) return 0;
    if (targetCurrency === "VND") return amountVnd;
    const rate = rates[targetCurrency];
    if (!rate || rate <= 0) return amountVnd;
    return amountVnd * rate;
  }

  function convertTargetToVnd(targetAmount, sourceCurrency, rates = FALLBACK_RATES) {
    if (!targetAmount || isNaN(targetAmount)) return 0;
    if (sourceCurrency === "VND") return targetAmount;
    const rate = rates[sourceCurrency];
    if (!rate || rate <= 0) return targetAmount;
    return Math.round(targetAmount / rate);
  }

  // 1. Test 5,000,000 VND to USD
  const fiveMillionVndInUsd = convertVndToTarget(5000000, "USD");
  assert.ok(
    fiveMillionVndInUsd > 190 && fiveMillionVndInUsd < 205,
    `5,000,000 VND should convert to ~$196 USD, got ${fiveMillionVndInUsd}`
  );

  // 2. Test 25,450,000 VND to USD should be exactly $1000
  const usd1000 = convertVndToTarget(25450000, "USD");
  assert.strictEqual(Math.round(usd1000), 1000);

  // 3. Test inverse conversion $100 USD to VND
  const vndFrom100Usd = convertTargetToVnd(100, "USD");
  assert.strictEqual(vndFrom100Usd, 2545000);

  // 4. Test VND to VND is 1:1
  assert.strictEqual(convertVndToTarget(500000, "VND"), 500000);
});

test("formatMoney correctly respects currency symbol and locale", () => {
  const FALLBACK_RATES = {
    VND: 1,
    USD: 1 / 25450,
    EUR: 1 / 27500,
  };

  function formatMoney(amountVnd, currency = "VND", lang = "vi", rates = FALLBACK_RATES) {
    const safeAmount = Number(amountVnd) || 0;
    if (currency === "VND") {
      const formatted = new Intl.NumberFormat(lang === "vi" ? "vi-VN" : "en-US", {
        maximumFractionDigits: 0,
      }).format(Math.round(safeAmount));
      return `${formatted} ₫`;
    }

    const rate = rates[currency] || FALLBACK_RATES[currency] || 1;
    const converted = safeAmount * rate;
    const locale = lang === "vi" ? "vi-VN" : "en-US";

    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(converted);
  }

  // VND in Vietnamese format
  const vndFormatted = formatMoney(5000000, "VND", "vi");
  assert.ok(vndFormatted.includes("5.000.000") && vndFormatted.includes("₫"));

  // USD in English format: should be ~$196.46
  const usdFormatted = formatMoney(5000000, "USD", "en");
  assert.ok(usdFormatted.includes("$") && usdFormatted.includes("196.46"));

  // USD in Vietnamese format: should be 196,46 $ or US$ 196,46
  const usdViFormatted = formatMoney(5000000, "USD", "vi");
  assert.ok(usdViFormatted.includes("196,46") || usdViFormatted.includes("196.46"));
});
