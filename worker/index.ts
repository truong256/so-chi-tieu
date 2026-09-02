/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { processChat } from "../backend/src/services/ai-chat.service";
import type { AiChatRequest } from "../backend/src/types/ai.types";
import { asRecord, HttpInputError, readJsonBody } from "../backend/src/services/http-input.service";
import { normalizeClientErrorReport } from "../backend/src/services/client-error.service";
import {
  AuthenticationError,
  extractBearerToken,
  verifySupabaseAccessToken,
} from "../backend/src/services/supabase-auth.service";

import { getExchangeRates } from "../backend/src/services/exchange-rate.service";

// Bổ sung type nội bộ do project không cài @cloudflare/workers-types
type Fetcher = { fetch: typeof fetch };
type D1Database = object;

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  GEMINI_API_KEY?: string;
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
      const supabasePublishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

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
        const geminiApiKey = (env.GEMINI_API_KEY || (typeof process !== "undefined" ? process.env.GEMINI_API_KEY : ""))?.trim() ?? "";

        const token = extractBearerToken(request);
        await verifySupabaseAccessToken(token, {
          supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL ?? "",
          supabasePublishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
        });

        const body = asRecord(await readJsonBody(request, 64 * 1024));

        const reqPayload: AiChatRequest = {
          message: typeof body.message === "string" ? body.message : "",
          history: Array.isArray(body.history) ? body.history as AiChatRequest["history"] : [],
          financialContext: body.financialContext as AiChatRequest["financialContext"] ?? null,
          currentPage: typeof body.currentPage === "string" ? body.currentPage : undefined,
          clientTime: typeof body.clientTime === "string" ? body.clientTime : undefined,
        };

        const result = await processChat(geminiApiKey, reqPayload);

        if (result.error) {
          return Response.json({ error: result.error }, { status: result.status });
        }

        return Response.json({ reply: result.reply }, { headers: { "Cache-Control": "no-store" } });
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
