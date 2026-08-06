import { NextResponse } from "next/server";

import { getSessionResult } from "@/lib/auth/session";
import { parsePlatformSlug } from "@/lib/studios";
import { listRecommendations } from "@/modules/strategy/engine";

export const dynamic = "force-dynamic";

/** GET /api/strategy/:platform — current recommendations for a Studio (§5). */
export async function GET(
  _request: Request,
  { params }: { params: { platform: string } }
) {
  const platform = parsePlatformSlug(params.platform);
  if (!platform) {
    return NextResponse.json({ error: "Unknown platform" }, { status: 404 });
  }

  const result = await getSessionResult();
  if (result.status !== "ok") {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const rows = await listRecommendations(result.session, platform);
  return NextResponse.json({
    platform,
    recommendations: rows.map((row) => ({
      type: row.type,
      payload: row.payload,
      confidence: row.confidence,
      basedOnDataThrough: row.basedOnDataThrough,
      generatedAt: row.generatedAt,
    })),
  });
}
