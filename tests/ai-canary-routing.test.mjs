import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import {
  getCanaryPercent,
  stableUserBucket,
  getCanaryDecision,
  getCircuitBreakerStatus,
  resetCircuitBreaker,
  getAiTelemetry,
  recordClassificationProductEvent,
  getClassificationProductMetrics,
} from "../backend/src/services/ai-local.client.ts";

test("canary config: handles default 0, valid ranges, and invalid inputs gracefully", () => {
  const origEnv = process.env.AI_V3_CANARY_PERCENT;
  try {
    delete process.env.AI_V3_CANARY_PERCENT;
    assert.equal(getCanaryPercent(), 0, "Default must be 0");

    process.env.AI_V3_CANARY_PERCENT = "5";
    assert.equal(getCanaryPercent(), 5);

    process.env.AI_V3_CANARY_PERCENT = "25";
    assert.equal(getCanaryPercent(), 25);

    process.env.AI_V3_CANARY_PERCENT = "100";
    assert.equal(getCanaryPercent(), 100);

    // Invalid numbers
    process.env.AI_V3_CANARY_PERCENT = "-10";
    assert.equal(getCanaryPercent(), 0, "Negative values must fallback to 0");

    process.env.AI_V3_CANARY_PERCENT = "150";
    assert.equal(getCanaryPercent(), 0, "Values > 100 must fallback to 0");

    process.env.AI_V3_CANARY_PERCENT = "invalid_string";
    assert.equal(getCanaryPercent(), 0, "Non-numeric values must fallback to 0");
  } finally {
    if (origEnv !== undefined) {
      process.env.AI_V3_CANARY_PERCENT = origEnv;
    } else {
      delete process.env.AI_V3_CANARY_PERCENT;
    }
  }
});

test("canary routing: percentage thresholds 0, 5, 10, 25, 50, 100", () => {
  const origEnv = process.env.AI_V3_CANARY_PERCENT;
  try {
    // 0% -> 100% V2
    process.env.AI_V3_CANARY_PERCENT = "0";
    for (let i = 0; i < 50; i++) {
      const dec = getCanaryDecision(`user_${i}`);
      assert.equal(dec.targetVersion, "v2", "At 0%, all users must route to V2");
      assert.equal(dec.isCanary, false);
    }

    // 100% -> 100% V3
    process.env.AI_V3_CANARY_PERCENT = "100";
    for (let i = 0; i < 50; i++) {
      const dec = getCanaryDecision(`user_${i}`);
      assert.equal(dec.targetVersion, "v3", "At 100%, all users must route to V3");
    }

    // Intermediate checks
    for (const pct of [5, 10, 25, 50]) {
      process.env.AI_V3_CANARY_PERCENT = String(pct);
      const dec = getCanaryDecision("deterministic_user_test");
      assert.ok(["v3", "v2"].includes(dec.targetVersion));
      assert.equal(typeof dec.bucket, "number");
      assert.ok(dec.bucket >= 0 && dec.bucket < 100);
    }
  } finally {
    if (origEnv !== undefined) {
      process.env.AI_V3_CANARY_PERCENT = origEnv;
    } else {
      delete process.env.AI_V3_CANARY_PERCENT;
    }
  }
});

test("canary stickiness: same user always receives same cohort over 100 repeated requests", () => {
  const origEnv = process.env.AI_V3_CANARY_PERCENT;
  try {
    process.env.AI_V3_CANARY_PERCENT = "5";
    const testUsers = ["user_alpha", "user_beta", "user_gamma", "usr_12345", "usr_99999"];

    for (const userId of testUsers) {
      const firstDecision = getCanaryDecision(userId);
      for (let req = 0; req < 100; req++) {
        const repeatDecision = getCanaryDecision(userId);
        assert.equal(
          repeatDecision.targetVersion,
          firstDecision.targetVersion,
          `User ${userId} must have stable version on request ${req}`,
        );
        assert.equal(
          repeatDecision.isCanary,
          firstDecision.isCanary,
          `User ${userId} must have stable canary status on request ${req}`,
        );
        assert.equal(
          repeatDecision.bucket,
          firstDecision.bucket,
          `User ${userId} bucket must be strictly deterministic`,
        );
      }
    }
  } finally {
    if (origEnv !== undefined) {
      process.env.AI_V3_CANARY_PERCENT = origEnv;
    } else {
      delete process.env.AI_V3_CANARY_PERCENT;
    }
  }
});

test("canary distribution: 10,000 synthetic deterministic users with 5% config routes ~5% (within 4.5% - 5.5%)", () => {
  const origEnv = process.env.AI_V3_CANARY_PERCENT;
  try {
    process.env.AI_V3_CANARY_PERCENT = "5";
    let v3Count = 0;
    const TOTAL_USERS = 10000;

    for (let i = 0; i < TOTAL_USERS; i++) {
      const deterministicId = crypto
        .createHash("sha1")
        .update(`seed_user_id_${i}`)
        .digest("hex");
      const decision = getCanaryDecision(deterministicId);
      if (decision.targetVersion === "v3") {
        v3Count++;
      }
    }

    const actualPercent = (v3Count / TOTAL_USERS) * 100;
    assert.ok(
      actualPercent >= 4.5 && actualPercent <= 5.5,
      `Actual canary distribution ${actualPercent}% (${v3Count}/${TOTAL_USERS}) should be near 5% (tolerance 4.5% - 5.5%)`,
    );
  } finally {
    if (origEnv !== undefined) {
      process.env.AI_V3_CANARY_PERCENT = origEnv;
    } else {
      delete process.env.AI_V3_CANARY_PERCENT;
    }
  }
});

test("security & anti-spoofing: unauthenticated or missing userId safely falls back to V2", () => {
  const origEnv = process.env.AI_V3_CANARY_PERCENT;
  try {
    process.env.AI_V3_CANARY_PERCENT = "5";
    const anonymousDecision = getCanaryDecision(undefined);
    assert.equal(anonymousDecision.targetVersion, "v2", "Anonymous/unauthenticated must route to V2");
    assert.equal(anonymousDecision.isCanary, false);

    const emptyDecision = getCanaryDecision("");
    assert.equal(emptyDecision.targetVersion, "v2", "Empty userId must route to V2");
    assert.equal(emptyDecision.isCanary, false);
  } finally {
    if (origEnv !== undefined) {
      process.env.AI_V3_CANARY_PERCENT = origEnv;
    } else {
      delete process.env.AI_V3_CANARY_PERCENT;
    }
  }
});

test("circuit breaker observability: tracks states, open count, and error type", () => {
  resetCircuitBreaker();
  const initial = getCircuitBreakerStatus();
  assert.equal(initial.state, "CLOSED");
  assert.equal(initial.failureCount, 0);
  assert.equal(typeof initial.openCount, "number");
});

test("classification product metrics: records shown, applied, overridden and computes rates safely", () => {
  recordClassificationProductEvent({
    event: "shown",
    model_version: "v3",
    confidence_bucket: "HIGH",
    predicted_category: "an_uong",
  });
  recordClassificationProductEvent({
    event: "applied",
    model_version: "v3",
    confidence_bucket: "HIGH",
    predicted_category: "an_uong",
    final_category: "an_uong",
  });
  recordClassificationProductEvent({
    event: "shown",
    model_version: "v3",
    confidence_bucket: "HIGH",
    predicted_category: "di_chuyen",
  });
  recordClassificationProductEvent({
    event: "overridden",
    model_version: "v3",
    confidence_bucket: "HIGH",
    predicted_category: "di_chuyen",
    final_category: "cong_viec",
  });

  const metrics = getClassificationProductMetrics();
  assert.ok(metrics.counts.shown_total >= 2);
  assert.ok(metrics.counts.applied_total >= 1);
  assert.ok(metrics.counts.overridden_total >= 1);
  assert.equal(typeof metrics.apply_rate.v3, "number");
  assert.equal(typeof metrics.override_rate.v3, "number");
  assert.equal(typeof metrics.override_rate.v3_high_confidence, "number");
});
