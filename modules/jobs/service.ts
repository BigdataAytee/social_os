import { JobStatus, Prisma } from "@prisma/client";

import { db } from "@/lib/db";

/**
 * The durable job queue (OS-ARCHITECTURE.md §11 stage 1).
 *
 * Everything the app needs to do *on its own* runs through here: publishing a
 * scheduled post when its time arrives, refreshing an account, running a
 * listening query, firing an automation. Before this the app could only act
 * while somebody was looking at it.
 *
 * Three properties matter more than throughput:
 *
 *   1. **A claim can't be lost.** Claiming sets `claimedAt`; a claim older than
 *      the lease is reclaimable, so a worker that dies mid-job doesn't strand
 *      it forever. The alternative — trusting workers to release — loses work
 *      exactly when the system is already unhealthy.
 *   2. **Retries back off.** A platform that just rate-limited us will still be
 *      rate-limiting us a second later, and hammering it turns a delay into a
 *      ban.
 *   3. **Failures are kept, not deleted.** A DEAD job is the most interesting
 *      row in the table. Deleting it hides the outage that produced it.
 */

/** How long a worker may hold a claim before it's considered abandoned. */
const LEASE_MS = 5 * 60 * 1000;

/** Exponential with a ceiling: 1m, 2m, 4m, 8m, 16m, then 16m forever. */
function backoffMs(attempts: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 16 * 60_000);
}

export type EnqueueInput = {
  orgId: string;
  kind: string;
  payload?: Record<string, unknown>;
  /** Not before this time. Defaults to now. */
  runAfter?: Date;
  maxAttempts?: number;
  /**
   * Dedupe key. Enqueuing the same key twice while one is still outstanding is
   * a no-op — which is what stops a cron that fires twice, or a retry that
   * races the original, from publishing the same post twice.
   */
  idempotencyKey?: string;
};

export async function enqueue(input: EnqueueInput) {
  const data = {
    orgId: input.orgId,
    kind: input.kind,
    payload: (input.payload ?? {}) as Prisma.InputJsonValue,
    runAfter: input.runAfter ?? new Date(),
    maxAttempts: input.maxAttempts ?? 5,
    idempotencyKey: input.idempotencyKey ?? null,
  };

  if (!input.idempotencyKey) return db.job.create({ data });

  // Look first, even though the constraint would catch it. The common case for
  // a dedupe key is that the work *is* already queued, and letting that hit the
  // unique violation logs a Prisma error on every ordinary scheduler tick —
  // which teaches everyone to ignore the error log. The catch below still
  // handles the genuine race.
  const already = await db.job.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (already) return already;

  try {
    return await db.job.create({ data });
  } catch (error) {
    // Unique violation on the key: something already queued this exact work.
    // Returning the existing row rather than throwing means callers don't have
    // to distinguish "I enqueued it" from "it was already enqueued" — both mean
    // the work will happen.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await db.job.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) return existing;
    }
    throw error;
  }
}

/**
 * Claim up to `limit` jobs that are due.
 *
 * The claim is a conditional update, not a read-then-write: two workers running
 * the same cron minute must not both get the same job. `updateMany` with the
 * status in the WHERE clause makes the database arbitrate.
 */
export async function claim(limit = 20) {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - LEASE_MS);

  const candidates = await db.job.findMany({
    where: {
      runAfter: { lte: now },
      OR: [
        { status: JobStatus.PENDING },
        // Reclaim what a dead worker was holding.
        { status: JobStatus.CLAIMED, claimedAt: { lt: staleBefore } },
      ],
    },
    orderBy: { runAfter: "asc" },
    take: limit,
    select: { id: true, status: true },
  });

  const claimed = [];
  for (const candidate of candidates) {
    const result = await db.job.updateMany({
      where: { id: candidate.id, status: candidate.status },
      data: { status: JobStatus.CLAIMED, claimedAt: now },
    });
    // Zero rows means another worker won the race. Not an error.
    if (result.count === 1) {
      const job = await db.job.findUnique({ where: { id: candidate.id } });
      if (job) claimed.push(job);
    }
  }
  return claimed;
}

export async function succeed(jobId: string) {
  return db.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.DONE,
      claimedAt: null,
      lastError: null,
      attempts: { increment: 1 },
      // Released so a completed key can be re-enqueued later — a post published
      // today shouldn't block the same post being re-queued after an edit.
      idempotencyKey: null,
    },
  });
}

/**
 * Record a failure and decide whether to retry.
 *
 * The attempt count is incremented here rather than at claim time on purpose: a
 * job claimed by a worker that then crashed hasn't *tried* anything, and
 * charging it an attempt would burn its retries on infrastructure problems.
 */
export async function fail(jobId: string, error: unknown) {
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job) return null;

  const attempts = job.attempts + 1;
  const message = (
    error instanceof Error ? error.message : String(error)
  ).slice(0, 1000);
  const exhausted = attempts >= job.maxAttempts;

  return db.job.update({
    where: { id: jobId },
    data: {
      attempts,
      lastError: message,
      claimedAt: null,
      status: exhausted ? JobStatus.DEAD : JobStatus.PENDING,
      runAfter: exhausted
        ? job.runAfter
        : new Date(Date.now() + backoffMs(attempts)),
      ...(exhausted ? { idempotencyKey: null } : {}),
    },
  });
}

/** Queue health, for the ops surface and the smoke suite. */
export async function queueStats(orgId?: string) {
  const rows = await db.job.groupBy({
    by: ["status"],
    where: orgId ? { orgId } : {},
    _count: { _all: true },
  });
  const counts = Object.fromEntries(
    Object.values(JobStatus).map((status) => [status, 0])
  ) as Record<JobStatus, number>;
  for (const row of rows) counts[row.status] = row._count._all;
  return counts;
}

/** Jobs that gave up, newest first — the list worth looking at. */
export async function listDeadJobs(orgId: string, take = 20) {
  return db.job.findMany({
    where: { orgId, status: JobStatus.DEAD },
    orderBy: { updatedAt: "desc" },
    take,
  });
}

/** Put a dead job back in the queue with its attempts reset. */
export async function retryJob(jobId: string) {
  return db.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.PENDING,
      attempts: 0,
      runAfter: new Date(),
      lastError: null,
      claimedAt: null,
    },
  });
}

export { backoffMs, LEASE_MS };
