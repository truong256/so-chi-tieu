import { NextResponse } from "next/server";
import { extractBearerToken, AuthenticationError } from "@/backend/src/services/supabase-auth.service";
import { verifyAdminUser, AuthorizationError } from "@/backend/src/services/admin-auth.service";
import { getAdminUserDetail } from "@/backend/src/services/admin-users.service";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const token = extractBearerToken(request);
    await verifyAdminUser(token);

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: "Thiếu ID người dùng." }, { status: 400 });
    }

    const user = await getAdminUserDetail(id);
    return NextResponse.json(user, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Admin user detail API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Không tìm thấy người dùng." },
      { status: 404 },
    );
  }
}
