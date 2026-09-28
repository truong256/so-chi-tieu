/**
 * app/api/ai/forecast/route.ts
 * ============================
 * POST /api/ai/forecast
 *
 * Shadow-mode spending forecast endpoint.
 * - Requires valid Supabase Bearer token.
 * - Accepts optional history array (preprocessed on server from Supabase data).
 * - Result is ADVISORY ONLY — never writes to DB.
 */

import { NextResponse } from "next/server";
import { aiForecast } from "@/backend/src/services/ai-local.client";
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

    const user = await verifySupabaseAccessToken(token, {
      supabaseUrl,
      supabasePublishableKey: supabaseKey,
    });

    // 2. Parse body
    const body = asRecord(await readJsonBody(request, 32 * 1024));

    const days =
      typeof body.days === "number" && body.days >= 1 && body.days <= 90
        ? body.days
        : 30;

    const history = Array.isArray(body.history) ? body.history as Array<{ date: string; amount: number }> : undefined;

    // 3. Call AI service with session userId for canary routing
    const result = await aiForecast({ days, history }, { userId: user.id, preferredVersion: "v3" });

    if (!result.ok || !result.data) {
      return NextResponse.json(
        { ok: false, advisory: true, error: result.error ?? "AI service không khả dụng." },
        { status: 200 },
      );
    }

    return NextResponse.json({
      ok: true,
      advisory: true,
      data: result.data,
      meta: result.data.meta,
    });
  } catch (err) {
    if (err instanceof AuthenticationError || err instanceof HttpInputError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[/api/ai/forecast] Unhandled error:", err);
    return NextResponse.json({ error: "Lỗi máy chủ." }, { status: 500 });
  }
}
