import { NextResponse, type NextRequest } from "next/server";

import { cronAuthorized } from "@/lib/cron-auth";
import {
  drain,
  enqueueDuePosts,
  enqueueInboxSyncs,
  enqueueListening,
  enqueueRelearn,
  enqueueStaleSyncs,
  enqueueStrategyRecompute,
} from "@/modules/jobs/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * One endpoint that runs the whole cycle.
 *
 * **Why this exists rather than three separate crons.** Vercel's Hobby plan
 * allows two cron jobs, each triggered once a day. The three minute-resolution
 * crons stage 1 declared are a Pro-plan configuration, and on Hobby they don't
 * merely degrade — Vercel rejects the whole deployment at config validation,
 * before the build, which is exactly what happened: five pushes in a row
 * reported "Deployment failed" with no build log to read, because there was no
 * build.
 *
 * So the scheduled surface is one path, and `vercel.json` declares one daily
 * cron against it. That deploys on any plan. Real cadence then comes from
 * whatever can call this more often — the GitHub Actions workflow in this repo,
 * an uptime pinger, or a Pro-plan cron — and none of those need a code change.
 *
 * **Every step is idempotent, which is what makes one path safe at any
 * frequency.** The enqueue helpers key their work by day, hour or bucket, so
 * calling this every minute does the nightly work once and the per-minute work
 * every minute. There is no clock branching here deciding what "should" run
 * now; the idempotency keys are the schedule. That is also why a missed hour
 * costs nothing — the next call picks up whatever didn't happen.
 *
 * Ordering matters and is deliberate: everything enqueues first, then one drain
 * runs what was just queued, so a single invocation takes a due post all the
 * way to published rather than leaving it for the next one.
 */
export async function GET(request: NextRequest) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const queued: Record<string, unknown> = {};
  const failed: string[] = [];

  // Each scheduler is settled independently. One of them throwing — a bad row,
  // a migration mid-flight — must not stop the drain, because the drain is what
  // actually publishes people's posts.
  const steps: [string, () => Promise<unknown>][] = [
    ["posts", enqueueDuePosts],
    ["inbox", enqueueInboxSyncs],
    ["syncs", enqueueStaleSyncs],
    ["strategy", enqueueStrategyRecompute],
    ["relearn", enqueueRelearn],
    ["listening", enqueueListening],
  ];

  for (const [name, step] of steps) {
    try {
      queued[name] = await step();
    } catch (error) {
      failed.push(`${name}: ${error instanceof Error ? error.message : "failed"}`);
    }
  }

  const drained = await drain();

  return NextResponse.json({ queued, drained, failed });
}
