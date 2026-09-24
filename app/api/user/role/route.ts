import { NextResponse } from "next/server";
import { extractBearerToken, AuthenticationError } from "@/backend/src/services/supabase-auth.service";
import { getUserRole } from "@/backend/src/services/admin-auth.service";

export async function GET(request: Request) {
  try {
    const token = extractBearerToken(request);
    const role = await getUserRole(token);

    return NextResponse.json({ role }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("User role check error:", error);
    // Safe fallback to 'user' role
    return NextResponse.json({ role: "user" }, { headers: { "Cache-Control": "no-store" } });
  }
}
