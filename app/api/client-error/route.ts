import { NextResponse } from "next/server";
import { asRecord, readJsonBody } from "@/backend/src/services/http-input.service";
import { normalizeClientErrorReport } from "@/backend/src/services/client-error.service";

export async function POST(request: Request) {
  try {
    const payload = asRecord(await readJsonBody(request, 4 * 1024));
    console.error("Client runtime error", normalizeClientErrorReport(payload));
  } catch {
    console.error("Client runtime error report could not be parsed");
  }
  return new NextResponse(null, { status: 204 });
}
