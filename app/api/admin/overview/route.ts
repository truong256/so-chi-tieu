import { NextResponse } from "next/server";
import { extractBearerToken, AuthenticationError } from "@/backend/src/services/supabase-auth.service";
import { verifyAdminUser, AuthorizationError } from "@/backend/src/services/admin-auth.service";
import { getAdminOverviewMetrics } from "@/backend/src/services/admin-metrics.service";

export async function GET(request: Request) {
  try {
    const token = extractBearerToken(request);
    await verifyAdminUser(token);

    const metrics = await getAdminOverviewMetrics();
    return NextResponse.json(metrics, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Admin overview API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Lỗi tải số liệu tổng quan hệ thống." },
      { status: 500 },
    );
  }
}
