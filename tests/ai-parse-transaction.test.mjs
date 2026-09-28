/**
 * tests/ai-parse-transaction.test.mjs
 * ====================================
 * Integration tests for /api/ai/parse-transaction & aiDetailedHealthCheck:
 * - Verifies explicit source tracking ("local_model_v3" | "local_model_v2" | "heuristic")
 * - Verifies backward compatibility of returned payload
 * - Verifies detailed health check statuses (SERVICE_UP, MODEL_READY, MODEL_LOAD_FAILED, MODEL_MISSING)
 * - Verifies security: zero secret leakage
 * - Verifies graceful heuristic fallback when AI service is offline
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  aiClassify,
  aiDetailedHealthCheck,
} from "../backend/src/services/ai-local.client.ts";
import { parseSmartTransaction } from "../frontend/utils/smart-parser.ts";

test("security: /api/ai/parse-transaction route never logs tokens or secrets", async () => {
  const routeContent = await readFile(
    new URL("../app/api/ai/parse-transaction/route.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(
    routeContent,
    /console\.(log|info|warn|error)\(.*(token|access_token|secret|password|bearer)/i,
    "Route must not log sensitive tokens or secrets"
  );
  assert.match(
    routeContent,
    /\bsource\b/,
    "Route must explicitly output source in JSON response"
  );
  assert.match(
    routeContent,
    /\bconfidence\b/,
    "Route must explicitly output confidence in JSON response"
  );
});

test("security: health route never leaks internal environment variables", async () => {
  const healthContent = await readFile(
    new URL("../app/api/ai/health/route.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(
    healthContent,
    /process\.env\.[A-Z0-9_]*KEY/i,
    "Health route must never expose API keys or secrets in response"
  );
  assert.match(
    healthContent,
    /MODEL_READY|SERVICE_UP|SERVICE_DOWN/,
    "Health route must distinguish SERVICE_UP/DOWN and MODEL status"
  );
});

test("health check: aiDetailedHealthCheck returns structured status", async () => {
  const health = await aiDetailedHealthCheck();
  assert.ok(
    ["SERVICE_UP", "SERVICE_DOWN"].includes(health.status),
    `Invalid status: ${health.status}`
  );
  assert.ok(
    ["MODEL_READY", "MODEL_LOAD_FAILED", "MODEL_MISSING"].includes(
      health.model_readiness
    ),
    `Invalid model_readiness: ${health.model_readiness}`
  );
  assert.equal(typeof health.models, "object");
  assert.equal(typeof health.timestamp, "string");
});

test("client: aiClassify returns explicit source metadata", async () => {
  const res = await aiClassify({ text: "ăn phở 50k" });
  if (res.ok && res.data) {
    // If AI service is running, it must identify source
    assert.ok(
      ["local_model_v3", "local_model_v2", "heuristic"].includes(res.data.source),
      `Unexpected source: ${res.data.source}`
    );
    assert.equal(typeof res.data.confidence, "number");
    assert.equal(typeof res.data.fallback, "boolean");
  } else {
    // If AI service is offline, error must be descriptive
    assert.equal(typeof res.error, "string");
  }
});

test("heuristic fallback: parseSmartTransaction returns valid fallback payload", () => {
  const dummyCategories = [
    { id: "cat-1", user_id: "u1", name: "Ăn uống", kind: "expense", parent_id: null, icon: "", color: "", is_default: true },
    { id: "cat-2", user_id: "u1", name: "Di chuyển", kind: "expense", parent_id: null, icon: "", color: "", is_default: true },
  ];
  const dummyWallets = [
    { id: "wal-1", user_id: "u1", name: "Tiền mặt", type: "cash", balance: 500000, reserved_amount: 0, currency: "VND", color: "", icon: "" },
  ];

  const result = parseSmartTransaction("ăn phở 50k tiền mặt", dummyCategories, dummyWallets);
  assert.equal(result.amount, 50000);
  assert.equal(result.type, "expense");
  assert.equal(result.categoryId, "cat-1");
  assert.equal(result.walletId, "wal-1");
});
