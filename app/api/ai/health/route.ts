/**
 * app/api/ai/health/route.ts
 * ==========================
 * GET /api/ai/health
 *
 * Exposes detailed AI service status and model readiness.
 * Distinguishes SERVICE_UP from MODEL_READY, MODEL_LOAD_FAILED, and MODEL_MISSING.
 * Never treats HTTP 200 as proof that models have loaded.
 */

import { NextResponse } from "next/server";
import { aiDetailedHealthCheck } from "@/backend/src/services/ai-local.client";

export const runtime = "nodejs";

export async function GET() {
  const health = await aiDetailedHealthCheck();

  const httpStatus = health.status === "SERVICE_UP" ? 200 : 503;

  return NextResponse.json(
    {
      ok: health.status === "SERVICE_UP" && health.model_readiness === "MODEL_READY",
      ...health,
    },
    {
      status: httpStatus,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
