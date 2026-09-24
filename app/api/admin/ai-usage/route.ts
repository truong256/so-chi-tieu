import { NextResponse } from "next/server";
import { extractBearerToken, AuthenticationError } from "@/backend/src/services/supabase-auth.service";
import { verifyAdminUser, AuthorizationError } from "@/backend/src/services/admin-auth.service";
import { getAiUsageStats } from "@/backend/src/services/admin-ai.service";

export async function GET(request: Request) {
  try {
    const token = extractBearerToken(request);
    await verifyAdminUser(token);

    const url = new URL(request.url);
    const periodParam = url.searchParams.get("period");
    const period: "today" | "7d" | "30d" =
      periodParam === "today" || periodParam === "30d" ? periodParam : "7d";

    const stats = await getAiUsageStats(period);
    return NextResponse.json(stats, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Admin AI usage API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Lỗi khi lấy số liệu AI." },
      { status: 500 },
    );
  }
}
