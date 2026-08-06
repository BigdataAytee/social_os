import { NextResponse, type NextRequest } from "next/server";

import { getSessionResult } from "@/lib/auth/session";
import { predictEngagement } from "@/modules/strategy/predict";

export const dynamic = "force-dynamic";

/**
 * POST /api/strategy/predict (§5) — engagement prediction for a specific draft,
 * called from the schedule modal before confirming.
 */
export async function POST(request: NextRequest) {
  const result = await getSessionResult();
  if (result.status !== "ok") {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  try {
    const body = await request.json();
    return NextResponse.json(
      await predictEngagement(result.session, {
        platform: body.platform,
        body: String(body.body ?? ""),
        platformData: body.platformData ?? {},
        scheduledAt: body.scheduledAt ?? null,
      })
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Prediction failed" },
      { status: 400 }
    );
  }
}
