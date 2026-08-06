import {
  ConnectedAccountStatus,
  Platform,
  PostStatus,
  Prisma,
} from "@prisma/client";

import { assertCan } from "@/lib/auth/permissions";
import type { Session } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  createPostSchema,
  reschedulePostSchema,
  updatePostSchema,
  type CreatePostInput,
  type UpdatePostInput,
} from "@/lib/validators/post";
import { logActivity } from "@/modules/activity/service";
import { forget, remember } from "@/modules/memory/service";

/**
 * Post service (ARCHITECTURE.md §6).
 *
 * Every write goes through here — route handlers, server actions and AI tool
 * calls alike. orgId always comes from the session, never from an argument.
 */

export type PostWithRelations = Prisma.PostGetPayload<{
  include: { campaign: true; author: true };
}>;

export async function listPosts(
  session: Session,
  filters: {
    platform?: Platform;
    status?: PostStatus | PostStatus[];
    campaignId?: string;
    from?: Date;
    to?: Date;
    take?: number;
  } = {}
): Promise<PostWithRelations[]> {
  const status = Array.isArray(filters.status)
    ? { in: filters.status }
    : filters.status;

  return db.post.findMany({
    where: {
      orgId: session.orgId,
      ...(filters.platform ? { platform: filters.platform } : {}),
      ...(status ? { status } : {}),
      ...(filters.campaignId ? { campaignId: filters.campaignId } : {}),
      ...(filters.from || filters.to
        ? {
            scheduledAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
    },
    include: { campaign: true, author: true },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
    ...(filters.take ? { take: filters.take } : {}),
  });
}

export async function getPost(session: Session, id: string) {
  return db.post.findFirst({
    where: { id, orgId: session.orgId },
    include: {
      campaign: true,
      author: true,
      comments: { include: { user: true }, orderBy: { createdAt: "asc" } },
    },
  });
}

export async function createPost(session: Session, input: CreatePostInput) {
  assertCan(session.role, "post.create");
  const data = createPostSchema.parse(input);

  // An EDITOR can't schedule directly — the approval gate (§5) routes their
  // work to NEEDS_APPROVAL instead of silently accepting a status they can't set.
  const status =
    data.status === PostStatus.SCHEDULED || data.status === PostStatus.QUEUED
      ? canApprove(session)
        ? data.status
        : PostStatus.NEEDS_APPROVAL
      : data.status;

  const post = await db.post.create({
    data: {
      orgId: session.orgId,
      authorId: session.userId,
      platform: data.platform,
      body: data.body,
      status,
      platformData: data.platformData as Prisma.InputJsonValue,
      campaignId: data.campaignId,
      scheduledAt: data.scheduledAt,
    },
    include: { campaign: true, author: true },
  });

  await logActivity(session, "post.created", "post", post.id, {
    platform: post.platform,
    status: post.status,
  });

  return post;
}

export async function updatePost(session: Session, input: UpdatePostInput) {
  assertCan(session.role, "post.edit");
  const data = updatePostSchema.parse(input);

  const existing = await db.post.findFirst({
    where: { id: data.id, orgId: session.orgId },
  });
  if (!existing) throw new Error("Post not found");

  if (data.status && data.status !== existing.status) {
    assertStatusTransition(session, existing.status, data.status);
  }

  const post = await db.post.update({
    where: { id: existing.id },
    data: {
      ...(data.body !== undefined ? { body: data.body } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.platformData !== undefined
        ? { platformData: data.platformData as Prisma.InputJsonValue }
        : {}),
      ...(data.campaignId !== undefined ? { campaignId: data.campaignId } : {}),
      ...(data.scheduledAt !== undefined
        ? { scheduledAt: data.scheduledAt }
        : {}),
      ...(data.status === PostStatus.PUBLISHED && !existing.publishedAt
        ? { publishedAt: new Date() }
        : {}),
    },
    include: { campaign: true, author: true },
  });

  await logActivity(session, "post.updated", "post", post.id, {
    status: post.status,
  });

  return post;
}

/** Calendar drag-and-drop (Phase 5). Keeps status coherent with the new time. */
export async function reschedulePost(
  session: Session,
  input: { id: string; scheduledAt: Date }
) {
  assertCan(session.role, "post.edit");
  const data = reschedulePostSchema.parse(input);

  const existing = await db.post.findFirst({
    where: { id: data.id, orgId: session.orgId },
  });
  if (!existing) throw new Error("Post not found");
  if (existing.status === PostStatus.PUBLISHED) {
    throw new Error("Published posts can't be rescheduled");
  }

  const post = await db.post.update({
    where: { id: existing.id },
    data: {
      scheduledAt: data.scheduledAt,
      // A draft dragged onto the calendar becomes scheduled — but only if this
      // role may schedule; otherwise it enters the approval queue.
      status:
        existing.status === PostStatus.DRAFT
          ? canApprove(session)
            ? PostStatus.SCHEDULED
            : PostStatus.NEEDS_APPROVAL
          : existing.status,
    },
    include: { campaign: true, author: true },
  });

  await logActivity(session, "post.rescheduled", "post", post.id, {
    scheduledAt: post.scheduledAt?.toISOString() ?? null,
  });

  return post;
}

export async function deletePost(session: Session, id: string) {
  assertCan(session.role, "post.delete");
  const existing = await db.post.findFirst({
    where: { id, orgId: session.orgId },
  });
  if (!existing) throw new Error("Post not found");

  await db.post.delete({ where: { id: existing.id } });
  // A deleted post must leave memory too, or recall keeps surfacing copy the
  // org has decided it doesn't want to see again.
  await forget(session.orgId, "post", existing.id).catch(() => null);
  await logActivity(session, "post.deleted", "post", id, {});
}

/** Mock-adapter publish (§10). Real adapters swap in behind the same call. */
export async function publishPost(session: Session, id: string) {
  assertCan(session.role, "post.publish");
  const existing = await db.post.findFirst({
    where: { id, orgId: session.orgId },
  });
  if (!existing) throw new Error("Post not found");

  const { getAdapter } = await import("@/modules/integrations/registry");

  // Resolved from the account, not the platform: an org with X on DIRECT and
  // TikTok on UNIFIED must get a different adapter for each, and a
  // platform-keyed lookup would silently pick one for both.
  //
  // Which account, when there are several: the one with a real connection.
  // An org that connected X still has its seeded MOCK row, and picking by
  // creation order finds that one — publishing would report success while
  // nothing left the building. A live connection outranks a placeholder.
  const account =
    (await db.connectedAccount.findFirst({
      where: {
        orgId: session.orgId,
        platform: existing.platform,
        integrationMode: { not: null },
        status: ConnectedAccountStatus.CONNECTED,
        credential: { isNot: null },
      },
      orderBy: { createdAt: "desc" },
    })) ??
    (await db.connectedAccount.findFirst({
      where: { orgId: session.orgId, platform: existing.platform },
      orderBy: { createdAt: "asc" },
    }));
  const result = await getAdapter(
    existing.platform,
    account?.integrationMode ?? null
  ).publish(existing);

  const post = await db.post.update({
    where: { id: existing.id },
    data: {
      status: result.ok ? PostStatus.PUBLISHED : PostStatus.FAILED,
      publishedAt: result.ok ? new Date() : null,
    },
    include: { campaign: true, author: true },
  });

  if (result.ok) {
    // Indexed on publish, not on create: a draft that never went out is not
    // part of what this account has said, and treating it as history would let
    // abandoned copy come back as a retrieval hit.
    await remember({
      orgId: session.orgId,
      sourceType: "post",
      sourceId: post.id,
      text: post.body,
      metadata: {
        platform: post.platform,
        kind: (post.platformData as { kind?: string } | null)?.kind ?? null,
      },
    }).catch(() => null);
  }

  await logActivity(
    session,
    result.ok ? "post.published" : "post.failed",
    "post",
    post.id,
    { platform: post.platform }
  );

  return post;
}

// ------------------------------------------------------------------ helpers

function canApprove(session: Session) {
  return session.role === "OWNER" || session.role === "ADMIN";
}

/**
 * The approval gate (§5): an EDITOR moves work to NEEDS_APPROVAL, and only an
 * ADMIN/OWNER moves it onward.
 */
function assertStatusTransition(
  session: Session,
  from: PostStatus,
  to: PostStatus
) {
  const needsApproval: PostStatus[] = [
    PostStatus.SCHEDULED,
    PostStatus.QUEUED,
    PostStatus.PUBLISHED,
  ];
  if (needsApproval.includes(to) && !canApprove(session)) {
    throw new Error(
      `Only an admin or owner can move a post to ${to}. Submit it for approval instead.`
    );
  }
  if (to === PostStatus.NEEDS_APPROVAL) {
    assertCan(session.role, "post.submitForApproval");
  }
  if (from === PostStatus.PUBLISHED && to !== PostStatus.PUBLISHED) {
    throw new Error("A published post can't be un-published");
  }
}

/** Dashboard + queue counts, one grouped query rather than six. */
export async function countByStatus(session: Session, platform?: Platform) {
  const rows = await db.post.groupBy({
    by: ["status"],
    where: { orgId: session.orgId, ...(platform ? { platform } : {}) },
    _count: { _all: true },
  });

  const counts = Object.fromEntries(
    Object.values(PostStatus).map((s) => [s, 0])
  ) as Record<PostStatus, number>;

  for (const row of rows) counts[row.status] = row._count._all;
  return counts;
}
