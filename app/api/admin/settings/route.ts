import { NextResponse } from "next/server";
import { extractBearerToken, AuthenticationError } from "@/backend/src/services/supabase-auth.service";
import { verifyAdminUser, AuthorizationError } from "@/backend/src/services/admin-auth.service";
import { getSystemSettings, updateSystemSetting } from "@/backend/src/services/admin-settings.service";
import { asRecord, readJsonBody } from "@/backend/src/services/http-input.service";

export async function GET(request: Request) {
  try {
    const token = extractBearerToken(request);
    await verifyAdminUser(token);

    const settings = await getSystemSettings();
    return NextResponse.json(settings, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Admin settings GET API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Lỗi khi tải cài đặt hệ thống." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const token = extractBearerToken(request);
    const admin = await verifyAdminUser(token);

    const body = asRecord(await readJsonBody(request, 8 * 1024));
    const key = typeof body.key === "string" ? body.key.trim() : "";
    const value = body.value;

    if (!key) {
      return NextResponse.json({ error: "Khóa cài đặt không được để trống." }, { status: 400 });
    }

    await updateSystemSetting(admin.id, key, value);
    return NextResponse.json({ success: true, message: `Đã cập nhật cấu hình ${key}.` });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Admin settings PUT API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Không thể lưu cài đặt." },
      { status: 400 },
    );
  }
}
