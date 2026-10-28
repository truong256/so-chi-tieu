/**
 * app/api/chat/route.ts
 * =====================
 * API Route Handler for Financial Copilot Chatbot.
 *
 * Security & Data Privacy:
 * - Requires verified Supabase bearer token.
 * - Authenticated user's financial context is computed server-side directly with Supabase RLS.
 * - Client-supplied numbers/balances are ignored.
 * - Multi-currency safe.
 * - Concurrency & deadline controlled via Ollama client.
 */

import { NextResponse } from "next/server";
import { processChat, processChatStream } from "@/backend/src/services/ai-chat.service";
import { buildServerFinancialContext } from "@/backend/src/services/financial-context.service";
import { routeUserIntent } from "@/backend/src/services/ai-router.service";
import type { AiChatRequest } from "@/backend/src/types/ai.types";
import { asRecord, HttpInputError, readJsonBody } from "@/backend/src/services/http-input.service";
import {
  AuthenticationError,
  extractBearerToken,
  verifySupabaseAccessToken,
} from "@/backend/src/services/supabase-auth.service";
import { DEFAULT_OLLAMA_BASE_URL } from "@/backend/src/services/ollama-models";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const ollamaBaseUrl = (process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL).trim();
    const token = extractBearerToken(request);
    const startTime = Date.now();

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const supabasePublishableKey =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      "";

    const verifiedUser = await verifySupabaseAccessToken(token, {
      supabaseUrl,
      supabasePublishableKey,
    });

    const body = asRecord(await readJsonBody(request, 64 * 1024));

    // Client only determines message, conversational history, and UI current page
    const req: AiChatRequest = {
      message: typeof body.message === "string" ? body.message : "",
      history: Array.isArray(body.history) ? (body.history as AiChatRequest["history"]) : [],
      financialContext: null, // Client financial context is intentionally ignored for security
      currentPage: typeof body.currentPage === "string" ? body.currentPage : undefined,
    };

    // 1. Fast Intent Routing: Only load financial data from Supabase if needed!
    const routing = routeUserIntent(req.message, req.history, verifiedUser.id);

    // 2. Selective Context Building: Skip database completely for pure system/general queries!
    let serverContext = null;
    if (routing.requiresPersonalData || routing.requiresFinancialAnalysis) {
      try {
        serverContext = await buildServerFinancialContext(
          supabaseUrl,
          supabasePublishableKey,
          token,
          verifiedUser.id,
          req.message,
        );
      } catch (dbErr) {
        console.warn("Failed to load server financial context for chat:", dbErr);
      }
    }

    const processOpts = {
      serverContext,
      signal: request.signal,
      totalTimeoutMs: 60_000,
      toolContext: {
        supabaseUrl,
        supabaseKey: supabasePublishableKey,
        token,
        userId: verifiedUser.id,
        snapshot: serverContext?.snapshot,
        serverContext,
      },
    };

    const wantsStream =
      request.headers.get("accept")?.includes("text/event-stream") || body.stream === true;

    // 3. Streaming Response (Server-Sent Events)
    if (wantsStream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of processChatStream(ollamaBaseUrl, req, processOpts)) {
              if (chunk.error) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ error: chunk.error, status: chunk.status })}\n\n`),
                );
                break;
              }
              if (chunk.token || chunk.pendingAction || chunk.executedAction) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      token: chunk.token,
                      isFastPath: chunk.isFastPath,
                      pendingAction: chunk.pendingAction,
                      executedAction: chunk.executedAction,
                    })}\n\n`,
                  ),
                );
              }
              if (chunk.done) {
                controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
                break;
              }
            }
          } catch (streamErr: unknown) {
            const msg = streamErr instanceof Error ? streamErr.message : "Lỗi luồng phản hồi";
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`));
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
        },
      });
    }

    // 4. Standard JSON Response (Backward compatible for tests / non-streaming clients)
    const result = await processChat(ollamaBaseUrl, req, processOpts);

    const latencyMs = Date.now() - startTime;

    // Asynchronously log AI telemetry without blocking response
    import("@/backend/src/services/admin-ai.service")
      .then(({ recordAiUsageLog }) => {
        void recordAiUsageLog({
          userId: verifiedUser.id,
          feature: "chat",
          model: "ollama-local",
          success: !result.error,
          latencyMs,
          errorCode: result.error ? String(result.status) : null,
        });
      })
      .catch(() => {});

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(
      {
        reply: result.reply,
        isFastPath: result.isFastPath,
        pendingAction: result.pendingAction,
        executedAction: result.executedAction,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof AuthenticationError || err instanceof HttpInputError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof Error && err.name === "TimeoutError") {
      return NextResponse.json(
        { error: "Phản hồi đang mất nhiều thời gian hơn dự kiến. Vui lòng thử lại." },
        { status: 504 },
      );
    }
    console.error("Chat API error:", err);
    return NextResponse.json(
      { error: "Không thể kết nối với Trợ lý AI lúc này. Vui lòng thử lại." },
      { status: 500 },
    );
  }
}
