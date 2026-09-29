/**
 * app/api/ai/feedback/route.ts
 * ============================
 * POST /api/ai/feedback
 *
 * User Correction & Suggestion Feedback Loop endpoint:
 * - Requires valid Supabase Bearer token (user must be authenticated).
 * - Binds user identity to server-side SHA-256 hash (no raw user ID, no PII, no text).
 * - Forwards structured feedback to internal FastAPI telemetry service.
 * - Updates local product metrics in ai-local.client.
 */

import { NextResponse } from "next/server";
import crypto from "node:crypto";
import {
  AuthenticationError,
  extractBearerToken,
  verifySupabaseAccessToken,
} from "@/backend/src/services/supabase-auth.service";
import { HttpInputError, asRecord, readJsonBody } from "@/backend/src/services/http-input.service";
import { recordClassificationProductEvent } from "@/backend/src/services/ai-local.client";

export const runtime = "nodejs";
export const maxDuration = 10;

function getAiServiceUrl(): string {
  return (process.env.AI_SERVICE_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
}

export async function POST(request: Request) {
  try {
    // 1. Auth guard — user must be authenticated
    const token = extractBearerToken(request);
    const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
    const supabaseKey = (
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      ""
    ).trim();

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: "Lỗi cấu hình server." }, { status: 500 });
    }

    const user = await verifySupabaseAccessToken(token, {
      supabaseUrl,
      supabasePublishableKey: supabaseKey,
    });

    // 2. Parse body (strictly minimum required fields; zero raw transaction text allowed)
    const body = asRecord(await readJsonBody(request, 4 * 1024));

    // Reject any attempt to send raw text, card numbers, or description in feedback
    const forbiddenKeys = ["text", "desc", "description", "card", "account", "token", "password"];
    for (const key of Object.keys(body)) {
      if (forbiddenKeys.some((k) => key.toLowerCase().includes(k))) {
        return NextResponse.json(
          { error: `Trường dữ liệu không hợp lệ: '${key}'. Không được gửi nội dung giao dịch vào feedback telemetry.` },
          { status: 400 },
        );
      }
    }

    const suggestedCategory = typeof body.suggested_category === "string" ? body.suggested_category.trim() : "";
    const finalCategory = typeof body.final_category === "string" ? body.final_category.trim() : "";
    const rawVersion = typeof body.model_version === "string" ? body.model_version.trim().toLowerCase() : "v3";
    const modelVersion: "v4" | "v3" | "v2" = rawVersion === "v4" ? "v4" : rawVersion === "v2" ? "v2" : "v3";
    const rawBand = typeof body.confidence_band === "string" ? body.confidence_band.trim().toUpperCase() : "MEDIUM";
    const confidenceBand: "HIGH" | "MEDIUM" | "LOW" =
      rawBand === "HIGH" || rawBand === "LOW" ? rawBand : "MEDIUM";

    if (!suggestedCategory || !finalCategory) {
      return NextResponse.json(
        { error: "Trường 'suggested_category' và 'final_category' là bắt buộc." },
        { status: 400 },
      );
    }

    const isAccepted = typeof body.accepted === "boolean"
      ? body.accepted
      : suggestedCategory.toLowerCase() === finalCategory.toLowerCase();

    const latencyMs = typeof body.latency_ms === "number" && Number.isFinite(body.latency_ms)
      ? Math.max(0, Math.round(body.latency_ms))
      : undefined;

    // 3. Server-side SHA-256 user pseudonymization
    const userIdHash = crypto.createHash("sha256").update(user.id).digest("hex");

    // 4. Update in-process product metrics (isolated per version: v2, v3, v4)
    recordClassificationProductEvent({
      event: isAccepted ? "applied" : "overridden",
      model_version: modelVersion,
      confidence_bucket: confidenceBand,
      predicted_category: suggestedCategory,
      final_category: finalCategory,
    });

    // 5. Forward to FastAPI internal telemetry (fail-safe)
    const telemetryToken = (process.env.AI_INTERNAL_TELEMETRY_TOKEN || process.env.AI_INTERNAL_SERVICE_TOKEN || "").trim();
    if (telemetryToken) {
      try {
        const fastApiUrl = `${getAiServiceUrl()}/telemetry/feedback`;
        await fetch(fastApiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${telemetryToken}`,
            "X-AI-Internal-Token": telemetryToken,
          },
          body: JSON.stringify({
            model_version: modelVersion,
            suggested_category: suggestedCategory,
            final_category: finalCategory,
            confidence_band: confidenceBand,
            user_id_hash: userIdHash,
            accepted: isAccepted,
            latency_ms: latencyMs,
          }),
          signal: AbortSignal.timeout(3000),
          cache: "no-store",
        });
      } catch (err) {
        // Isolated telemetry error
        console.warn("[/api/ai/feedback] Telemetry forward warning:", err);
      }
    }

    return NextResponse.json({
      ok: true,
      accepted: isAccepted,
      model_version: modelVersion,
      confidence_band: confidenceBand,
    });
  } catch (err) {
    if (err instanceof AuthenticationError || err instanceof HttpInputError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[/api/ai/feedback] Unhandled error:", err);
    return NextResponse.json({ error: "Lỗi xử lý phản hồi AI." }, { status: 500 });
  }
}
