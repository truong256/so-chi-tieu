/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { processChat, processChatStream } from "../backend/src/services/ai-chat.service";
import { executeConfirmedCrudAction } from "../backend/src/services/ai-crud-tools.service";
import {
  DEFAULT_RECURRING_TIMEZONE,
  processDueRecurringTransactions,
} from "../backend/src/services/recurring-scheduler.service";
import { routeUserIntent } from "../backend/src/services/ai-router.service";
import { DEFAULT_OLLAMA_BASE_URL } from "../backend/src/services/ollama-models";
import type { AiChatRequest, CrudActionType } from "../backend/src/types/ai.types";
import { asRecord, HttpInputError, readJsonBody } from "../backend/src/services/http-input.service";
import { normalizeClientErrorReport } from "../backend/src/services/client-error.service";
import {
  AuthenticationError,
  extractBearerToken,
  verifySupabaseAccessToken,
} from "../backend/src/services/supabase-auth.service";

import { getExchangeRates } from "../backend/src/services/exchange-rate.service";
import { buildServerFinancialContext } from "../backend/src/services/financial-context.service";

// Bổ sung type nội bộ do project không cài @cloudflare/workers-types
type Fetcher = { fetch: typeof fetch };
type D1Database = object;

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  OLLAMA_BASE_URL?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/client-error" && request.method === "POST") {
      try {
        const payload = asRecord(await readJsonBody(request, 4 * 1024));
        console.error("Client runtime error", normalizeClientErrorReport(payload));
      } catch {
        console.error("Client runtime error report could not be parsed");
      }
      return new Response(null, { status: 204 });
    }

    if (url.pathname === "/api/runtime-config") {
      const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
      const supabasePublishableKey = (
        env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
        (env as unknown as Record<string, string | undefined>).NEXT_PUBLIC_SUPABASE_ANON_KEY
      )?.trim();

      if (!supabaseUrl || !supabasePublishableKey) {
        return Response.json(
          { error: "Supabase runtime configuration is unavailable." },
          { status: 503, headers: { "Cache-Control": "no-store" } },
        );
      }

      return Response.json(
        { supabaseUrl, supabasePublishableKey },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (url.pathname === "/api/exchange-rates" && request.method === "GET") {
      try {
        const ratesData = await getExchangeRates();
        return Response.json(ratesData, {
          headers: {
            "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
          },
        });
      } catch (err) {
        console.error("Worker exchange rates error:", err);
        return Response.json({ error: "Failed to fetch exchange rates" }, { status: 500 });
      }
    }

    // --- AI CHAT ENDPOINT ---
    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        const ollamaBaseUrl = (env.OLLAMA_BASE_URL || (typeof process !== "undefined" ? process.env.OLLAMA_BASE_URL : "") || DEFAULT_OLLAMA_BASE_URL).trim();

        const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_SUPABASE_URL : "") || "";
        const supabasePublishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || (typeof process !== "undefined" ? (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) : "") || "";

        const token = extractBearerToken(request);
        const verifiedUser = await verifySupabaseAccessToken(token, {
          supabaseUrl,
          supabasePublishableKey,
        });

        const body = asRecord(await readJsonBody(request, 64 * 1024));

        const reqPayload: AiChatRequest = {
          message: typeof body.message === "string" ? body.message : "",
          history: Array.isArray(body.history) ? body.history as AiChatRequest["history"] : [],
          financialContext: null,
          currentPage: typeof body.currentPage === "string" ? body.currentPage : undefined,
          clientTime: typeof body.clientTime === "string" ? body.clientTime : undefined,
        };

        // 1. Fast Intent Routing
        const routing = routeUserIntent(reqPayload.message, reqPayload.history, verifiedUser.id);

        // 2. Selective Context Building: Skip database completely for pure system/general queries!
        let serverContext = null;
        if (routing.requiresPersonalData || routing.requiresFinancialAnalysis) {
          try {
            serverContext = await buildServerFinancialContext(
              supabaseUrl,
              supabasePublishableKey,
              token,
              verifiedUser.id,
              reqPayload.message,
            );
          } catch (dbErr) {
            console.warn("Failed to load server financial context for worker chat:", dbErr);
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

        if (wantsStream) {
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            async start(controller) {
              try {
                for await (const chunk of processChatStream(ollamaBaseUrl, reqPayload, processOpts)) {
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

        const result = await processChat(ollamaBaseUrl, reqPayload, processOpts);

        if (result.error) {
          return Response.json({ error: result.error }, { status: result.status });
        }

        return Response.json(
          {
            reply: result.reply,
            isFastPath: result.isFastPath,
            pendingAction: result.pendingAction,
            executedAction: result.executedAction,
          },
          { headers: { "Cache-Control": "no-store" } }
        );
      } catch (err) {
        if (err instanceof AuthenticationError || err instanceof HttpInputError) {
          return Response.json({ error: err.message }, { status: err.status });
        }
        if (err instanceof Error && err.name === "TimeoutError") {
          return Response.json(
            { error: "Phản hồi đang mất nhiều thời gian hơn dự kiến. Vui lòng thử lại." },
            { status: 504 }
          );
        }
        console.error("Chat API error:", err);
        return Response.json(
          { error: "Không thể kết nối với Trợ lý AI. Vui lòng thử lại." },
          { status: 500 }
        );
      }
    }
    // --- END AI CHAT ENDPOINT ---

    // --- AI CRUD EXECUTE-ACTION ENDPOINT ---
    if (url.pathname === "/api/chat/execute-action" && request.method === "POST") {
      try {
        const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_SUPABASE_URL : "") || "";
        const supabasePublishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || (typeof process !== "undefined" ? (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) : "") || "";

        const token = extractBearerToken(request);
        const verifiedUser = await verifySupabaseAccessToken(token, {
          supabaseUrl,
          supabasePublishableKey,
        });

        const body = asRecord(await readJsonBody(request, 32 * 1024));
        const allowedActionTypes = new Set<CrudActionType>([
          "create_category",
          "create_budget",
          "create_transaction",
          "create_recurring_transaction",
        ]);
        const rawActionType = typeof body.actionType === "string" ? body.actionType.trim() : "";
        const actionType = allowedActionTypes.has(rawActionType as CrudActionType)
          ? (rawActionType as CrudActionType)
          : undefined;

        const result = await executeConfirmedCrudAction(
          {
            supabaseUrl,
            supabaseKey: supabasePublishableKey,
            token,
            userId: verifiedUser.id,
          },
          {
            actionId: typeof body.actionId === "string" ? body.actionId.trim() : undefined,
            idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "",
            actionType,
            payload:
              body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
                ? (body.payload as Record<string, unknown>)
                : undefined,
            cancel: body.cancel === true,
          },
        );

        return Response.json(
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
          return Response.json({ success: false, error: err.message, reply: err.message }, { status: err.status });
        }
        console.error("Worker execute-action error:", err);
        return Response.json(
          {
            success: false,
            error: "Không thể thực hiện thao tác lúc này. Vui lòng thử lại.",
            reply: "Không thể thực hiện thao tác lúc này. Vui lòng thử lại.",
          },
          { status: 500 },
        );
      }
    }
    // --- END AI CRUD EXECUTE-ACTION ENDPOINT ---

    // --- RECURRING SCHEDULER PROCESS ENDPOINT ---
    if (url.pathname === "/api/recurring/process" && request.method === "POST") {
      try {
        const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_SUPABASE_URL : "") || "";
        const supabasePublishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || (typeof process !== "undefined" ? (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) : "") || "";

        const token = extractBearerToken(request);
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
          { timeZone, scheduleId },
        );

        if (!summary.success) {
          return Response.json(
            { error: summary.error || "Không thể xử lý lịch định kỳ.", ...summary },
            { status: 400, headers: { "Cache-Control": "no-store" } },
          );
        }

        return Response.json(summary, {
          status: 200,
          headers: { "Cache-Control": "no-store" },
        });
      } catch (err) {
        if (err instanceof AuthenticationError || err instanceof HttpInputError) {
          return Response.json({ error: err.message }, { status: err.status });
        }
        console.error("Worker recurring process error:", err);
        return Response.json(
          { error: "Lỗi máy chủ khi xử lý giao dịch định kỳ." },
          { status: 500 },
        );
      }
    }
    // --- END RECURRING SCHEDULER PROCESS ENDPOINT ---

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
