/**
 * backend/src/services/ai-local.client.ts
 * ========================================
 * Server-only typed client for the FastAPI AI service running at localhost:8000.
 * NEVER import this file on the client side.
 *
 * Security rules:
 *  - AI_SERVICE_URL is server-only (no NEXT_PUBLIC_ prefix).
 *  - No Supabase service_role or secret keys are forwarded to FastAPI.
 *  - All requests have a hard timeout and fail-safe fallback.
 *  - User identity for canary routing MUST come from Supabase authenticated session.
 *  - Frontend cannot force model=v3 or canary=true.
 */

import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Types mirroring ai_service/schemas/*
// ---------------------------------------------------------------------------

export interface ResponseMetadata {
  model: string;
  version: string;
  latency_ms: number;
  fallback_used: boolean;
  canary?: boolean;
  advisory: boolean;
}

export interface ClassifyRequest {
  text: string;
  user_id?: string;
  preferred_version?: string;
  canary?: boolean;
  is_real_traffic?: boolean;
  idempotency_key?: string;
}

export interface ClassifyResponse {
  category: string;
  confidence: number;
  source?: "local_model_v4" | "local_model_v3" | "local_model_v2" | "heuristic";
  fallback?: boolean;
  warning?: string;
  advisory?: boolean;
  meta?: ResponseMetadata;
}

export interface DailyForecastItem {
  date: string;
  predicted_spending: number;
}

export interface ForecastRequest {
  days?: number;
  history?: Array<{ date: string; amount: number; [key: string]: unknown }>;
  preferred_version?: string;
  canary?: boolean;
}

export interface ForecastResponse {
  forecast: DailyForecastItem[];
  days: number;
  note?: string;
  advisory?: boolean;
  meta?: ResponseMetadata;
}

export interface RiskRequest {
  amount: number;
  credit_limit?: number;
  client_id?: string;
  card_id?: string;
  hour?: number;
  day_of_week?: number;
  month?: number;
  mcc?: number;
  use_chip?: string;
  card_brand?: string;
  card_type?: string;
  has_chip?: string;
  card_on_dark_web?: string;
  credit_score?: number;
  yearly_income?: number;
  current_age?: number;
  gender?: string;
  errors?: string;
  preferred_version?: string;
  canary?: boolean;
}

export interface RiskResponse {
  risk_score: number;
  risk_level: "SAFE" | "WARNING" | "DANGER";
  fraud_probability: number;
  risk_indicators: string[];
  warning?: string;
  advisory?: boolean;
  meta?: ResponseMetadata;
}

export interface CategoryItem {
  name: string;
  kind?: string;
  budget?: number;
  amount?: number;
}

export interface WalletItem {
  name: string;
  balance?: number;
}

export interface SavingsGoalItem {
  name: string;
  target?: number;
  current?: number;
  monthly_target?: number;
}

export interface FinancialSummary {
  income: number;
  expense: number;
  previous_month_expense?: number;
  categories?: CategoryItem[];
  wallets?: WalletItem[];
  savings_goals?: SavingsGoalItem[];
  user_id?: string;
  month?: string;
}

export interface AdvisorRequest {
  financial_summary: FinancialSummary;
  classification?: Record<string, unknown>;
  forecast?: Record<string, unknown>;
  risk?: Record<string, unknown>;
  preferred_version?: string;
  canary?: boolean;
}

export interface AdvisorResponse {
  summary: string;
  warnings: string[];
  suggestions: string[];
  confidence: number;
  model_version: string;
  health_grade?: string;
  risk_score?: number;
  advisory?: boolean;
  meta?: ResponseMetadata;
}

// ---------------------------------------------------------------------------
// FailSafe wrapper — every public method returns { ok, data, error }
// ---------------------------------------------------------------------------

export interface AiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface ClientOptions {
  userId?: string;
  preferredVersion?: "v3" | "v2";
}

// ---------------------------------------------------------------------------
// Canary Routing Logic
// ---------------------------------------------------------------------------

export function getCanaryPercent(): number {
  const raw = (process.env.AI_V3_CANARY_PERCENT ?? "0").trim();
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed) || parsed < 0 || parsed > 100) {
    return 0;
  }
  return parsed;
}

export function stableUserBucket(userId: string): number {
  const hash = crypto.createHash("sha256").update(userId).digest();
  return hash.readUInt32BE(0) % 100;
}

export interface CanaryDecision {
  isCanary: boolean;
  targetVersion: "v3" | "v2";
  bucket: number;
}

export function getCanaryDecision(userId?: string): CanaryDecision {
  const canaryPercent = getCanaryPercent();
  if (canaryPercent <= 0) {
    return { isCanary: false, targetVersion: "v2", bucket: 0 };
  }
  if (canaryPercent >= 100) {
    return { isCanary: false, targetVersion: "v3", bucket: 0 };
  }
  if (!userId) {
    return { isCanary: false, targetVersion: "v2", bucket: 0 };
  }
  const bucket = stableUserBucket(userId);
  const isCanary = bucket < canaryPercent;
  return {
    isCanary,
    targetVersion: isCanary ? "v3" : "v2",
    bucket,
  };
}

// ---------------------------------------------------------------------------
// Lightweight Circuit Breaker with Observability
// ---------------------------------------------------------------------------

interface CircuitBreakerState {
  failureCount: number;
  openCount: number;
  lastFailureTime: number;
  lastFailureType: string;
  isOpen: boolean;
}

const circuitState: CircuitBreakerState = {
  failureCount: 0,
  openCount: 0,
  lastFailureTime: 0,
  lastFailureType: "none",
  isOpen: false,
};

const FAILURE_THRESHOLD = 5;
const COOLDOWN_PERIOD_MS = 10_000;

export interface CircuitBreakerTelemetry {
  state: "CLOSED" | "OPEN" | "HALF-OPEN";
  failureCount: number;
  openCount: number;
  lastFailureTime: number;
  lastFailureType: string;
}

export function getCircuitBreakerStatus(): CircuitBreakerTelemetry {
  const now = Date.now();
  let state: "CLOSED" | "OPEN" | "HALF-OPEN" = "CLOSED";
  if (circuitState.isOpen) {
    if (now - circuitState.lastFailureTime > COOLDOWN_PERIOD_MS) {
      state = "HALF-OPEN";
    } else {
      state = "OPEN";
    }
  }
  return {
    state,
    failureCount: circuitState.failureCount,
    openCount: circuitState.openCount,
    lastFailureTime: circuitState.lastFailureTime,
    lastFailureType: circuitState.lastFailureType,
  };
}

export function resetCircuitBreaker(): void {
  circuitState.failureCount = 0;
  circuitState.isOpen = false;
  circuitState.lastFailureType = "none";
}

function checkCircuitBreaker(): boolean {
  const now = Date.now();
  if (circuitState.isOpen) {
    if (now - circuitState.lastFailureTime > COOLDOWN_PERIOD_MS) {
      // Cooldown passed, allow probe request (HALF-OPEN)
      return true;
    }
    telemetry.ai_circuit_open_total += 1;
    return false; // Still OPEN
  }
  return true;
}

function recordCircuitSuccess(): void {
  circuitState.failureCount = 0;
  circuitState.isOpen = false;
}

function recordCircuitFailure(errorType: string): void {
  circuitState.failureCount += 1;
  circuitState.lastFailureTime = Date.now();
  circuitState.lastFailureType = errorType;
  if (circuitState.failureCount >= FAILURE_THRESHOLD) {
    if (!circuitState.isOpen) {
      circuitState.openCount += 1;
    }
    circuitState.isOpen = true;
  }
}

// ---------------------------------------------------------------------------
// Telemetry Aggregation
// ---------------------------------------------------------------------------

const telemetry = {
  ai_requests_total: {} as Record<string, number>,
  ai_v2_primary_total: {} as Record<string, number>,
  ai_v3_primary_total: {} as Record<string, number>,
  ai_v4_primary_total: {} as Record<string, number>,
  ai_v3_canary_total: {} as Record<string, number>,
  ai_fallback_total: {} as Record<string, number>,
  ai_error_total: {} as Record<string, number>,
  ai_circuit_open_total: 0,
  latencies: {} as Record<string, number[]>,
};

function recordTelemetry(
  endpoint: string,
  version: "v4" | "v3" | "v2",
  isCanary: boolean,
  isFallback: boolean,
  latencyMs: number,
  isError: boolean,
) {
  telemetry.ai_requests_total[endpoint] = (telemetry.ai_requests_total[endpoint] ?? 0) + 1;
  if (version === "v4") {
    telemetry.ai_v4_primary_total[endpoint] = (telemetry.ai_v4_primary_total[endpoint] ?? 0) + 1;
  } else if (version === "v3") {
    telemetry.ai_v3_primary_total[endpoint] = (telemetry.ai_v3_primary_total[endpoint] ?? 0) + 1;
  } else {
    telemetry.ai_v2_primary_total[endpoint] = (telemetry.ai_v2_primary_total[endpoint] ?? 0) + 1;
  }
  if (isCanary) {
    telemetry.ai_v3_canary_total[endpoint] = (telemetry.ai_v3_canary_total[endpoint] ?? 0) + 1;
  }
  if (isFallback) {
    telemetry.ai_fallback_total[endpoint] = (telemetry.ai_fallback_total[endpoint] ?? 0) + 1;
  }
  if (isError) {
    telemetry.ai_error_total[endpoint] = (telemetry.ai_error_total[endpoint] ?? 0) + 1;
  }

  if (!telemetry.latencies[endpoint]) {
    telemetry.latencies[endpoint] = [];
  }
  telemetry.latencies[endpoint].push(latencyMs);
  if (telemetry.latencies[endpoint].length > 1000) {
    telemetry.latencies[endpoint].shift();
  }
}

function calculatePercentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export function getAiTelemetry() {
  const p50: Record<string, number> = {};
  const p95: Record<string, number> = {};
  const p99: Record<string, number> = {};
  for (const [ep, lats] of Object.entries(telemetry.latencies)) {
    p50[ep] = calculatePercentile(lats, 50);
    p95[ep] = calculatePercentile(lats, 95);
    p99[ep] = calculatePercentile(lats, 99);
  }
  return {
    ai_requests_total: { ...telemetry.ai_requests_total },
    ai_v2_primary_total: { ...telemetry.ai_v2_primary_total },
    ai_v3_primary_total: { ...telemetry.ai_v3_primary_total },
    ai_v4_primary_total: { ...telemetry.ai_v4_primary_total },
    ai_v3_canary_total: { ...telemetry.ai_v3_canary_total },
    ai_fallback_total: { ...telemetry.ai_fallback_total },
    ai_error_total: { ...telemetry.ai_error_total },
    ai_circuit_open_total: telemetry.ai_circuit_open_total,
    latency_p50_ms: p50,
    latency_p95_ms: p95,
    latency_p99_ms: p99,
  };
}

// ---------------------------------------------------------------------------
// Classification Product Metrics (Safe, No PII)
// ---------------------------------------------------------------------------

export interface ClassificationProductEvent {
  event: "shown" | "applied" | "overridden" | "dismissed";
  model_version: "v4" | "v3" | "v2";
  confidence_bucket: "HIGH" | "MEDIUM" | "LOW";
  predicted_category: string;
  final_category?: string;
}

const productEvents: ClassificationProductEvent[] = [];

export function recordClassificationProductEvent(evt: ClassificationProductEvent): void {
  productEvents.push({ ...evt });
  if (productEvents.length > 5000) {
    productEvents.shift();
  }
}

export function resetClassificationProductEvents(): void {
  productEvents.length = 0;
}

export function getClassificationProductMetrics() {
  const counts: Record<string, number> = {
    shown_total: 0,
    applied_total: 0,
    overridden_total: 0,
    dismissed_total: 0,
    v4_shown: 0,
    v4_applied: 0,
    v4_overridden: 0,
    v3_shown: 0,
    v3_applied: 0,
    v3_overridden: 0,
    v2_shown: 0,
    v2_applied: 0,
    v2_overridden: 0,
    high_shown: 0,
    high_applied: 0,
    high_overridden: 0,
    high_v3_overridden: 0,
    high_v4_overridden: 0,
  };

  for (const ev of productEvents) {
    counts[`${ev.event}_total`] = (counts[`${ev.event}_total`] ?? 0) + 1;
    if (ev.model_version === "v4") {
      counts[`v4_${ev.event}`] = (counts[`v4_${ev.event}`] ?? 0) + 1;
    } else if (ev.model_version === "v3") {
      counts[`v3_${ev.event}`] = (counts[`v3_${ev.event}`] ?? 0) + 1;
    } else {
      counts[`v2_${ev.event}`] = (counts[`v2_${ev.event}`] ?? 0) + 1;
    }
    if (ev.confidence_bucket === "HIGH") {
      counts[`high_${ev.event}`] = (counts[`high_${ev.event}`] ?? 0) + 1;
      if (ev.model_version === "v4" && ev.event === "overridden") {
        counts.high_v4_overridden += 1;
      } else if (ev.model_version === "v3" && ev.event === "overridden") {
        counts.high_v3_overridden += 1;
      }
    }
  }

  const v4Base = counts.v4_shown > 0 ? counts.v4_shown : (counts.v4_applied + counts.v4_overridden);
  const v3Base = counts.v3_shown > 0 ? counts.v3_shown : (counts.v3_applied + counts.v3_overridden);
  const v2Base = counts.v2_shown > 0 ? counts.v2_shown : (counts.v2_applied + counts.v2_overridden);
  const totalBase = counts.shown_total > 0 ? counts.shown_total : (counts.applied_total + counts.overridden_total);

  const applyRateTotal = totalBase > 0 ? counts.applied_total / totalBase : 0;
  const applyRateV4 = v4Base > 0 ? counts.v4_applied / v4Base : 0;
  const applyRateV3 = v3Base > 0 ? counts.v3_applied / v3Base : 0;
  const applyRateV2 = v2Base > 0 ? counts.v2_applied / v2Base : 0;

  const overrideRateV4 = v4Base > 0 ? counts.v4_overridden / v4Base : 0;
  const overrideRateV3 = v3Base > 0 ? counts.v3_overridden / v3Base : 0;
  const overrideRateHighV4 = v4Base > 0 ? counts.high_v4_overridden / v4Base : 0;
  const overrideRateHighV3 = v3Base > 0 ? counts.high_v3_overridden / v3Base : 0;

  return {
    counts,
    apply_rate: {
      overall: Number(applyRateTotal.toFixed(4)),
      v4: Number(applyRateV4.toFixed(4)),
      v3: Number(applyRateV3.toFixed(4)),
      v2: Number(applyRateV2.toFixed(4)),
    },
    override_rate: {
      v4: Number(overrideRateV4.toFixed(4)),
      v4_high_confidence: Number(overrideRateHighV4.toFixed(4)),
      v3: Number(overrideRateV3.toFixed(4)),
      v3_high_confidence: Number(overrideRateHighV3.toFixed(4)),
    },
    // Direct fields for requirement 6
    v3_shown: counts.v3_shown,
    v3_applied: counts.v3_applied,
    v3_overridden: counts.v3_overridden,
    v4_shown: counts.v4_shown,
    v4_applied: counts.v4_applied,
    v4_overridden: counts.v4_overridden,
    v3_acceptance_rate: Number(applyRateV3.toFixed(4)),
    v4_acceptance_rate: Number(applyRateV4.toFixed(4)),
    v3_correction_rate: Number(overrideRateV3.toFixed(4)),
    v4_correction_rate: Number(overrideRateV4.toFixed(4)),
    v3_high_confidence_correction_rate: Number(overrideRateHighV3.toFixed(4)),
    v4_high_confidence_correction_rate: Number(overrideRateHighV4.toFixed(4)),
  };
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Internal HTTP caller with Canary & Fallback
// ---------------------------------------------------------------------------

function getAiServiceUrl(): string {
  return (process.env.AI_SERVICE_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
}

async function singlePost<TReq, TRes>(
  path: string,
  body: TReq,
  timeoutMs: number,
  preferredVersion?: string,
  isCanary?: boolean,
): Promise<{ ok: boolean; data?: TRes; error?: string; status?: number }> {
  const url = `${getAiServiceUrl()}${path}`;
  const payload: Record<string, unknown> = {
    ...(body as unknown as Record<string, unknown>),
  };
  if (preferredVersion) {
    payload.preferred_version = preferredVersion;
  }
  if (isCanary !== undefined) {
    payload.canary = isCanary;
  }

  const internalToken = (process.env.AI_INTERNAL_SERVICE_TOKEN || process.env.AI_INTERNAL_TELEMETRY_TOKEN || "").trim();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (internalToken) {
    headers["X-AI-Internal-Token"] = internalToken;
  }
  if (preferredVersion) {
    headers["X-AI-Model-Version"] = preferredVersion;
  }
  if (isCanary !== undefined) {
    headers["X-AI-Canary"] = String(isCanary);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const errType = msg.includes("abort") || msg.toLowerCase().includes("timeout") ? "timeout" : "network_error";
    recordCircuitFailure(errType);
    return { ok: false, error: errType === "timeout" ? "timeout" : "network_error" };
  }

  if (!response.ok) {
    recordCircuitFailure(`http_${response.status}`);
    return { ok: false, error: `http_${response.status}`, status: response.status };
  }

  try {
    const data = (await response.json()) as TRes;
    recordCircuitSuccess();
    return { ok: true, data };
  } catch {
    recordCircuitFailure("invalid_json");
    return { ok: false, error: "invalid_json" };
  }
}

async function executeWithCanaryAndFallback<
  TReq extends object,
  TRes extends { meta?: ResponseMetadata; advisory?: boolean }
>(
  path: string,
  body: TReq,
  timeoutMs: number,
  options?: ClientOptions,
): Promise<AiResult<TRes>> {
  const t0 = Date.now();
  if (!checkCircuitBreaker()) {
    return {
      ok: false,
      error: "AI service tạm thời không khả dụng (bảo vệ mạch hở — circuit breaker open).",
    };
  }

  const isClassifyPath = path === "/classify";
  let primaryVersion: "v3" | "v2" | undefined;
  let isCanary = false;

  if (options?.preferredVersion) {
    primaryVersion = options.preferredVersion;
  } else if (!isClassifyPath) {
    // For non-classify endpoints (legacy canary logic)
    const decision = getCanaryDecision(options?.userId);
    primaryVersion = decision.targetVersion;
    isCanary = decision.isCanary;
  }
  // For /classify: FastAPI is the single source of truth for V4 canary.
  // We leave primaryVersion undefined so FastAPI applies its own V4 canary policy.

  // 1. Attempt Primary execution
  const primaryRes = await singlePost<TReq, TRes>(
    path,
    body,
    timeoutMs,
    primaryVersion,
    isCanary,
  );

  const latPrimary = Date.now() - t0;

  if (primaryRes.ok && primaryRes.data) {
    const data = primaryRes.data as TRes & { source?: string; fallback?: boolean };
    const resolvedVersion = data.meta?.version ?? primaryVersion ?? "v3";
    const resolvedCanary = data.meta?.canary ?? isCanary;

    if (data.meta && data.meta.canary === undefined) {
      data.meta.canary = resolvedCanary;
    }
    if (!data.source && data.meta?.version) {
      if (data.meta.version === "v4") {
        data.source = "local_model_v4";
      } else if (data.meta.version === "v3") {
        data.source = "local_model_v3";
      } else {
        data.source = "local_model_v2";
      }
    }
    if (data.fallback === undefined && data.meta) {
      data.fallback = Boolean(data.meta.fallback_used);
    }
    const teleVer: "v4" | "v3" | "v2" = resolvedVersion === "v4" ? "v4" : resolvedVersion === "v2" ? "v2" : "v3";
    recordTelemetry(path, teleVer, resolvedCanary, false, latPrimary, false);
    return { ok: true, data: data as TRes };
  }

  // 2. Fallback execution: If Primary was V3 (or unspecified on non-4xx) and failed, attempt V2 fallback.
  // CRITICAL (Requirement 5): Node does NOT perform secondary fallback for /classify.
  // FastAPI is the single source of truth for V4 canary and internal V4->V3->V2 fallback.
  // Secondary fallback on /classify causes duplicate inference and duplicate real-traffic telemetry.
  if (!isClassifyPath && (!primaryVersion || primaryVersion === "v3") && primaryRes.status !== 400 && primaryRes.status !== 422) {
    const fallbackRes = await singlePost<TReq, TRes>(
      path,
      body,
      timeoutMs,
      "v2",
      false,
    );
    const latTotal = Date.now() - t0;

    if (fallbackRes.ok && fallbackRes.data) {
      const data = fallbackRes.data as TRes & { source?: string; fallback?: boolean };
      if (data.meta) {
        data.meta.version = "v2";
        data.meta.fallback_used = true;
        data.meta.canary = false;
      }
      data.source = "local_model_v2";
      data.fallback = true;
      recordTelemetry(path, "v2", false, true, latTotal, false);
      return { ok: true, data: data as TRes };
    }
  }

  // If all failed
  const latFail = Date.now() - t0;
  recordTelemetry(path, primaryVersion === "v2" ? "v2" : "v3", isCanary, false, latFail, true);
  return {
    ok: false,
    error: primaryRes.error === "timeout"
      ? "AI service timeout — vui lòng thử lại."
      : "AI service không khả dụng lúc này.",
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify a transaction description into a spending category.
 * ADVISORY ONLY — do not use to auto-assign categories without user confirmation.
 */
export async function aiClassify(
  req: ClassifyRequest,
  options?: ClientOptions,
): Promise<AiResult<ClassifyResponse>> {
  return executeWithCanaryAndFallback<ClassifyRequest & { allow_unapproved: false }, ClassifyResponse>(
    "/classify",
    { ...req, allow_unapproved: false },
    3_000,
    options,
  );
}

/**
 * Forecast daily spending for the next N days.
 * ADVISORY ONLY.
 */
export async function aiForecast(
  req: ForecastRequest,
  options?: ClientOptions,
): Promise<AiResult<ForecastResponse>> {
  return executeWithCanaryAndFallback<ForecastRequest & { allow_unapproved: false }, ForecastResponse>(
    "/forecast",
    { ...req, allow_unapproved: false },
    4_000,
    options,
  );
}

/**
 * Assess transaction risk / fraud probability.
 * ADVISORY ONLY — never auto-block transactions.
 */
export async function aiRisk(
  req: RiskRequest,
  options?: ClientOptions,
): Promise<AiResult<RiskResponse>> {
  return executeWithCanaryAndFallback<RiskRequest & { allow_unapproved: false }, RiskResponse>(
    "/risk",
    { ...req, allow_unapproved: false },
    3_000,
    options,
  );
}

/**
 * Generate a holistic financial advisory for the user's current month.
 * ADVISORY ONLY.
 */
export async function aiAdvisor(
  req: AdvisorRequest,
  options?: ClientOptions,
): Promise<AiResult<AdvisorResponse>> {
  return executeWithCanaryAndFallback<AdvisorRequest, AdvisorResponse>(
    "/advisor",
    req,
    5_000,
    options,
  );
}

/**
 * Ping the AI service health endpoint.
 * Returns true if the service is reachable and healthy.
 */
export async function aiHealthCheck(): Promise<boolean> {
  try {
    const res = await fetch(`${getAiServiceUrl()}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface AiDetailedHealth {
  status: "SERVICE_UP" | "SERVICE_DOWN";
  model_readiness: "MODEL_READY" | "MODEL_LOAD_FAILED" | "MODEL_MISSING";
  overall_status: string;
  models: {
    classify: boolean;
    forecast: boolean;
    risk: boolean;
    advisor: boolean;
  };
  versions: Record<string, string>;
  model_details?: Record<string, unknown>;
  circuit_breaker: CircuitBreakerTelemetry;
  timestamp: string;
}

/**
 * Detailed health check distinguishing service availability from model readiness.
 * Never treats HTTP 200 as proof that models have loaded.
 */
export async function aiDetailedHealthCheck(): Promise<AiDetailedHealth> {
  const cbStatus = getCircuitBreakerStatus();
  try {
    const res = await fetch(`${getAiServiceUrl()}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) {
      return {
        status: "SERVICE_UP",
        model_readiness: "MODEL_LOAD_FAILED",
        overall_status: `http_${res.status}`,
        models: { classify: false, forecast: false, risk: false, advisor: false },
        versions: {},
        circuit_breaker: cbStatus,
        timestamp: new Date().toISOString(),
      };
    }

    const data = (await res.json()) as {
      status?: string;
      models?: Record<string, boolean>;
      versions?: Record<string, string>;
      model_details?: Record<string, unknown>;
    };

    const models = {
      classify: Boolean(data.models?.classify),
      forecast: Boolean(data.models?.forecast),
      risk: Boolean(data.models?.risk),
      advisor: Boolean(data.models?.advisor),
    };

    const allLoaded = models.classify && models.forecast && models.risk && models.advisor;
    const someLoaded = models.classify || models.forecast || models.risk || models.advisor;

    let readiness: "MODEL_READY" | "MODEL_LOAD_FAILED" | "MODEL_MISSING" = "MODEL_READY";
    if (!someLoaded) {
      readiness = "MODEL_MISSING";
    } else if (!allLoaded) {
      readiness = "MODEL_LOAD_FAILED";
    }

    return {
      status: "SERVICE_UP",
      model_readiness: readiness,
      overall_status: data.status ?? (allLoaded ? "ok" : "degraded"),
      models,
      versions: data.versions ?? {},
      model_details: data.model_details,
      circuit_breaker: cbStatus,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    return {
      status: "SERVICE_DOWN",
      model_readiness: "MODEL_MISSING",
      overall_status: err instanceof Error ? err.message : "unreachable",
      models: { classify: false, forecast: false, risk: false, advisor: false },
      versions: {},
      circuit_breaker: cbStatus,
      timestamp: new Date().toISOString(),
    };
  }
}

