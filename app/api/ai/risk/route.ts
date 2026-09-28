/**
 * app/api/ai/risk/route.ts
 * ========================
 * POST /api/ai/risk
 *
 * Shadow-mode transaction risk assessment endpoint.
 * - Requires valid Supabase Bearer token.
 * - Client_id is forced to the authenticated user's ID (prevents cross-user leakage).
 * - Result is ADVISORY ONLY — never auto-blocks transactions.
 */

import { NextResponse } from "next/server";
import { aiRisk } from "@/backend/src/services/ai-local.client";
import type { RiskRequest } from "@/backend/src/services/ai-local.client";
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
    const body = asRecord(await readJsonBody(request, 8 * 1024));

    const amount = typeof body.amount === "number" ? body.amount : 0;
    if (amount <= 0) {
      return NextResponse.json(
        { error: "Trường 'amount' phải là số dương." },
        { status: 400 },
      );
    }

    // 3. Build risk payload — force client_id to authenticated user (no spoofing)
    const riskPayload: RiskRequest = {
      amount,
      client_id: user.id, // always bound to session user
      credit_limit:
        typeof body.credit_limit === "number" ? body.credit_limit : undefined,
      card_id: typeof body.card_id === "string" ? body.card_id : undefined,
      hour: typeof body.hour === "number" ? body.hour : undefined,
      day_of_week: typeof body.day_of_week === "number" ? body.day_of_week : undefined,
      month: typeof body.month === "number" ? body.month : undefined,
      mcc: typeof body.mcc === "number" ? body.mcc : 5411,
      use_chip: typeof body.use_chip === "string" ? body.use_chip : "Chip Transaction",
      card_brand: typeof body.card_brand === "string" ? body.card_brand : "Visa",
      card_type: typeof body.card_type === "string" ? body.card_type : "Credit",
      has_chip: typeof body.has_chip === "string" ? body.has_chip : "YES",
      card_on_dark_web: typeof body.card_on_dark_web === "string" ? body.card_on_dark_web : "No",
      credit_score: typeof body.credit_score === "number" ? body.credit_score : undefined,
      yearly_income: typeof body.yearly_income === "number" ? body.yearly_income : undefined,
      current_age: typeof body.current_age === "number" ? body.current_age : undefined,
      gender: typeof body.gender === "string" ? body.gender : undefined,
      errors: typeof body.errors === "string" ? body.errors : undefined,
    };

    // 4. Call AI service with session userId for canary routing
    const result = await aiRisk(riskPayload, { userId: user.id, preferredVersion: "v3" });

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
    console.error("[/api/ai/risk] Unhandled error:", err);
    return NextResponse.json({ error: "Lỗi máy chủ." }, { status: 500 });
  }
}
