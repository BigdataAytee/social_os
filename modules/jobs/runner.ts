import { PostStatus } from "@prisma/client";

import { db } from "@/lib/db";
import { handlerFor } from "./handlers";
import { claim, enqueue, fail, succeed } from "./service";

/**
 * The worker loop and the schedulers that feed it
 * (OS-ARCHITECTURE.md §11 stages 1–2).
 *
 * Split from `service.ts` because the queue mechanics are worth testing without
 * dragging every handler's dependencies in with them.
 */

export type DrainResult = {
  claimed: number;
  succeeded: number;
  failed: number;
  details: string[];
};

/**
 * Run whatever is due. Called by `/api/cron/jobs` every minute.
 *
 * One job failing must never stop the rest — a single org's revoked token
 * would otherwise hold up every other org's publishing.
 */
export async function drain(limit = 20): Promise<DrainResult> {
  const jobs = await claim(limit);
  const result: DrainResult = {
    claimed: jobs.length,
    succeeded: 0,
    failed: 0,
    details: [],
  };

  for (const job of jobs) {
    const handler = handlerFor(job.kind);
    if (!handler) {
      // An unknown kind is a deploy problem, not a transient one. Fail it so it
      // backs off and eventually goes DEAD rather than spinning every minute.
      await fail(job.id, new Error(`No handler for job kind "${job.kind}"`));
      result.failed += 1;
      result.details.push(`${job.kind}: no handler`);
      continue;
    }

    try {
      const outcome = await handler(job);
      await succeed(job.id);
      result.succeeded += 1;
      result.details.push(`${job.kind}: ${outcome.summary}`);
    } catch (error) {
      await fail(job.id, error);
      result.failed += 1;
      result.details.push(
        `${job.kind}: ${error instanceof Error ? error.message : "failed"}`
      );
    }
  }

  return result;
}

/**
 * Find posts whose scheduled time has arrived and queue them.
 *
 * Separate from `drain` so the two can run at different cadences, and so a
 * scheduling bug can't take the whole queue down with it.
 *
 * The window looks *backwards* as well as forwards: a cron that missed a run —
 * a deploy, an outage — must still publish what fell due while it was away,
 * rather than silently skipping it. `GRACE_MS` bounds how far back, so an app
 * that was down for a week doesn't wake up and publish a week of posts at once.
 */
const GRACE_MS = 60 * 60 * 1000;

export async function enqueueDuePosts(): Promise<{
  queued: number;
  skipped: number;
}> {
  const now = new Date();
  const due = await db.post.findMany({
    where: {
      status: PostStatus.SCHEDULED,
      scheduledAt: {
        lte: now,
        gte: new Date(now.getTime() - GRACE_MS),
      },
    },
    select: { id: true, orgId: true, scheduledAt: true },
    take: 200,
  });

  let queued = 0;
  for (const post of due) {
    await enqueue({
      orgId: post.orgId,
      kind: "publish-post",
      payload: { postId: post.id },
      // Keyed on the post *and* its scheduled time: re-queueing the same post
      // for the same slot is a no-op, but rescheduling it genuinely queues
      // again. Without the timestamp, a moved post would never publish twice.
      idempotencyKey: `publish:${post.id}:${post.scheduledAt?.toISOString()}`,
      maxAttempts: 4,
    });
    // QUEUED is the state between "the human said so" and "the platform has
    // it" — it exists in PostStatus and until now nothing ever set it.
    await db.post.update({
      where: { id: post.id },
      data: { status: PostStatus.QUEUED },
    });
    queued += 1;
  }

  // Anything that fell due while we were away, beyond the grace window. Left
  // SCHEDULED and reported rather than published late — a post whose moment
  // passed hours ago is a decision for a person, not a cron.
  const skipped = await db.post.count({
    where: {
      status: PostStatus.SCHEDULED,
      scheduledAt: { lt: new Date(now.getTime() - GRACE_MS) },
    },
  });

  return { queued, skipped };
}

/** Queue a refresh for every connected account that hasn't synced recently. */
export async function enqueueStaleSyncs(
  olderThanHours = 6
): Promise<{ queued: number }> {
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
  const accounts = await db.connectedAccount.findMany({
    where: {
      status: "CONNECTED",
      credential: { isNot: null },
      OR: [{ lastSyncAt: null }, { lastSyncAt: { lt: cutoff } }],
    },
    select: { id: true, orgId: true },
    take: 200,
  });

  for (const account of accounts) {
    await enqueue({
      orgId: account.orgId,
      kind: "sync-account",
      payload: { accountId: account.id },
      // Hour-bucketed: at most one sync per account per hour however often the
      // scheduler runs.
      idempotencyKey: `sync:${account.id}:${new Date().toISOString().slice(0, 13)}`,
      maxAttempts: 3,
    });
  }

  return { queued: accounts.length };
}
