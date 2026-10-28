/**
 * app/api/recurring/process/route.ts
 * ===================================
 * Authenticated Backend API Route for processing due recurring transactions.
 * Handles timezone-aware scheduling (Asia/Ho_Chi_Minh), next_run_at advancement,
 * wallet available balance checks, and duplicate prevention via `recurring_occurrences`.
 */

import { NextResponse } from "next/server";
import { asRecord, HttpInputError, readJsonBody } from "@/backend/src/services/http-input.service";
import {
  AuthenticationError,
  extractBearerToken,
  verifySupabaseAccessToken,
} from "@/backend/src/services/supabase-auth.service";
import {
  DEFAULT_RECURRING_TIMEZONE,
  processDueRecurringTransactions,
} from "@/backend/src/services/recurring-scheduler.service";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
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

    let body: Record<string, unknown> = {};
    const contentLength = request.headers.get("content-length");
    if (contentLength && Number(contentLength) > 0) {
      body = asRecord(await readJsonBody(request, 16 * 1024));
    }

    const timeZone =
      typeof body.timeZone === "string" && body.timeZone.trim()
        ? body.timeZone.trim()
        : DEFAULT_RECURRING_TIMEZONE;
    const scheduleId =
      typeof body.scheduleId === "string" && body.scheduleId.trim()
        ? body.scheduleId.trim()
        : undefined;

    const summary = await processDueRecurringTransactions(
      {
        supabaseUrl,
        supabaseKey: supabasePublishableKey,
        token,
        userId: verifiedUser.id,
      },
      {
        timeZone,
        scheduleId,
      },
    );

    if (!summary.success) {
      return NextResponse.json(
        { error: summary.error || "Không thể xử lý lịch định kỳ.", ...summary },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(summary, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    if (err instanceof AuthenticationError || err instanceof HttpInputError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Recurring process API error:", err);
    return NextResponse.json(
      { error: "Lỗi máy chủ khi xử lý giao dịch định kỳ." },
      { status: 500 },
    );
  }
}

