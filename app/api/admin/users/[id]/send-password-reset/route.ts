import { NextResponse } from "next/server";
import { extractBearerToken, AuthenticationError } from "@/backend/src/services/supabase-auth.service";
import { verifyAdminUser, AuthorizationError } from "@/backend/src/services/admin-auth.service";
import { sendUserPasswordReset } from "@/backend/src/services/admin-users.service";

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

    const result = await sendUserPasswordReset(admin.id, id);
    return NextResponse.json({
      success: true,
      message: "Đã tạo liên kết đặt lại mật khẩu thành công.",
      resetLink: result.resetLink,
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Admin send password reset API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Không thể gửi liên kết đặt lại mật khẩu." },
      { status: 500 },
    );
  }
}
