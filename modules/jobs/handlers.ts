import { PostStatus, type Job } from "@prisma/client";

import { db } from "@/lib/db";
import type { Session } from "@/lib/auth/session";

/**
 * What each job kind actually does.
 *
 * Handlers take a **system session** rather than a user's: the work runs when
 * nobody is signed in, and the org is on the job row. That session is
 * constructed here and nowhere else, and it carries OWNER so service-layer
 * permission checks pass — the authorisation happened when the human scheduled
 * the post, not now.
 *
 * A handler that throws gets retried with backoff. A handler that returns
 * normally is done. Neither should swallow a platform error: `fail()` is what
 * records it, and a handler that catches everything makes a broken integration
 * look like a working one.
 */

export type JobResult = { summary: string };
export type JobHandler = (job: Job) => Promise<JobResult>;

/**
 * A session for work with no human behind it.
 *
 * OWNER because the service layer's role checks are about *who asked*, and the
 * asking already happened — an EDITOR's post reached SCHEDULED only by passing
 * the approval gate, so the queue re-checking their role at publish time would
 * refuse work that was already approved.
 */
async function systemSession(orgId: string): Promise<Session> {
  const org = await db.organization.findUnique({ where: { id: orgId } });
  if (!org) throw new Error(`Organization ${orgId} no longer exists`);

  // Attributed to the org's owner where there is one, so the activity log names
  // a real person rather than a ghost.
  const owner = await db.membership.findFirst({
    where: { orgId, role: "OWNER" },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });

  return {
    userId: owner?.userId ?? "system",
    email: owner?.user.email ?? "system@socialos.local",
    name: owner?.user.name ?? "SocialOS",
    avatarUrl: null,
    orgId,
    orgName: org.name,
    orgSlug: org.slug,
    role: "OWNER",
  };
}

/**
 * Publish one scheduled post.
 *
 * This is the handler that closes the gap the audit found: before it,
 * `SCHEDULED` was a label with nothing watching the clock.
 */
const publishPostJob: JobHandler = async (job) => {
  const postId = String((job.payload as { postId?: string }).postId ?? "");
  if (!postId) throw new Error("publish-post job has no postId");

  const post = await db.post.findFirst({
    where: { id: postId, orgId: job.orgId },
  });
  // Deleted, or already dealt with by a human, between scheduling and now.
  // Not a failure — retrying would never help.
  if (!post) return { summary: `post ${postId} no longer exists` };
  if (post.status === PostStatus.PUBLISHED) {
    return { summary: "already published" };
  }
  if (post.status !== PostStatus.SCHEDULED && post.status !== PostStatus.QUEUED) {
    return { summary: `status is ${post.status}, not publishing` };
  }

  const session = await systemSession(job.orgId);
  const { publishPost } = await import("@/modules/posts/service");
  const published = await publishPost(session, post.id);

  // publishPost records FAILED itself when the adapter refuses. Throwing here
  // is what earns a retry — a platform that was down a minute ago may not be.
  if (published.status === PostStatus.FAILED) {
    throw new Error("The platform refused this post");
  }
  return { summary: `published ${published.platform} post ${published.id}` };
};

/** Refresh one connected account's pulled posts and analytics. */
const syncAccountJob: JobHandler = async (job) => {
  const accountId = String((job.payload as { accountId?: string }).accountId ?? "");
  if (!accountId) throw new Error("sync-account job has no accountId");

  const session = await systemSession(job.orgId);
  const { syncAccount } = await import("@/modules/integrations/sync");
  const result = await syncAccount(session, accountId);
  return { summary: `synced ${result.handle}: ${result.posts} posts` };
};

/** Recompute the Growth Strategist's aggregations for one platform. */
const recomputeStrategyJob: JobHandler = async (job) => {
  const platform = (job.payload as { platform?: string }).platform;
  if (!platform) throw new Error("recompute-strategy job has no platform");

  const { recomputePlatform } = await import("@/modules/strategy/engine");
  await recomputePlatform(job.orgId, platform as never);
  return { summary: `recomputed ${platform}` };
};

/**
 * Re-derive the org's measured voice.
 *
 * Batch rather than incremental because the whole profile is a function of the
 * whole corpus — a median moves when any post is added — and recomputing from
 * scratch over a thousand rows is cheaper than maintaining running statistics
 * that can drift.
 */
const rebuildBrandProfileJob: JobHandler = async (job) => {
  const { rebuildBrandProfile } = await import("@/modules/brandbrain/service");
  const profile = await rebuildBrandProfile(job.orgId);
  return {
    summary: `brand profile from ${profile.basedOnPosts} posts, ${profile.contentPillars.length} pillars`,
  };
};

/**
 * Pull one account's comments, mentions and DMs.
 *
 * Separate from `sync-account` rather than folded into it: the inbox wants a
 * far tighter cadence than analytics — a complaint sitting unseen for six hours
 * is the failure the inbox exists to prevent — and an inbox pull failing must
 * not lose the analytics pull that would have run beside it.
 */
const syncInboxJob: JobHandler = async (job) => {
  const accountId = String((job.payload as { accountId?: string }).accountId ?? "");
  if (!accountId) throw new Error("sync-inbox job has no accountId");

  const session = await systemSession(job.orgId);
  const { syncInbox } = await import("@/modules/inbox/service");
  const result = await syncInbox(session, accountId);

  if (result.unsupported) return { summary: `not supported: ${result.unsupported}` };
  return {
    summary: `${result.conversations} conversations, ${result.messages} messages`,
  };
};

/** Return snoozed threads whose time has come. Org-independent, runs once. */
const wakeSnoozedJob: JobHandler = async () => {
  const { wakeSnoozed } = await import("@/modules/inbox/service");
  const { woken } = await wakeSnoozed();
  return { summary: `woke ${woken} conversations` };
};

/** Pull one competitor's recent posts. */
const syncCompetitorJob: JobHandler = async (job) => {
  const competitorId = String(
    (job.payload as { competitorId?: string }).competitorId ?? ""
  );
  if (!competitorId) throw new Error("sync-competitor job has no competitorId");

  const session = await systemSession(job.orgId);
  const { syncCompetitor } = await import("@/modules/competitors/service");
  const result = await syncCompetitor(session, competitorId);

  if (result.unsupported) return { summary: `not supported: ${result.unsupported}` };
  return { summary: `${result.posts} posts` };
};

/**
 * Re-run every monitor for one org.
 *
 * After the competitor sync rather than before, in scheduling order: a scan
 * that runs first would miss everything pulled a minute later, and monitors are
 * the surface people check to decide whether to act.
 */
const scanMonitorsJob: JobHandler = async (job) => {
  const { scanMonitors } = await import("@/modules/listening/service");
  const result = await scanMonitors(job.orgId);
  return {
    summary: `${result.scanned} monitors, ${result.matched} matches`,
  };
};

/** Rebuild the retrieval corpus. */
const reindexMemoryJob: JobHandler = async (job) => {
  const { reindexOrg } = await import("@/modules/memory/service");
  const { chunks } = await reindexOrg(job.orgId);
  return { summary: `indexed ${chunks} chunks` };
};

export const HANDLERS: Record<string, JobHandler> = {
  "publish-post": publishPostJob,
  "sync-account": syncAccountJob,
  "recompute-strategy": recomputeStrategyJob,
  "rebuild-brand-profile": rebuildBrandProfileJob,
  "reindex-memory": reindexMemoryJob,
  "sync-inbox": syncInboxJob,
  "wake-snoozed": wakeSnoozedJob,
  "sync-competitor": syncCompetitorJob,
  "scan-monitors": scanMonitorsJob,
};

export function handlerFor(kind: string): JobHandler | null {
  return HANDLERS[kind] ?? null;
}
