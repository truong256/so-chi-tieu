import { NextResponse } from "next/server";
import { asRecord, readJsonBody } from "@/backend/src/services/http-input.service";

export async function POST(request: Request) {
  try {
    const payload = asRecord(await readJsonBody(request, 4 * 1024));
    console.error("Client runtime error", {
      message: typeof payload.message === "string" ? payload.message.slice(0, 500) : "Unknown client error",
      digest: typeof payload.digest === "string" ? payload.digest.slice(0, 200) : undefined,
    });
  } catch {
    console.error("Client runtime error report could not be parsed");
  }
  return new NextResponse(null, { status: 204 });
}
