/**
 * app/api/ai/classify/route.ts
 * ============================
 * POST /api/ai/classify
 *
 * Shadow-mode classification endpoint.
 * - Requires valid Supabase Bearer token (user must be authenticated).
 * - Forwards ONLY the text to FastAPI; never forwards Supabase secrets.
 * - Returns result as advisory suggestion, NOT a database write.
 */

import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { aiClassify } from "@/backend/src/services/ai-local.client";
import {
  AuthenticationError,
  extractBearerToken,
  verifySupabaseAccessToken,
} from "@/backend/src/services/supabase-auth.service";
import { HttpInputError, asRecord, readJsonBody } from "@/backend/src/services/http-input.service";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function POST(request: Request) {
  try {
    // 1. Auth guard
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

    // Verify user — result binds the user_id for audit & canary routing
    const user = await verifySupabaseAccessToken(token, {
      supabaseUrl,
      supabasePublishableKey: supabaseKey,
    });

    // 2. Parse body (strictly ignore any model/canary fields from client)
    const body = asRecord(await readJsonBody(request, 4 * 1024));
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) {
      return NextResponse.json({ error: "Trường 'text' không được để trống." }, { status: 400 });
    }

    // Extract client idempotency identifier if present (from header or body)
    const headerKey = request.headers.get("x-idempotency-key") || request.headers.get("x-request-id");
    const bodyKey = typeof body.idempotency_key === "string" ? body.idempotency_key : typeof body.client_event_id === "string" ? body.client_event_id : undefined;
    const rawKey = (headerKey || bodyKey || "").trim();

    // Key must have good entropy, be alphanumeric/hyphens/underscores (8..128 chars), and contain NO PII/text
    let idempotencyKey: string;
    if (rawKey && /^[a-zA-Z0-9_-]{8,128}$/.test(rawKey)) {
      idempotencyKey = rawKey;
    } else {
      idempotencyKey = `tx_${crypto.randomUUID()}`;
    }

    // 3. Call AI service (fail-safe with deterministic canary routing based on session user.id)
    const result = await aiClassify(
      {
        text,
        user_id: user.id,
        is_real_traffic: true,
        idempotency_key: idempotencyKey,
      },
      { userId: user.id },
    );

    if (!result.ok || !result.data) {
      // Graceful degradation — return a soft error the UI can handle
      return NextResponse.json(
        {
          ok: false,
          advisory: true,
          error: result.error ?? "AI service không khả dụng.",
        },
        { status: 200 }, // 200 so the UI doesn't throw; field ok=false signals failure
      );
    }

    return NextResponse.json({
      ok: true,
      advisory: true, // UI must display as suggestion, not ground truth
      data: result.data,
      meta: result.data.meta,
    });
  } catch (err) {
    if (err instanceof AuthenticationError || err instanceof HttpInputError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[/api/ai/classify] Unhandled error:", err);
    return NextResponse.json({ error: "Lỗi máy chủ." }, { status: 500 });
  }
}
