import { getSupabaseAdminClient } from "./admin-auth.service.ts";

export type AiFeatureType = "chat" | "parse_transaction" | "receipt_parse";

export interface AiUsageLogInput {
  userId?: string | null;
  feature: AiFeatureType;
  model: string;
  success: boolean;
  latencyMs: number;
  errorCode?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

export interface AiUsageStats {
  period: "today" | "7d" | "30d";
  totalRequests: number;
  successRate: number;
  errorCount: number;
  avgLatencyMs: number;
  featureBreakdown: {
    chat: number;
    parseTransaction: number;
    receiptParse: number;
  };
  timeSeries: {
    label: string;
    total: number;
    errors: number;
  }[];
  canary?: {
    primaryModel: string;
    canaryModel: string;
    canaryEnabled: boolean;
    canaryPercent: number;
    realEventsProgress: string;
    v3Requests: number;
    v4Requests: number;
    v4SuccessRate: number;
    v4FallbackRate: number;
    v4LatencyP95: number;
    circuitBreaker: "CLOSED" | "OPEN";
    promotionGate: "BLOCKED" | "READY_FOR_HUMAN_REVIEW";
  };
  feedback?: {
    totalEvents: number;
    acceptanceRate: number;
    correctionRate: number;
    highConfidenceCorrectionRate: number;
    v3AcceptanceRate: number;
    v4AcceptanceRate: number;
    correctionByCategory: Record<string, number>;
  };
}

/**
 * Record an AI telemetry event without persisting sensitive chat messages,
 * receipt pictures, or financial transactions.
 */
export async function recordAiUsageLog(input: AiUsageLogInput): Promise<void> {
  try {
    const supabase = getSupabaseAdminClient();

    await supabase.from("ai_usage_logs").insert({
      user_id: input.userId || null,
      feature: input.feature,
      model: input.model || "gemini",
      success: input.success,
      latency_ms: Math.max(0, Math.round(input.latencyMs)),
      error_code: input.errorCode || null,
      input_tokens: input.inputTokens || null,
      output_tokens: input.outputTokens || null,
    });
  } catch (error) {
    // Non-critical telemetry logging should never interrupt client transactions
    console.error("Failed to log AI telemetry:", error);
  }
}

export async function getAiUsageStats(period: "today" | "7d" | "30d" = "7d"): Promise<AiUsageStats> {
  const supabase = getSupabaseAdminClient();

  const now = new Date();
  const startDate = new Date();

  if (period === "today") {
    startDate.setHours(0, 0, 0, 0);
  } else if (period === "7d") {
    startDate.setDate(now.getDate() - 7);
  } else if (period === "30d") {
    startDate.setDate(now.getDate() - 30);
  }

  const { data, error } = await supabase
    .from("ai_usage_logs")
    .select("feature, success, latency_ms, error_code, created_at")
    .gte("created_at", startDate.toISOString())
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Không thể lấy thống kê AI: ${error.message}`);
  }

  const logs = data || [];
  const totalRequests = logs.length;
  const successful = logs.filter((l) => l.success).length;
  const errorCount = totalRequests - successful;
  const successRate = totalRequests > 0 ? Math.round((successful / totalRequests) * 100) : 100;
  const totalLatency = logs.reduce((sum, l) => sum + (Number(l.latency_ms) || 0), 0);
  const avgLatencyMs = totalRequests > 0 ? Math.round(totalLatency / totalRequests) : 0;

  const featureBreakdown = {
    chat: logs.filter((l) => l.feature === "chat").length,
    parseTransaction: logs.filter((l) => l.feature === "parse_transaction").length,
    receiptParse: logs.filter((l) => l.feature === "receipt_parse").length,
  };

  // Build time series buckets
  const timeSeriesMap = new Map<string, { label: string; total: number; errors: number }>();

  if (period === "today") {
    // 24 hours buckets
    for (let h = 0; h < 24; h += 2) {
      const label = `${String(h).padStart(2, "0")}:00`;
      timeSeriesMap.set(label, { label, total: 0, errors: 0 });
    }
    logs.forEach((log) => {
      const hour = new Date(log.created_at).getHours();
      const bucketHour = Math.floor(hour / 2) * 2;
      const label = `${String(bucketHour).padStart(2, "0")}:00`;
      const item = timeSeriesMap.get(label) || { label, total: 0, errors: 0 };
      item.total += 1;
      if (!log.success) item.errors += 1;
      timeSeriesMap.set(label, item);
    });
  } else {
    // Day buckets
    const days = period === "7d" ? 7 : 30;
    for (let d = days - 1; d >= 0; d--) {
      const dt = new Date();
      dt.setDate(now.getDate() - d);
      const label = `${dt.getDate()}/${dt.getMonth() + 1}`;
      timeSeriesMap.set(label, { label, total: 0, errors: 0 });
    }
    logs.forEach((log) => {
      const dt = new Date(log.created_at);
      const label = `${dt.getDate()}/${dt.getMonth() + 1}`;
      const item = timeSeriesMap.get(label);
      if (item) {
        item.total += 1;
        if (!log.success) item.errors += 1;
      }
    });
  }

  let realCount = 0;
  let canaryData: {
    canary_enabled?: boolean;
    canary_percent?: number;
    guard_status?: { circuit_breaker?: "CLOSED" | "OPEN" };
    real_traffic?: {
      valid_real_events?: number;
      progress?: string;
      v3_real_events?: number;
      v4_real_events?: number;
      v4_error_rate?: number;
      v4_fallback_rate?: number;
      v4_latency_p95?: number;
    };
  } | null = null;

  let feedbackData: {
    total_events?: number;
    acceptance_rate?: number;
    correction_rate?: number;
    v3_high_confidence_correction?: number;
    v4_high_confidence_correction?: number;
    v3_acceptance_rate?: number;
    v4_acceptance_rate?: number;
    correction_by_category?: Record<string, number>;
  } | null = null;

  const aiServiceUrl = (process.env.AI_SERVICE_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
  const telemetryToken = process.env.AI_INTERNAL_TELEMETRY_TOKEN;

  if (telemetryToken) {
    try {
      const [canaryRes, feedbackRes] = await Promise.all([
        fetch(`${aiServiceUrl}/telemetry/canary`, {
          headers: { Authorization: `Bearer ${telemetryToken}` },
          signal: AbortSignal.timeout(2000),
          cache: "no-store",
        }),
        fetch(`${aiServiceUrl}/telemetry/feedback`, {
          headers: { Authorization: `Bearer ${telemetryToken}` },
          signal: AbortSignal.timeout(2000),
          cache: "no-store",
        }),
      ]);
      if (canaryRes.ok) canaryData = await canaryRes.json();
      if (feedbackRes.ok) feedbackData = await feedbackRes.json();
    } catch {
      // AI service request error safely isolated
    }
  }

  try {
    const { count } = await supabase
      .from("ai_canary_telemetry")
      .select("id", { count: "exact", head: true })
      .eq("is_real_traffic", true);
    realCount = count || 0;
  } catch {
    // Database query error isolated
  }

  const validRealEvents = canaryData?.real_traffic?.valid_real_events ?? realCount;
  const isBlocked = validRealEvents < 500;

  return {
    period,
    totalRequests,
    successRate,
    errorCount,
    avgLatencyMs,
    featureBreakdown,
    timeSeries: Array.from(timeSeriesMap.values()),
    canary: {
      primaryModel: "v3",
      canaryModel: "v4",
      canaryEnabled: canaryData?.canary_enabled ?? true,
      canaryPercent: canaryData?.canary_percent ?? 5,
      realEventsProgress: canaryData?.real_traffic?.progress ?? `${validRealEvents} / 500`,
      v3Requests: canaryData?.real_traffic?.v3_real_events ?? 0,
      v4Requests: canaryData?.real_traffic?.v4_real_events ?? 0,
      v4SuccessRate: Math.round((1 - (canaryData?.real_traffic?.v4_error_rate ?? 0)) * 100),
      v4FallbackRate: Math.round((canaryData?.real_traffic?.v4_fallback_rate ?? 0) * 100),
      v4LatencyP95: canaryData?.real_traffic?.v4_latency_p95 ?? 0,
      circuitBreaker: canaryData?.guard_status?.circuit_breaker ?? "CLOSED",
      promotionGate: isBlocked ? "BLOCKED" : "READY_FOR_HUMAN_REVIEW",
    },
    feedback: {
      totalEvents: feedbackData?.total_events ?? 0,
      acceptanceRate: Math.round((feedbackData?.acceptance_rate ?? 0) * 100),
      correctionRate: Math.round((feedbackData?.correction_rate ?? 0) * 100),
      highConfidenceCorrectionRate: Math.round((feedbackData?.v3_high_confidence_correction ?? 0) * 100),
      v3AcceptanceRate: Math.round((feedbackData?.v3_acceptance_rate ?? 0) * 100),
      v4AcceptanceRate: Math.round((feedbackData?.v4_acceptance_rate ?? 0) * 100),
      correctionByCategory: feedbackData?.correction_by_category ?? {},
    },
  };
}
