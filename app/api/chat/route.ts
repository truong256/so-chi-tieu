import { NextResponse } from "next/server";
import { processChat } from "@/backend/src/services/ai-chat.service";
import type { AiChatRequest } from "@/backend/src/types/ai.types";
import { asRecord, HttpInputError, readJsonBody } from "@/backend/src/services/http-input.service";
import {
  AuthenticationError,
  extractBearerToken,
  verifySupabaseAccessToken,
} from "@/backend/src/services/supabase-auth.service";

export async function POST(request: Request) {
  try {
    const geminiApiKey = process.env.GEMINI_API_KEY?.trim() ?? "";
    const token = extractBearerToken(request);
    await verifySupabaseAccessToken(token, {
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      supabasePublishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    });

    const body = asRecord(await readJsonBody(request, 64 * 1024));

    const req: AiChatRequest = {
      message: typeof body.message === "string" ? body.message : "",
      history: Array.isArray(body.history) ? body.history as AiChatRequest["history"] : [],
      financialContext: body.financialContext as AiChatRequest["financialContext"] ?? null,
      currentPage: typeof body.currentPage === "string" ? body.currentPage : undefined,
      clientTime: typeof body.clientTime === "string" ? body.clientTime : undefined,
    };

    const result = await processChat(geminiApiKey, req);

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ reply: result.reply }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof AuthenticationError || err instanceof HttpInputError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof Error && err.name === "TimeoutError") {
      return NextResponse.json(
        { error: "Phản hồi đang mất nhiều thời gian hơn dự kiến. Vui lòng thử lại." },
        { status: 504 }
      );
    }
    console.error("Chat API error:", err);
    return NextResponse.json(
      { error: "Không thể kết nối với Trợ lý AI. Vui lòng thử lại." },
      { status: 500 }
    );
  }
}
