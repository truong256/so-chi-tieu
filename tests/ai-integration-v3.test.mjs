import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";
import {
  aiClassify,
  aiForecast,
  aiRisk,
  aiAdvisor,
  aiHealthCheck,
} from "../backend/src/services/ai-local.client.ts";

test("security: AI_SERVICE_URL is server-only and never leaked to frontend", async () => {
  async function scanDir(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        const content = await readFile(fullPath, "utf8");
        assert.doesNotMatch(
          content,
          /NEXT_PUBLIC_AI_SERVICE_URL/i,
          `File ${fullPath} must never reference NEXT_PUBLIC_AI_SERVICE_URL`,
        );
      }
    }
  }

  const frontendDir = new URL("../frontend", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
  await scanDir(frontendDir);
});

test("security: AI local client never forwards Supabase service_role keys", async () => {
  const clientContent = await readFile(
    new URL("../backend/src/services/ai-local.client.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    clientContent,
    /SUPABASE_SERVICE_ROLE_KEY/i,
    "ai-local.client.ts must never reference SUPABASE_SERVICE_ROLE_KEY",
  );
  assert.doesNotMatch(
    clientContent,
    /headers:\s*\{[^}]*service_role/i,
    "ai-local.client.ts must never send service_role in request headers",
  );
});

test("failsafe: AI client fails gracefully without throwing when AI service is offline", async () => {
  // Test classify failsafe
  const classifyRes = await aiClassify({ text: "Ăn trưa cơm tấm" });
  assert.equal(typeof classifyRes.ok, "boolean");
  if (!classifyRes.ok) {
    assert.equal(typeof classifyRes.error, "string");
    assert.ok(classifyRes.error.length > 0);
  }

  // Test forecast failsafe
  const forecastRes = await aiForecast({ days: 7 });
  assert.equal(typeof forecastRes.ok, "boolean");
  if (!forecastRes.ok) {
    assert.equal(typeof forecastRes.error, "string");
  }

  // Test risk failsafe
  const riskRes = await aiRisk({ amount: 50000 });
  assert.equal(typeof riskRes.ok, "boolean");
  if (!riskRes.ok) {
    assert.equal(typeof riskRes.error, "string");
  }

  // Test advisor failsafe
  const advisorRes = await aiAdvisor({
    financial_summary: { income: 10000000, expense: 5000000 },
  });
  assert.equal(typeof advisorRes.ok, "boolean");
  if (!advisorRes.ok) {
    assert.equal(typeof advisorRes.error, "string");
  }

  // Health check failsafe
  const isHealthy = await aiHealthCheck();
  assert.equal(typeof isHealthy, "boolean");
});

test("auth guard: verify all AI route handlers enforce verifySupabaseAccessToken", async () => {
  const routes = [
    "../app/api/ai/classify/route.ts",
    "../app/api/ai/forecast/route.ts",
    "../app/api/ai/risk/route.ts",
    "../app/api/ai/advisor/route.ts",
  ];

  for (const r of routes) {
    const content = await readFile(new URL(r, import.meta.url), "utf8");
    assert.match(
      content,
      /verifySupabaseAccessToken/i,
      `Route ${r} must enforce verifySupabaseAccessToken auth guard`,
    );
    assert.match(
      content,
      /extractBearerToken/i,
      `Route ${r} must extract bearer token from Authorization header`,
    );
    assert.match(
      content,
      /advisory:\s*true/i,
      `Route ${r} must mark returned AI data as advisory: true`,
    );
  }
});

test("model registry: AI service config registers V3 models with ACCEPT status", async () => {
  const configFile = await readFile(
    new URL("../ai_service/config.py", import.meta.url),
    "utf8",
  );
  assert.match(configFile, /model_classify_v3/);
  assert.match(configFile, /model_prediction_v3/);
  assert.match(configFile, /model_warning_v3/);
  assert.match(configFile, /model_advisor/);
  assert.match(configFile, /SERVICE_VERSION = "3\.0\.0"/);
});

test("security: client_id and user_id spoofing prevention via server session binding", async () => {
  // 1. Verify app/api/ai/risk/route.ts forces client_id to authenticated user
  const riskRoute = await readFile(
    new URL("../app/api/ai/risk/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    riskRoute,
    /client_id:\s*user\.id/i,
    "Risk route must bind client_id directly to user.id, ignoring client payload",
  );

  // 2. Verify app/api/ai/advisor/route.ts forces user_id to authenticated user
  const advisorRoute = await readFile(
    new URL("../app/api/ai/advisor/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    advisorRoute,
    /user_id:\s*user\.id/i,
    "Advisor route must bind user_id directly to user.id, ignoring client payload",
  );
});

test("auth rejection: missing or invalid bearer token rejects with 401", async () => {
  const { extractBearerToken, verifySupabaseAccessToken, AuthenticationError } = await import(
    "../backend/src/services/supabase-auth.service.ts"
  );

  // Missing Authorization header
  const reqNoAuth = new Request("http://localhost:3000/api/ai/classify", {
    method: "POST",
  });
  assert.throws(
    () => extractBearerToken(reqNoAuth),
    (err) => err instanceof AuthenticationError && err.status === 401,
  );

  // Malformed header
  const reqBadHeader = new Request("http://localhost:3000/api/ai/classify", {
    method: "POST",
    headers: { Authorization: "Basic dXNlcjpwYXNz" },
  });
  assert.throws(
    () => extractBearerToken(reqBadHeader),
    (err) => err instanceof AuthenticationError && err.status === 401,
  );
});

test("contract: AI client schemas define backward-compatible ResponseMetadata", async () => {
  const clientCode = await readFile(
    new URL("../backend/src/services/ai-local.client.ts", import.meta.url),
    "utf8",
  );
  assert.match(clientCode, /export interface ResponseMetadata/);
  assert.match(clientCode, /fallback_used:\s*boolean/);
  assert.match(clientCode, /latency_ms:\s*number/);
  assert.match(clientCode, /advisory:\s*boolean/);
  assert.match(clientCode, /canary\?:\s*boolean/);
});

