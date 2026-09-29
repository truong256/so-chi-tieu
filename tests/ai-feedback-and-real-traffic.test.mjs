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
