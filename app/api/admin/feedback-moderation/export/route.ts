/**
 * app/api/admin/feedback-moderation/export/route.ts
 * =================================================
 * Admin-only endpoint for exporting approved, consent-granted AI training data.
 *
 * GET /api/admin/feedback-moderation/export?version=v1.0
 */

import { NextResponse } from "next/server";
import { extractBearerToken, AuthenticationError } from "@/backend/src/services/supabase-auth.service";
import { verifyAdminUser, AuthorizationError } from "@/backend/src/services/admin-auth.service";
import { exportCuratedDataset } from "@/backend/src/services/feedback-moderation.service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const token = extractBearerToken(request);
    await verifyAdminUser(token);

    const url = new URL(request.url);
    const version = url.searchParams.get("version") || "v1.0";

    const dataset = await exportCuratedDataset(version);

    return NextResponse.json(dataset, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="curated_feedback_${version}.json"`,
      },
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Admin dataset export GET error:", error);
    return NextResponse.json({ error: "Lỗi khi xuất tập dữ liệu huấn luyện." }, { status: 500 });
  }
}
