import { NextResponse } from "next/server";
import { getExchangeRates } from "@/backend/src/services/exchange-rate.service";

// Rates require live network access, so never execute this route during a build.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getExchangeRates();
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    console.error("Exchange rates route error:", error);
    return NextResponse.json(
      { error: "Could not fetch exchange rates" },
      { status: 500 }
    );
  }
}
