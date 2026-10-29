/**
 * tests/savings-reasoning.test.mjs
 * ================================
 * Unit test suite verifying deterministic savings reasoning and conversational memory.
 * Tests all critical cases from user requirements.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { parseSavingsReasoningQuery } from "../backend/src/services/savings-calculator.service.ts";
import { routeUserIntent } from "../backend/src/services/ai-router.service.ts";

test("Savings: Test 1 - Total savings target with daily rate", () => {
  const query = "Tôi muốn tiết kiệm 5 triệu trong 3 tháng, mỗi ngày bao nhiêu?";
  const res = parseSavingsReasoningQuery(query);
  assert.ok(res, "Should be handled");
  assert.equal(res.intent, "TOTAL_SAVINGS_TARGET");
  assert.equal(res.targetAmount, 5000000);
  assert.equal(res.durationPeriods, 3);
  assert.equal(res.effectiveDays, 90);
  assert.equal(res.dailySaving, 55556);
  assert.ok(res.explanationVi.includes("55.556 VND/ngày"));
  assert.ok(!res.explanationVi.includes("15.000.000"));
});

test("Savings: Test 2 - Recurring monthly savings amount", () => {
  const query = "Tôi tiết kiệm 5 triệu mỗi tháng trong 3 tháng.";
  const res = parseSavingsReasoningQuery(query);
  assert.ok(res, "Should be handled");
  assert.equal(res.intent, "RECURRING_SAVINGS_AMOUNT");
  assert.equal(res.targetAmount, 15000000);
  assert.equal(res.totalSavedAtEnd, 15000000);
  assert.ok(res.explanationVi.includes("15.000.000 VND"));
});

test("Savings: Test 3 - Explicit total target clarification", () => {
  const query = "Tôi muốn tiết kiệm tổng cộng 5 triệu, không phải mỗi tháng.";
  const res = parseSavingsReasoningQuery(query);
  assert.ok(res, "Should be handled");
  assert.equal(res.intent, "TOTAL_SAVINGS_TARGET");
  assert.equal(res.targetAmount, 5000000);
  assert.equal(res.totalSavedAtEnd, 5000000);
  assert.ok(res.explanationVi.includes("5.000.000 VND"));
  assert.ok(!res.explanationVi.includes("15.000.000"));
});

test("Savings: Test 4 - Multi-turn follow-up after total target", () => {
  const history = [
    { role: "user", parts: [{ text: "Tôi muốn tiết kiệm tổng cộng 5 triệu, không phải mỗi tháng." }] },
    { role: "model", parts: [{ text: "Đã ghi nhận mục tiêu 5.000.000 VND." }] }
  ];
  const query = "Mỗi ngày bao nhiêu?";
  const res = parseSavingsReasoningQuery(query, history);
  assert.ok(res, "Should be handled");
  assert.equal(res.intent, "FOLLOW_UP_SAVINGS");
  assert.equal(res.targetAmount, 5000000);
  assert.equal(res.dailySaving, 55556);
  assert.ok(res.explanationVi.includes("55.556 VND/ngày"));
});

test("Savings: Test 5 - Target with days duration", () => {
  const query = "Tôi muốn có 6 triệu sau 60 ngày.";
  const res = parseSavingsReasoningQuery(query);
  assert.ok(res, "Should be handled");
  assert.equal(res.intent, "TOTAL_SAVINGS_TARGET");
  assert.equal(res.targetAmount, 6000000);
  assert.equal(res.effectiveDays, 60);
  assert.equal(res.dailySaving, 100000);
  assert.ok(res.explanationVi.includes("100.000 VND/ngày"));
});

test("Savings: Test 6 - Goal with already saved money", () => {
  const query = "Tôi muốn có 10 triệu, đã có 4 triệu, còn 100 ngày.";
  const res = parseSavingsReasoningQuery(query);
  assert.ok(res, "Should be handled");
  assert.equal(res.intent, "REMAINING_SAVINGS");
  assert.equal(res.targetAmount, 10000000);
  assert.equal(res.alreadySaved, 4000000);
  assert.equal(res.remainingAmount, 6000000);
  assert.equal(res.effectiveDays, 100);
  assert.equal(res.dailySaving, 60000);
  assert.ok(res.explanationVi.includes("60.000 VND/ngày"));
});

test("Savings: Test 7 - Daily recurring savings calculation", () => {
  const query = "Mỗi ngày tiết kiệm 20k trong 30 ngày.";
  const res = parseSavingsReasoningQuery(query);
  assert.ok(res, "Should be handled");
  assert.equal(res.intent, "RECURRING_SAVINGS_AMOUNT");
  assert.equal(res.totalSavedAtEnd, 600000);
  assert.ok(res.explanationVi.includes("600.000 VND"));
});

test("Savings: Test 8 - Monthly recurring cross-unit to year", () => {
  const query = "Mỗi tháng tiết kiệm 500k trong 12 tháng.";
  const res = parseSavingsReasoningQuery(query);
  assert.ok(res, "Should be handled");
  assert.equal(res.intent, "RECURRING_SAVINGS_AMOUNT");
  assert.equal(res.totalSavedAtEnd, 6000000);
  assert.ok(res.explanationVi.includes("6.000.000 VND"));
});

test("Savings: Test 9 - Additional savings requirement", () => {
  const query = "Tôi cần thêm 2 triệu trong 20 ngày.";
  const res = parseSavingsReasoningQuery(query);
  assert.ok(res, "Should be handled");
  assert.equal(res.intent, "REMAINING_SAVINGS");
  assert.equal(res.remainingAmount, 2000000);
  assert.equal(res.effectiveDays, 20);
  assert.equal(res.dailySaving, 100000);
  assert.ok(res.explanationVi.includes("100.000 VND/ngày"));
});

test("Savings: Test 10 - Ambiguous query asks for details", () => {
  const query = "Tôi muốn tiết kiệm tiền trong vài tháng.";
  const res = parseSavingsReasoningQuery(query);
  assert.ok(res, "Should be handled");
  assert.equal(res.intent, "AMBIGUOUS_SAVINGS");
  assert.equal(res.isAmbiguous, true);
  assert.ok(res.explanationVi.includes("Số tiền mục tiêu"));
  assert.ok(res.explanationVi.includes("Thời hạn cụ thể"));
});

test("Savings: Error Correction - Corrects previous AI miscalculation transparently", () => {
  const historyBad = [
    { role: "user", parts: [{ text: "Tôi muốn tiết kiệm 5 triệu trong 3 tháng." }] },
    { role: "model", parts: [{ text: "Nếu tiết kiệm 5.000.000 VND mỗi tháng, sau 3 tháng bạn có 15.000.000 VND." }] }
  ];
  const query = "Mỗi ngày tôi cần dành ra bao nhiêu?";
  const res = parseSavingsReasoningQuery(query, historyBad);
  assert.ok(res, "Should be handled");
  assert.equal(res.dailySaving, 55556);
  assert.equal(res.aiMiscalculationCorrected, true);
  assert.ok(res.explanationVi.includes("Xin lỗi bạn"));
  assert.ok(res.explanationVi.includes("hiểu nhầm"));
  assert.ok(res.explanationVi.includes("55.556 VND/ngày"));
});

test("Savings: Changing Target - Target updates properly and discards old target", () => {
  const history = [
    { role: "user", parts: [{ text: "Tôi muốn tiết kiệm 5 triệu trong 3 tháng." }] },
    { role: "model", parts: [{ text: "Mục tiêu 5 triệu trong 3 tháng." }] },
    { role: "user", parts: [{ text: "Tôi muốn đổi thành 10 triệu trong 6 tháng." }] },
    { role: "model", parts: [{ text: "Đã cập nhật mục tiêu sang 10 triệu trong 6 tháng." }] }
  ];
  const query = "Mỗi ngày bao nhiêu?";
  const res = parseSavingsReasoningQuery(query, history);
  assert.ok(res, "Should be handled");
  assert.equal(res.targetAmount, 10000000);
  assert.equal(res.durationPeriods, 6);
  assert.equal(res.effectiveDays, 180);
  assert.equal(res.dailySaving, 55556);
  assert.ok(res.explanationVi.includes("10.000.000 VND"));
});

test("Savings: RouteUserIntent integration", () => {
  const query = "Tôi muốn tiết kiệm 5 triệu đồng trong 3 tháng thì mỗi ngày cần dành ra bao nhiêu?";
  const routing = routeUserIntent(query, []);
  assert.equal(routing.primaryIntent, "SIMPLE_CALCULATION");
  assert.ok(routing.simpleCalculation);
  assert.ok(routing.simpleCalculation.explanationVi.includes("55.556 VND/ngày"));
});

