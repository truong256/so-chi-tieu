import { NextResponse } from "next/server";
import { extractBearerToken, AuthenticationError } from "@/backend/src/services/supabase-auth.service";
import { verifyAdminUser, AuthorizationError } from "@/backend/src/services/admin-auth.service";
import { suspendUser } from "@/backend/src/services/admin-users.service";
import { asRecord, readJsonBody } from "@/backend/src/services/http-input.service";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const token = extractBearerToken(request);
    const admin = await verifyAdminUser(token);

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: "Thiếu ID người dùng." }, { status: 400 });
    }

    let reason = "Tạm khóa bởi quản trị viên";
    try {
      const body = asRecord(await readJsonBody(request, 4 * 1024));
      if (typeof body.reason === "string" && body.reason.trim()) {
        reason = body.reason.trim().slice(0, 500);
      }
    } catch {
      // Empty body is acceptable
    }

    await suspendUser(admin.id, id, reason);
    return NextResponse.json({ success: true, message: "Đã tạm khóa tài khoản thành công." });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Admin suspend user API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Không thể tạm khóa tài khoản." },
      { status: 500 },
    );
  }
}
