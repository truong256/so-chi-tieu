import { NextResponse } from "next/server";
import { extractBearerToken, AuthenticationError } from "@/backend/src/services/supabase-auth.service";
import { verifyAdminUser, AuthorizationError } from "@/backend/src/services/admin-auth.service";
import { sendSystemNotification } from "@/backend/src/services/admin-notifications.service";
import { asRecord, readJsonBody } from "@/backend/src/services/http-input.service";

export async function POST(request: Request) {
  try {
    const token = extractBearerToken(request);
    const admin = await verifyAdminUser(token);

    const body = asRecord(await readJsonBody(request, 16 * 1024));
    const title = typeof body.title === "string" ? body.title : "";
    const message = typeof body.message === "string" ? body.message : "";
    const target = body.target === "all" || Array.isArray(body.target) ? body.target : "all";

    const result = await sendSystemNotification(admin.id, {
      title,
      message,
      target,
    });

    return NextResponse.json({
      success: true,
      message: `Đã phát thông báo thành công đến ${result.sentCount} người dùng.`,
      sentCount: result.sentCount,
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Admin notifications POST API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Không thể gửi thông báo." },
      { status: 400 },
    );
  }
}
