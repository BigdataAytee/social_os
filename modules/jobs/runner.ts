import { Platform, PostStatus } from "@prisma/client";

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

/**
 * Queue the nightly strategy recompute through the queue rather than inline.
 *
 * Day-bucketed like the other nightly work, which is what lets `tick` call it
 * on every invocation without doing it repeatedly — the idempotency key, not a
 * clock check, is what makes "once a day" true.
 */
export async function enqueueStrategyRecompute(): Promise<{ queued: number }> {
  const since = new Date(Date.now() - 26 * 60 * 60 * 1000);
  const orgs = await db.organization.findMany({
    where: {
      OR: [
        { connectedAccounts: { some: { lastSyncAt: { gte: since } } } },
        { posts: { some: { publishedAt: { gte: since } } } },
      ],
    },
    select: { id: true },
    take: 500,
  });

  const day = new Date().toISOString().slice(0, 10);
  const platforms = Object.values(Platform);

  for (const org of orgs) {
    for (const platform of platforms) {
      await enqueue({
        orgId: org.id,
        kind: "recompute-strategy",
        payload: { platform },
        idempotencyKey: `strategy:${org.id}:${platform}:${day}`,
        maxAttempts: 2,
      });
    }
  }

  return { queued: orgs.length * platforms.length };
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

/**
 * Queue an inbox pull for every connected account.
 *
 * A much tighter cadence than `enqueueStaleSyncs` — fifteen minutes rather than
 * six hours — because the cost of a stale analytics number is a slightly wrong
 * chart, and the cost of a stale inbox is a customer who was ignored.
 *
 * MOCK accounts are included on purpose: a demo org with no real connection
 * should still have an inbox with something in it, and the mock adapter derives
 * its items from that org's own posts.
 */
export async function enqueueInboxSyncs(
  everyMinutes = 15
): Promise<{ queued: number }> {
  const accounts = await db.connectedAccount.findMany({
    where: { status: { in: ["CONNECTED", "MOCK"] } },
    select: { id: true, orgId: true },
    take: 500,
  });

  // Bucketed to the cadence, so however often the cron fires, an account is
  // pulled at most once per window.
  const bucket = Math.floor(Date.now() / (everyMinutes * 60_000));

  for (const account of accounts) {
    await enqueue({
      orgId: account.orgId,
      kind: "sync-inbox",
      payload: { accountId: account.id },
      idempotencyKey: `inbox:${account.id}:${bucket}`,
      maxAttempts: 3,
    });
  }

  // One org's id is enough for a job that isn't org-scoped; it needs *an* org to
  // satisfy the foreign key, and the work it does is global. Skipped entirely
  // when there are no accounts, rather than inventing a row to hang it off.
  const anyOrg = accounts[0]?.orgId;
  if (anyOrg) {
    await enqueue({
      orgId: anyOrg,
      kind: "wake-snoozed",
      payload: {},
      idempotencyKey: `wake:${bucket}`,
      maxAttempts: 2,
    });
  }

  return { queued: accounts.length };
}

/**
 * Queue a competitor pull and a monitor scan for every org that tracks either.
 *
 * Daily rather than every fifteen minutes: a rival's posting habits move over
 * weeks, and pulling them hourly would spend rate limit on data that hasn't
 * changed. Monitors scan on the same schedule because a scan over unchanged
 * corpora finds unchanged matches.
 */
export async function enqueueListening(): Promise<{
  competitors: number;
  scans: number;
}> {
  const [competitors, orgs] = await Promise.all([
    db.competitor.findMany({ select: { id: true, orgId: true }, take: 500 }),
    db.organization.findMany({
      where: { monitors: { some: { active: true } } },
      select: { id: true },
      take: 500,
    }),
  ]);

  const day = new Date().toISOString().slice(0, 10);

  for (const competitor of competitors) {
    await enqueue({
      orgId: competitor.orgId,
      kind: "sync-competitor",
      payload: { competitorId: competitor.id },
      idempotencyKey: `competitor:${competitor.id}:${day}`,
      maxAttempts: 2,
    });
  }

  for (const org of orgs) {
    await enqueue({
      orgId: org.id,
      kind: "scan-monitors",
      payload: {},
      idempotencyKey: `scan:${org.id}:${day}`,
      maxAttempts: 2,
    });
  }

  return { competitors: competitors.length, scans: orgs.length };
}

/**
 * Nightly relearn: rebuild every active org's measured voice and search index.
 *
 * "Active" means it has content — an org that has never published has nothing
 * to learn from, and enqueueing for it burns a job slot to compute zeros.
 *
 * Day-bucketed idempotency keys mean the 03:00 cron can fire twice, or be
 * retried by hand, without doing the work twice.
 */
export async function enqueueRelearn(): Promise<{ queued: number }> {
  const orgs = await db.organization.findMany({
    where: {
      OR: [{ posts: { some: {} } }, { externalPosts: { some: {} } }],
    },
    select: { id: true },
    take: 500,
  });

  const day = new Date().toISOString().slice(0, 10);
  for (const org of orgs) {
    await enqueue({
      orgId: org.id,
      kind: "rebuild-brand-profile",
      payload: {},
      idempotencyKey: `brand-profile:${org.id}:${day}`,
      maxAttempts: 2,
    });
    await enqueue({
      orgId: org.id,
      kind: "reindex-memory",
      payload: {},
      idempotencyKey: `reindex:${org.id}:${day}`,
      maxAttempts: 2,
    });
  }

  return { queued: orgs.length * 2 };
}
