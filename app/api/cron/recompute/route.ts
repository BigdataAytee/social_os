import { NextResponse, type NextRequest } from "next/server";
import { Platform } from "@prisma/client";

import { db } from "@/lib/db";
import { recomputePlatform } from "@/modules/strategy/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The nightly recompute (Growth-Strategist-Engine.md §2).
 *
 * v1 trigger: recompute for every org with new analytics or newly-published
 * posts since the last run. §2 notes a staleness flag would be cheaper once
 * there are enough inactive orgs to make nightly-for-everyone wasteful — that's
 * an optimisation, deliberately not built yet.
 *
 * Only the two aggregations run here. The briefing is the one LLM call in the
 * system and would cost five model calls per org per night; it's generated on
 * demand from the Studio instead.
 */
export async function GET(request: NextRequest) {
  // Vercel signs cron invocations with this header. Without the check the
  // endpoint is an unauthenticated way to make every org do work.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const since = new Date(Date.now() - 26 * 60 * 60 * 1000);
  const orgs = await db.organization.findMany({
    where: {
      OR: [
        { connectedAccounts: { some: { lastSyncAt: { gte: since } } } },
        { posts: { some: { publishedAt: { gte: since } } } },
      ],
    },
    select: { id: true },
  });

  let recomputed = 0;
  const failed: string[] = [];

  for (const org of orgs) {
    for (const platform of Object.values(Platform)) {
      try {
        await recomputePlatform(org.id, platform);
        recomputed += 1;
      } catch (error) {
        // One org's bad data must not stop the rest of the night's work.
        failed.push(
          `${org.id}/${platform}: ${error instanceof Error ? error.message : "failed"}`
        );
      }
    }
  }

  return NextResponse.json({ orgs: orgs.length, recomputed, failed });
}
