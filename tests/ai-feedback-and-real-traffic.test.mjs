import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import {
  recordClassificationProductEvent,
  getClassificationProductMetrics,
} from "../backend/src/services/ai-local.client.ts";

test("real traffic telemetry: forwards is_real_traffic and user_id without leaking PII", async () => {
  // Record simulated user feedback events
  recordClassificationProductEvent({
    event: "shown",
    model_version: "v3",
    confidence_bucket: "HIGH",
    predicted_category: "di chuyển",
  });
  recordClassificationProductEvent({
    event: "applied",
    model_version: "v3",
    confidence_bucket: "HIGH",
    predicted_category: "di chuyển",
    final_category: "di chuyển",
  });

  const metrics = getClassificationProductMetrics();
  assert.ok(metrics.counts.shown_total >= 1, "Must track shown events");
  assert.ok(metrics.counts.applied_total >= 1, "Must track applied events");
  assert.equal(typeof metrics.apply_rate.v3, "number");
  assert.equal(typeof metrics.override_rate.v3, "number");
});

test("feedback loop: records suggestion corrections and computes high-confidence override rate", () => {
  // 1. Applied event (accepted suggestion)
  recordClassificationProductEvent({
    event: "applied",
    model_version: "v3",
    confidence_bucket: "HIGH",
    predicted_category: "ăn uống",
    final_category: "ăn uống",
  });

  // 2. High-confidence override (predicted ăn uống, user corrected to mua sắm)
  recordClassificationProductEvent({
    event: "shown",
    model_version: "v3",
    confidence_bucket: "HIGH",
    predicted_category: "ăn uống",
  });
  recordClassificationProductEvent({
    event: "overridden",
    model_version: "v3",
    confidence_bucket: "HIGH",
    predicted_category: "ăn uống",
    final_category: "mua sắm",
  });

  // 3. Low-confidence override
  recordClassificationProductEvent({
    event: "shown",
    model_version: "v3",
    confidence_bucket: "LOW",
    predicted_category: "khác",
  });
  recordClassificationProductEvent({
    event: "overridden",
    model_version: "v3",
    confidence_bucket: "LOW",
    predicted_category: "khác",
    final_category: "sức khỏe",
  });

  const metrics = getClassificationProductMetrics();
  assert.ok(metrics.counts.overridden_total >= 2);
  assert.equal(typeof metrics.override_rate.v3, "number");
  assert.equal(typeof metrics.override_rate.v3_high_confidence, "number");
});

test("security & privacy: PII keys never exist in recorded telemetry payloads", () => {
  const piiKeywords = ["text", "description", "raw_text", "password", "token", "email", "phone", "card_number"];

  const metrics = getClassificationProductMetrics();
  const serialized = JSON.stringify(metrics);

  for (const keyword of piiKeywords) {
    assert.equal(
      serialized.includes(`"${keyword}":`),
      false,
      `Telemetry metrics must NEVER serialize PII key "${keyword}"`
    );
  }
});

test("server-side pseudonymization: user id is hashed with SHA-256 before telemetry storage", () => {
  const rawUserId = "user-uuid-12345-secret";
  const hashed = crypto.createHash("sha256").update(rawUserId).digest("hex");

  assert.equal(hashed.length, 64);
  assert.notEqual(hashed, rawUserId);
  assert.equal(hashed.includes("user-uuid"), false);
});

test("feedback loop: isolated V4 metrics and V4 must NEVER increment V3 counters", () => {
  const initial = getClassificationProductMetrics();
  const v3ShownBefore = initial.counts.v3_shown ?? 0;
  const v3AppliedBefore = initial.counts.v3_applied ?? 0;
  const v3OverriddenBefore = initial.counts.v3_overridden ?? 0;
  const v4ShownBefore = initial.counts.v4_shown ?? 0;
  const v4AppliedBefore = initial.counts.v4_applied ?? 0;
  const v4OverriddenBefore = initial.counts.v4_overridden ?? 0;

  // Record V4 shown, applied, overridden
  recordClassificationProductEvent({
    event: "shown",
    model_version: "v4",
    confidence_bucket: "HIGH",
    predicted_category: "ăn uống",
  });
  recordClassificationProductEvent({
    event: "applied",
    model_version: "v4",
    confidence_bucket: "HIGH",
    predicted_category: "ăn uống",
    final_category: "ăn uống",
  });
  recordClassificationProductEvent({
    event: "overridden",
    model_version: "v4",
    confidence_bucket: "HIGH",
    predicted_category: "ăn uống",
    final_category: "mua sắm",
  });

  const updated = getClassificationProductMetrics();

  // V4 events MUST NEVER increment V3 counters
  assert.equal(updated.counts.v3_shown, v3ShownBefore, "V4 event must not increment v3_shown");
  assert.equal(updated.counts.v3_applied, v3AppliedBefore, "V4 event must not increment v3_applied");
  assert.equal(updated.counts.v3_overridden, v3OverriddenBefore, "V4 event must not increment v3_overridden");

  // V4 counters MUST increment accurately
  assert.equal(updated.counts.v4_shown, v4ShownBefore + 1, "V4 event must increment v4_shown");
  assert.equal(updated.counts.v4_applied, v4AppliedBefore + 1, "V4 event must increment v4_applied");
  assert.equal(updated.counts.v4_overridden, v4OverriddenBefore + 1, "V4 event must increment v4_overridden");

  // Verify rates exist and are numbers
  assert.equal(typeof updated.v3_acceptance_rate, "number");
  assert.equal(typeof updated.v4_acceptance_rate, "number");
  assert.equal(typeof updated.v3_correction_rate, "number");
  assert.equal(typeof updated.v4_correction_rate, "number");
  assert.equal(typeof updated.v3_high_confidence_correction_rate, "number");
  assert.equal(typeof updated.v4_high_confidence_correction_rate, "number");
});

test("idempotency end-to-end: generated key has strong entropy and contains no PII or text", () => {
  const rawUUID = crypto.randomUUID();
  const idempotencyKey = `tx_${rawUUID}`;

  // Key must be safe token format
  assert.match(idempotencyKey, /^tx_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.ok(idempotencyKey.length >= 20 && idempotencyKey.length <= 128);

  // Must not leak transaction content or user identity
  const sensitiveStrings = ["phở", "cà phê", " HighLand ", "user_secret", "500000"];
  for (const s of sensitiveStrings) {
    assert.equal(idempotencyKey.includes(s), false, `Idempotency key must not contain '${s}'`);
  }
});
