import { NextResponse } from "next/server";
import { extractBearerToken, AuthenticationError } from "@/backend/src/services/supabase-auth.service";
import { verifyAdminUser, AuthorizationError } from "@/backend/src/services/admin-auth.service";
import { getAdminAuditLogs } from "@/backend/src/services/admin-audit.service";

export async function GET(request: Request) {
  try {
    const token = extractBearerToken(request);
    await verifyAdminUser(token);

    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10)));
    const action = url.searchParams.get("action") || undefined;
    const search = url.searchParams.get("search") || undefined;

    const result = await getAdminAuditLogs({
      page,
      limit,
      action,
      search,
    });

    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Admin audit logs API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Lỗi khi lấy nhật ký kiểm toán." },
      { status: 500 },
    );
  }
}
