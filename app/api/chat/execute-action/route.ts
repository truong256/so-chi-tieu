/**
 * app/api/chat/execute-action/route.ts
 * =====================================
 * Authenticated API Route for confirming or cancelling AI-proposed CRUD actions.
 *
 * Security & Integrity:
 * - Verifies Supabase Bearer JWT (`verifySupabaseAccessToken`).
 * - Enforces `user_id` ownership and idempotency keys (`executeConfirmedCrudAction`).
 * - Returns success ONLY when Backend + Supabase DB confirm record persistence.
 */

import { NextResponse } from "next/server";
import { asRecord, HttpInputError, readJsonBody } from "@/backend/src/services/http-input.service";
import {
  AuthenticationError,
  extractBearerToken,
  verifySupabaseAccessToken,
} from "@/backend/src/services/supabase-auth.service";
import { executeConfirmedCrudAction } from "@/backend/src/services/ai-crud-tools.service";
import type { CrudActionType } from "@/backend/src/types/ai.types";

export const runtime = "nodejs";
export const maxDuration = 30;

const ALLOWED_ACTION_TYPES = new Set<CrudActionType>([
  "create_category",
  "create_budget",
  "create_transaction",
  "create_recurring_transaction",
]);

export async function POST(request: Request) {
  const startTime = Date.now();
  try {
    const token = extractBearerToken(request);
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const supabasePublishableKey =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      "";

    const verifiedUser = await verifySupabaseAccessToken(token, {
      supabaseUrl,
      supabasePublishableKey,
    });

    const body = asRecord(await readJsonBody(request, 32 * 1024));

    const actionId = typeof body.actionId === "string" ? body.actionId.trim() : undefined;
    const idempotencyKey =
      typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
    const rawActionType = typeof body.actionType === "string" ? body.actionType.trim() : "";
    const actionType = ALLOWED_ACTION_TYPES.has(rawActionType as CrudActionType)
      ? (rawActionType as CrudActionType)
      : undefined;
    const payload =
      body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
        ? (body.payload as Record<string, unknown>)
        : undefined;
    const cancel = body.cancel === true;

    const result = await executeConfirmedCrudAction(
      {
        supabaseUrl,
        supabaseKey: supabasePublishableKey,
        token,
        userId: verifiedUser.id,
      },
      {
        actionId,
        idempotencyKey,
        actionType,
        payload,
        cancel,
      },
    );

    const latencyMs = Date.now() - startTime;
    import("@/backend/src/services/admin-ai.service")
      .then(({ recordAiUsageLog }) => {
        void recordAiUsageLog({
          userId: verifiedUser.id,
          feature: "chat",
          model: "crud-action-executor",
          success: result.success,
          latencyMs,
          errorCode: result.success ? null : String(result.status),
        });
      })
      .catch(() => {});

    return NextResponse.json(
      {
        success: result.success,
        reply: result.reply,
        error: result.error,
        executedAction: result.executedAction,
        cancelled: result.cancelled,
      },
      {
        status: result.status,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (err) {
    if (err instanceof AuthenticationError || err instanceof HttpInputError) {
      return NextResponse.json(
        { success: false, error: err.message, reply: err.message },
        { status: err.status },
      );
    }
    console.error("Execute AI CRUD action API error:", err);
    return NextResponse.json(
      {
        success: false,
        error: "Không thể thực hiện thao tác lúc này. Vui lòng thử lại.",
        reply: "Không thể thực hiện thao tác lúc này. Vui lòng thử lại.",
      },
      { status: 500 },
    );
  }
}

