/**
 * app/api/admin/feedback-moderation/route.ts
 * ==========================================
 * Admin-only API for reviewing AI classification feedback moderation queue.
 *
 * GET /api/admin/feedback-moderation
 * - Returns list of samples awaiting review or already reviewed, plus queue stats.
 *
 * POST /api/admin/feedback-moderation
 * - Allows an Admin to approve or reject a sample.
 */

import { NextResponse } from "next/server";
import { extractBearerToken, AuthenticationError } from "@/backend/src/services/supabase-auth.service";
import { verifyAdminUser, AuthorizationError } from "@/backend/src/services/admin-auth.service";
import {
  getAllModerationSamples,
  getModerationStats,
  moderateSample,
} from "@/backend/src/services/feedback-moderation.service";
import { asRecord, readJsonBody, HttpInputError } from "@/backend/src/services/http-input.service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const token = extractBearerToken(request);
    await verifyAdminUser(token);

    const url = new URL(request.url);
    const statusParam = url.searchParams.get("status");

    const [allSamples, stats] = await Promise.all([
      getAllModerationSamples(),
      getModerationStats(),
    ]);

    let filtered = allSamples;
    if (statusParam && (statusParam === "pending" || statusParam === "approved" || statusParam === "rejected")) {
      filtered = allSamples.filter((s) => s.status === statusParam);
    }

    return NextResponse.json({
      stats,
      samples: filtered.slice(-100).reverse(), // latest 100 samples
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Admin feedback moderation GET error:", error);
    return NextResponse.json({ error: "Lỗi khi lấy hàng đợi kiểm duyệt." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const token = extractBearerToken(request);
    const adminUser = await verifyAdminUser(token);

    const body = asRecord(await readJsonBody(request, 4 * 1024));
    const sampleId = typeof body.sample_id === "string" ? body.sample_id.trim() : "";
    const decision = typeof body.decision === "string" ? body.decision.trim().toLowerCase() : "";
    const notes = typeof body.notes === "string" ? body.notes.trim() : undefined;

    if (!sampleId) {
      return NextResponse.json({ error: "Thiếu sample_id." }, { status: 400 });
    }
    if (decision !== "approve" && decision !== "reject") {
      return NextResponse.json({ error: "Quyết định không hợp lệ (phải là 'approve' hoặc 'reject')." }, { status: 400 });
    }

    const updated = await moderateSample(sampleId, decision as "approve" | "reject", adminUser.id, notes);
    if (!updated) {
      return NextResponse.json({ error: "Không tìm thấy mẫu cần kiểm duyệt." }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      sample: updated,
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof HttpInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Admin feedback moderation POST error:", error);
    return NextResponse.json({ error: "Lỗi khi cập nhật kiểm duyệt." }, { status: 500 });
  }
}
