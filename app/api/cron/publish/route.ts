import { NextResponse, type NextRequest } from "next/server";

import { cronAuthorized } from "@/lib/cron-auth";
import {
  enqueueDuePosts,
  enqueueInboxSyncs,
  enqueueStaleSyncs,
} from "@/modules/jobs/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Queue what's due (OS-ARCHITECTURE.md §11 stage 2).
 *
 * Scheduling only — the actual publishing happens in `/api/cron/jobs`, so a
 * slow platform can't stop the next post from being noticed.
 */
export async function GET(request: NextRequest) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const [posts, syncs, inbox] = await Promise.all([
    enqueueDuePosts(),
    enqueueStaleSyncs(),
    enqueueInboxSyncs(),
  ]);
  return NextResponse.json({ posts, syncs, inbox });
}
