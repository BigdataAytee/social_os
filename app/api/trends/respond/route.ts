import { NextResponse, type NextRequest } from "next/server";

import { getSessionResult } from "@/lib/auth/session";
import { respondToTrend } from "@/modules/trends/pipeline";

export const dynamic = "force-dynamic";
/** Five sequential generations; the default 15s would cut it off mid-fan-out. */
export const maxDuration = 120;

/**
 * POST /api/trends/respond (Platform-Native-Studios.md §2).
 *
 * Returns all five drafts for the review screen. Saves nothing — accepting a
 * draft is a separate, deliberate act.
 */
export async function POST(request: NextRequest) {
  const result = await getSessionResult();
  if (result.status !== "ok") {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: { trendEventId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }
  if (!body.trendEventId) {
    return NextResponse.json({ error: "trendEventId is required" }, { status: 400 });
  }

  try {
    return NextResponse.json(
      await respondToTrend(result.session, body.trendEventId)
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Fan-out failed" },
      { status: 400 }
    );
  }
}
