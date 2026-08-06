import { NextResponse, type NextRequest } from "next/server";

import { cronAuthorized } from "@/lib/cron-auth";
import { drain } from "@/modules/jobs/runner";

export const dynamic = "force-dynamic";
/** A drain can publish twenty posts; the default would cut it off mid-batch. */
export const maxDuration = 300;

/** Drain the job queue. Runs every minute (OS-ARCHITECTURE.md §11 stage 1). */
export async function GET(request: NextRequest) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await drain());
}
