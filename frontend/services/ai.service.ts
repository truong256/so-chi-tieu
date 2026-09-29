/**
 * frontend/services/ai.service.ts
 * =================================
 * Browser-side client for the Next.js AI proxy routes (/api/ai/*).
 *
 * Rules:
 *  - All requests carry the Supabase Bearer token (from the active session).
 *  - AI results are labelled advisory = true — callers must NOT write to DB directly.
 *  - All functions return { ok, data?, error? } — never throw.
 *  - Timeout: 12 s for all endpoints (advisor: 18 s).
 */

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface AiClientResult<T> {
  ok: boolean;
  advisory: true;
  data?: T;
  error?: string;
}

// --- Classify ---
export interface ClassifySuggestion {
  category: string;
  confidence: number;
  warning?: string;
  meta?: {
    model?: string;
    version?: string;
    latency_ms?: number;
    fallback_used?: boolean;
    canary?: boolean;
  };
}

// --- Forecast ---
export interface DailyForecastItem {
  date: string;
  predicted_spending: number;
}
export interface ForecastSuggestion {
  forecast: DailyForecastItem[];
  days: number;
  note?: string;
}

// --- Risk ---
export type RiskLevel = "SAFE" | "WARNING" | "DANGER";
export interface RiskSuggestion {
  risk_score: number;
  risk_level: RiskLevel;
  fraud_probability: number;
  risk_indicators: string[];
  warning?: string;
}

// --- Advisor ---
export interface AdvisorSuggestion {
  summary: string;
  warnings: string[];
  suggestions: string[];
  confidence: number;
  model_version: string;
  health_grade?: string;
  risk_score?: number;
}

// ---------------------------------------------------------------------------
// Shared request helper
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT = 12_000;

export interface PostAiOptions {
  timeoutMs?: number;
  clientEventId?: string;
  maxRetries?: number;
}

export function generateClientEventId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `tx_${crypto.randomUUID()}`;
  }
  const rand = Math.random().toString(36).substring(2, 12);
  return `tx_${Date.now()}_${rand}`;
}

async function postAi<T>(
  path: string,
  token: string,
  body: Record<string, unknown>,
  options?: PostAiOptions | number,
): Promise<AiClientResult<T>> {
  const timeoutMs = typeof options === "number" ? options : (options?.timeoutMs ?? DEFAULT_TIMEOUT);
  const clientEventId = typeof options === "object" ? options?.clientEventId : undefined;
  const maxRetries = typeof options === "object" ? (options?.maxRetries ?? 1) : 1;

  // Resolve client event ID: prefer options, then body, without regenerating on retries
  const eventId = (
    clientEventId ||
    (typeof body.client_event_id === "string" ? body.client_event_id : undefined)
  );

  const requestBody: Record<string, unknown> = { ...body };
  if (eventId) {
    requestBody.client_event_id = eventId;
  }

  let attempt = 0;
  while (attempt <= maxRetries) {
    attempt += 1;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      };
      if (eventId) {
        headers["X-Idempotency-Key"] = eventId;
        headers["X-Request-Id"] = eventId;
      }

      let res: Response;
      try {
        res = await fetch(path, {
          method: "POST",
          headers,
          body: JSON.stringify(requestBody),
          signal: controller.signal,
          cache: "no-store",
        });
      } finally {
        clearTimeout(timer);
      }

      const json = (await res.json()) as Record<string, unknown>;

      if (!res.ok) {
        const errMsg =
          typeof json.error === "string" ? json.error : `HTTP ${res.status}`;
        return { ok: false, advisory: true, error: errMsg };
      }

      if (json.ok === false) {
        return {
          ok: false,
          advisory: true,
          error: typeof json.error === "string" ? json.error : "AI không khả dụng.",
        };
      }

      return { ok: true, advisory: true, data: json.data as T };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = msg.toLowerCase().includes("abort");

      // Retry only transient network failures with the identical eventId
      if (attempt <= maxRetries && !isTimeout) {
        continue;
      }

      if (isTimeout) {
        return { ok: false, advisory: true, error: "AI service timeout." };
      }
      return { ok: false, advisory: true, error: "Không thể kết nối AI service." };
    }
  }

  return { ok: false, advisory: true, error: "Không thể kết nối AI service." };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ask AI to suggest a category for a transaction text.
 * Result is advisory only — user must confirm before saving.
 * Carries stable clientEventId to guarantee idempotency.
 */
export async function aiSuggestCategory(
  token: string,
  text: string,
  clientEventId?: string,
): Promise<AiClientResult<ClassifySuggestion>> {
  const eventId = clientEventId && /^[a-zA-Z0-9_-]{8,128}$/.test(clientEventId)
    ? clientEventId
    : generateClientEventId();

  return postAi<ClassifySuggestion>(
    "/api/ai/classify",
    token,
    { text, client_event_id: eventId },
    { clientEventId: eventId },
  );
}

/**
 * Request a spending forecast for the next N days.
 * History is an array of { date: "YYYY-MM-DD", amount: number }.
 */
export async function aiGetForecast(
  token: string,
  days: number,
  history?: Array<{ date: string; amount: number }>,
): Promise<AiClientResult<ForecastSuggestion>> {
  return postAi<ForecastSuggestion>("/api/ai/forecast", token, { days, history });
}

/**
 * Request a risk assessment for a transaction amount.
 */
export async function aiAssessRisk(
  token: string,
  payload: {
    amount: number;
    credit_limit?: number;
    card_id?: string;
    hour?: number;
    day_of_week?: number;
    month?: number;
    mcc?: number;
    use_chip?: string;
    card_brand?: string;
    card_type?: string;
  },
): Promise<AiClientResult<RiskSuggestion>> {
  return postAi<RiskSuggestion>("/api/ai/risk", token, payload);
}

/**
 * Request a holistic financial advisory based on the current month's data.
 */
export async function aiGetAdvisory(
  token: string,
  payload: {
    financial_summary: {
      income: number;
      expense: number;
      previous_month_expense?: number;
      categories?: Array<{ name: string; kind?: string; budget?: number; amount?: number }>;
      wallets?: Array<{ name: string; balance?: number }>;
      savings_goals?: Array<{ name: string; target?: number; current?: number; monthly_target?: number }>;
      month?: string;
    };
    classification?: Record<string, unknown>;
    forecast?: Record<string, unknown>;
    risk?: Record<string, unknown>;
  },
): Promise<AiClientResult<AdvisorSuggestion>> {
  return postAi<AdvisorSuggestion>("/api/ai/advisor", token, payload, 18_000);
}

/**
 * Natural language transaction parsing using Local AI with heuristic fallback.
 * Returns structured transaction draft and explicit prediction source.
 * Generates and preserves stable clientEventId to guarantee end-to-end idempotency.
 */
export async function aiParseTransaction(
  token: string,
  text: string,
  clientDate?: string,
  clientEventId?: string,
): Promise<AiClientResult<{
  category: string;
  confidence: number;
  source: string;
  fallback: boolean;
  data: Record<string, unknown>;
}>> {
  const eventId = clientEventId && /^[a-zA-Z0-9_-]{8,128}$/.test(clientEventId)
    ? clientEventId
    : generateClientEventId();

  return postAi<{
    category: string;
    confidence: number;
    source: string;
    fallback: boolean;
    data: Record<string, unknown>;
  }>(
    "/api/ai/parse-transaction",
    token,
    {
      text,
      client_date: clientDate,
      client_event_id: eventId,
    },
    { clientEventId: eventId },
  );
}

/**
 * Fetch detailed AI system health and model readiness status.
 */
export async function aiGetHealth(): Promise<{
  ok: boolean;
  status: "SERVICE_UP" | "SERVICE_DOWN";
  model_readiness: "MODEL_READY" | "MODEL_LOAD_FAILED" | "MODEL_MISSING";
  models: Record<string, boolean>;
  versions: Record<string, string>;
}> {
  try {
    const res = await fetch("/api/ai/health", { cache: "no-store" });
    const data = await res.json();
    return data;
  } catch {
    return {
      ok: false,
      status: "SERVICE_DOWN",
      model_readiness: "MODEL_MISSING",
      models: { classify: false, forecast: false, risk: false, advisor: false },
      versions: {},
    };
  }
}

export interface FeedbackPayload {
  suggested_category: string;
  final_category: string;
  model_version?: string;
  confidence_band?: "HIGH" | "MEDIUM" | "LOW";
  accepted?: boolean;
  latency_ms?: number;
  [key: string]: unknown;
}

/**
 * Send user acceptance or correction feedback for AI category suggestions.
 * Strictly no raw text or financial PII sent.
 */
export async function aiSendFeedback(
  token: string,
  payload: FeedbackPayload,
): Promise<AiClientResult<{ ok: boolean; accepted: boolean }>> {
  return postAi<{ ok: boolean; accepted: boolean }>("/api/ai/feedback", token, payload);
}

