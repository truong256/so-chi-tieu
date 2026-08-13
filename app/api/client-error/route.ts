import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { message?: unknown; digest?: unknown };
    console.error("Client runtime error", {
      message: typeof payload.message === "string" ? payload.message.slice(0, 500) : "Unknown client error",
      digest: typeof payload.digest === "string" ? payload.digest.slice(0, 200) : undefined,
    });
  } catch {
    console.error("Client runtime error report could not be parsed");
  }
  return new NextResponse(null, { status: 204 });
}
