import { NextResponse } from "next/server";
import { processChat } from "@/backend/src/services/ai-chat.service";
import type { AiChatRequest } from "@/backend/src/types/ai.types";

export async function POST(request: Request) {
  try {
    const geminiApiKey = process.env.GEMINI_API_KEY?.trim() ?? "";

    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as Partial<AiChatRequest>;

    const req: AiChatRequest = {
      message: body.message ?? "",
      history: body.history ?? [],
      financialContext: body.financialContext ?? null,
      currentPage: body.currentPage,
      clientTime: body.clientTime,
    };

    const result = await processChat(geminiApiKey, req);

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ reply: result.reply }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
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
