/**
 * Stages 1–2 verification: the job queue and the publishing it exists to fix.
 *
 *   DATABASE_URL=… npx tsx scripts/jobs-e2e.ts
 *
 * Writes to the database. Point it at a throwaway one.
 */

import { JobStatus, Platform, PostStatus } from "@prisma/client";

import { db } from "@/lib/db";
import {
  backoffMs,
  claim,
  enqueue,
  fail,
  listDeadJobs,
  queueStats,
  retryJob,
  succeed,
} from "@/modules/jobs/service";
import { drain, enqueueDuePosts } from "@/modules/jobs/runner";

let failures = 0;
let checks = 0;

function ok(label: string, condition: boolean, detail = "") {
  checks += 1;
  if (!condition) failures += 1;
  console.log(`  ${condition ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const membership = await db.membership.findFirst({
    where: { role: "OWNER", org: { slug: "northwind" } },
    include: { org: true },
  });
  if (!membership) throw new Error("Seed the northwind demo org first");
  const orgId = membership.orgId;

  // A previous failed run must not colour this one.
  await db.job.deleteMany({ where: { orgId } });

  console.log("\nQueue mechanics");
  const job = await enqueue({ orgId, kind: "recompute-strategy", payload: { platform: "X" } });
  ok("enqueue creates a PENDING job", job.status === JobStatus.PENDING);

  const future = await enqueue({
    orgId,
    kind: "recompute-strategy",
    payload: { platform: "X" },
    runAfter: new Date(Date.now() + 60_000),
  });
  const firstClaim = await claim(10);
  ok("claims what is due", firstClaim.some((j) => j.id === job.id));
  ok(
    "does not claim what isn't due yet",
    !firstClaim.some((j) => j.id === future.id)
  );
  ok(
    "a claimed job is CLAIMED",
    firstClaim.find((j) => j.id === job.id)?.status === JobStatus.CLAIMED
  );

  const secondClaim = await claim(10);
  ok(
    "a second worker can't claim the same job",
    !secondClaim.some((j) => j.id === job.id)
  );

  await succeed(job.id);
  const done = await db.job.findUnique({ where: { id: job.id } });
  ok("succeed marks it DONE", done?.status === JobStatus.DONE);
  ok("succeed releases the claim", done?.claimedAt === null);

  console.log("\nIdempotency");
  const a = await enqueue({ orgId, kind: "sync-account", idempotencyKey: "dupe-key" });
  const b = await enqueue({ orgId, kind: "sync-account", idempotencyKey: "dupe-key" });
  ok("the same key enqueues once", a.id === b.id);
  ok(
    "and there is exactly one row for it",
    (await db.job.count({ where: { orgId, idempotencyKey: "dupe-key" } })) === 1
  );

  console.log("\nRetry and backoff");
  ok("backoff grows", backoffMs(1) < backoffMs(2) && backoffMs(2) < backoffMs(3));
  ok("backoff is capped", backoffMs(50) === backoffMs(20), `${backoffMs(50)}ms`);

  const flaky = await enqueue({ orgId, kind: "sync-account", maxAttempts: 2 });
  await claim(10);
  const afterOne = await fail(flaky.id, new Error("platform said no"));
  ok("a failure returns it to PENDING", afterOne?.status === JobStatus.PENDING);
  ok("with the error recorded", afterOne?.lastError?.includes("platform said no") === true);
  ok(
    "and scheduled into the future",
    (afterOne?.runAfter.getTime() ?? 0) > Date.now() + 30_000
  );

  const afterTwo = await fail(flaky.id, new Error("still no"));
  ok("out of attempts means DEAD", afterTwo?.status === JobStatus.DEAD);
  ok("a dead job is kept, not deleted", (await db.job.findUnique({ where: { id: flaky.id } })) !== null);
  ok("dead jobs are listable", (await listDeadJobs(orgId)).some((j) => j.id === flaky.id));

  const revived = await retryJob(flaky.id);
  ok("a dead job can be retried", revived.status === JobStatus.PENDING && revived.attempts === 0);

  console.log("\nLost claims are reclaimable");
  const stranded = await enqueue({ orgId, kind: "sync-account" });
  await db.job.update({
    where: { id: stranded.id },
    // Simulate a worker that claimed it and died: the lease is 5 minutes.
    data: { status: JobStatus.CLAIMED, claimedAt: new Date(Date.now() - 10 * 60_000) },
  });
  ok(
    "an abandoned claim is picked back up",
    (await claim(20)).some((j) => j.id === stranded.id)
  );

  console.log("\nUnknown kinds fail rather than spin");
  await db.job.deleteMany({ where: { orgId } });
  await enqueue({ orgId, kind: "not-a-real-kind", maxAttempts: 1 });
  const unknownRun = await drain();
  ok("drain reports the failure", unknownRun.failed === 1, unknownRun.details[0]);
  ok(
    "and it goes DEAD rather than retrying forever",
    (await db.job.count({ where: { orgId, status: JobStatus.DEAD } })) === 1
  );

  console.log("\nScheduled posts actually publish (the gap this closes)");
  await db.job.deleteMany({ where: { orgId } });

  const author = membership.userId;
  const duePost = await db.post.create({
    data: {
      orgId,
      platform: Platform.X,
      body: "A post whose scheduled time has arrived.",
      status: PostStatus.SCHEDULED,
      authorId: author,
      scheduledAt: new Date(Date.now() - 60_000),
      platformData: {},
    },
  });
  const futurePost = await db.post.create({
    data: {
      orgId,
      platform: Platform.X,
      body: "A post scheduled for tomorrow.",
      status: PostStatus.SCHEDULED,
      authorId: author,
      scheduledAt: new Date(Date.now() + 24 * 60 * 60_000),
      platformData: {},
    },
  });

  const scheduled = await enqueueDuePosts();
  ok("a due post is queued", scheduled.queued >= 1, `${scheduled.queued} queued`);
  ok(
    "and moves to QUEUED",
    (await db.post.findUnique({ where: { id: duePost.id } }))?.status ===
      PostStatus.QUEUED
  );
  ok(
    "a future post is left alone",
    (await db.post.findUnique({ where: { id: futurePost.id } }))?.status ===
      PostStatus.SCHEDULED
  );

  const before = await db.job.count({ where: { orgId, kind: "publish-post" } });
  await enqueueDuePosts();
  ok(
    "running the scheduler twice doesn't double-queue",
    (await db.job.count({ where: { orgId, kind: "publish-post" } })) === before,
    `${before} publish jobs`
  );

  const run = await drain();
  ok("the drain publishes it", run.succeeded >= 1, run.details.join("; ").slice(0, 70));
  const published = await db.post.findUnique({ where: { id: duePost.id } });
  ok("the post reaches PUBLISHED", published?.status === PostStatus.PUBLISHED, String(published?.status));
  ok("and gets a publishedAt", published?.publishedAt !== null);

  console.log("\nQueue stats");
  const stats = await queueStats(orgId);
  ok("stats cover every status", Object.keys(stats).length === Object.keys(JobStatus).length);
  ok("and count the completed work", stats.DONE >= 1, JSON.stringify(stats));

  console.log("\nCleanup");
  await db.post.deleteMany({ where: { id: { in: [duePost.id, futurePost.id] } } });
  await db.job.deleteMany({ where: { orgId } });
  console.log("  ✓ test rows removed");

  console.log(
    `\n${failures === 0 ? "✓" : "✗"} ${checks - failures}/${checks} checks passed\n`
  );
  await db.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("\nJobs e2e threw:\n", error);
  await db.$disconnect();
  process.exit(1);
});
