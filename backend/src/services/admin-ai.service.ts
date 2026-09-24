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

  return {
    period,
    totalRequests,
    successRate,
    errorCount,
    avgLatencyMs,
    featureBreakdown,
    timeSeries: Array.from(timeSeriesMap.values()),
  };
}
