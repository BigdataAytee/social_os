import { XPostRole, XStoryKind } from "@prisma/client";

import { assertCan } from "@/lib/auth/permissions";
import type { Session } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { logActivity } from "@/modules/activity/service";
import { scoreReplies, storyScoreFrom } from "./ranking";
import type { XPostData } from "./source";
import { SyndicationSource, tweetIdFrom } from "./sources/syndication";

/**
 * The X Hub service (X-HUB.md).
 *
 * Content arrives here from two places that need no paid tier: posts a person
 * points at, and the org's own mentions. Everything after that — grouping,
 * scoring, the written story, the one-click actions — is identical regardless
 * of where a post came from, which is what makes a paid search tier an upgrade
 * rather than a prerequisite.
 *
 * `orgId` comes from the session on every call, as everywhere else in this
 * layer.
 */

export type IngestResult = {
  posts: number;
  stories: number;
  /** Inputs that resolved to nothing, so the caller can say which. */
  skipped: string[];
};

/**
 * Take links, give back stories.
 *
 * The entry point for pasting, sharing, and the bookmarklet. Accepts URLs or
 * bare ids, in any of the shapes people actually paste, and is idempotent:
 * pasting the same link twice updates the post and reuses its story rather than
 * building a second one.
 */
export async function ingest(
  session: Session,
  inputs: string[]
): Promise<IngestResult> {
  assertCan(session.role, "idea.write");

  const cleaned = inputs
    .flatMap((input) => input.split(/[\s,]+/))
    .map((input) => input.trim())
    .filter(Boolean);

  const unresolved = cleaned.filter((input) => tweetIdFrom(input) === null);
  const resolvable = cleaned.filter((input) => tweetIdFrom(input) !== null);
  if (resolvable.length === 0) {
    return { posts: 0, stories: 0, skipped: unresolved };
  }

  const source = new SyndicationSource();
  const fetched = await source.hydrate(resolvable);

  // Which ids came back, so the caller can name the ones that didn't. A
  // deleted or protected tweet is the common case and deserves saying.
  const got = new Set(fetched.map((post) => post.externalId));
  const missing = resolvable.filter((input) => {
    const id = tweetIdFrom(input);
    return id !== null && !got.has(id);
  });

  const stored = await storePosts(session.orgId, fetched);

  // Each hydrated post that isn't itself a reply becomes a story's original,
  // with whatever replies the embed carried.
  let stories = 0;
  for (const post of fetched) {
    if (post.replyToId) continue;
    const replies = await source.conversation(post.externalId);
    const built = await buildSavageStory(session, {
      original: post,
      replies,
      source: source.id,
    });
    if (built) stories += 1;
  }

  await logActivity(session, "xhub.ingested", "org", session.orgId, {
    posts: stored,
    stories,
  });

  return { posts: stored, stories, skipped: [...unresolved, ...missing] };
}

/** Upsert posts, keyed on (org, externalId). Returns how many are now stored. */
export async function storePosts(
  orgId: string,
  posts: XPostData[]
): Promise<number> {
  for (const post of posts) {
    const data = {
      authorHandle: post.authorHandle,
      authorName: post.authorName,
      authorAvatarUrl: post.authorAvatarUrl,
      authorVerified: post.authorVerified,
      text: post.text,
      conversationId: post.conversationId,
      replyToId: post.replyToId,
      permalink: post.permalink,
      mediaType: post.mediaType,
      mediaUrls: post.mediaUrls,
      likes: post.likes,
      replies: post.replies,
      reposts: post.reposts,
      views: post.views,
      publishedAt: post.publishedAt,
      fetchedAt: new Date(),
    };
    await db.xPost.upsert({
      where: { orgId_externalId: { orgId, externalId: post.externalId } },
      update: data,
      create: { orgId, externalId: post.externalId, ...data },
    });
  }
  return posts.length;
}

/**
 * Build (or refresh) the story for one original and its replies.
 *
 * Returns null when there is nothing worth showing — an original with no
 * replies is not a Savage Replies card, and manufacturing one would fill the
 * hub with posts that have no punchline.
 */
export async function buildSavageStory(
  session: Session,
  input: {
    original: XPostData;
    replies: XPostData[];
    source: string;
  }
): Promise<string | null> {
  if (input.replies.length === 0) return null;

  await storePosts(session.orgId, [input.original, ...input.replies]);

  const scored = await scoreReplies(session, {
    original: input.original,
    replies: input.replies,
  });
  const ranked = [...scored].sort((a, b) => b.score.total - a.score.total);
  const best = ranked[0];
  if (!best) return null;

  const rows = await db.xPost.findMany({
    where: {
      orgId: session.orgId,
      externalId: {
        in: [input.original.externalId, ...ranked.map((r) => r.post.externalId)],
      },
    },
    select: { id: true, externalId: true },
  });
  const idOf = new Map(rows.map((row) => [row.externalId, row.id]));
  const originalId = idOf.get(input.original.externalId);
  if (!originalId) return null;

  // Keyed on the original so re-ingesting refreshes rather than duplicating —
  // the same property ExternalPost and Conversation rely on.
  const existing = await db.xStory.findFirst({
    where: {
      orgId: session.orgId,
      kind: XStoryKind.SAVAGE,
      posts: { some: { postId: originalId, role: XPostRole.ORIGINAL } },
    },
    select: { id: true },
  });

  const title = titleFor(input.original.text);
  const scoring = {
    basis: best.score.basis,
    humour: best.score.humour,
    roast: best.score.roast,
    virality: best.score.virality,
    engagement: best.score.engagement,
  };

  const story = existing
    ? await db.xStory.update({
        where: { id: existing.id },
        data: {
          title,
          score: storyScoreFrom(ranked),
          scoring: scoring as never,
          source: input.source,
        },
      })
    : await db.xStory.create({
        data: {
          orgId: session.orgId,
          kind: XStoryKind.SAVAGE,
          title,
          score: storyScoreFrom(ranked),
          scoring: scoring as never,
          source: input.source,
          coverUrl: input.original.mediaUrls[0] ?? null,
          topics: [],
        },
      });

  await db.xStoryPost.upsert({
    where: { storyId_postId: { storyId: story.id, postId: originalId } },
    update: { role: XPostRole.ORIGINAL, position: 0 },
    create: {
      storyId: story.id,
      postId: originalId,
      role: XPostRole.ORIGINAL,
      position: 0,
    },
  });

  // Top five replies. The rest are noise on a card, and keeping them would make
  // "the reply that outdid it" into a comment section.
  await Promise.all(
    ranked.slice(0, 5).map(async (reply, index) => {
      const postId = idOf.get(reply.post.externalId);
      if (!postId) return;
      const scores = {
        role: XPostRole.REPLY,
        position: index + 1,
        humour: reply.score.humour,
        roast: reply.score.roast,
        virality: reply.score.virality,
        engagement: reply.score.engagement,
      };
      await db.xStoryPost.upsert({
        where: { storyId_postId: { storyId: story.id, postId } },
        update: scores,
        create: { storyId: story.id, postId, ...scores },
      });
    })
  );

  return story.id;
}

/** First line, trimmed to a headline. Not a model call — it's a label. */
function titleFor(text: string): string {
  const line = text.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "Post";
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}

export type StoryCard = {
  id: string;
  kind: XStoryKind;
  title: string;
  summary: string | null;
  coverUrl: string | null;
  score: number;
  scoring: Record<string, unknown>;
  /** Module-specific payload — a gist's hashtags, a news timeline. */
  details: Record<string, unknown>;
  topics: string[];
  saved: boolean;
  source: string;
  createdAt: Date;
  original: StoryPostView | null;
  replies: StoryPostView[];
};

export type StoryPostView = {
  id: string;
  externalId: string;
  authorHandle: string;
  authorName: string | null;
  authorAvatarUrl: string | null;
  authorVerified: boolean;
  text: string;
  permalink: string | null;
  mediaType: string;
  mediaUrls: string[];
  likes: number;
  replies: number;
  reposts: number;
  views: number;
  publishedAt: Date;
  humour: number | null;
  roast: number | null;
  virality: number | null;
  engagement: number | null;
};

/**
 * The hub feed.
 *
 * Keyset pagination on (score, id) rather than offset: the hub re-scores as it
 * ingests, and an offset page-two after a re-score shows rows page one already
 * had. The cursor is stable because it names a row, not a position.
 */
export async function listStories(
  session: Session,
  opts: {
    kind?: XStoryKind;
    saved?: boolean;
    take?: number;
    cursor?: { score: number; id: string } | null;
  } = {}
): Promise<{ stories: StoryCard[]; nextCursor: { score: number; id: string } | null }> {
  const take = Math.min(opts.take ?? 20, 50);

  const rows = await db.xStory.findMany({
    where: {
      orgId: session.orgId,
      ...(opts.kind ? { kind: opts.kind } : {}),
      ...(opts.saved !== undefined ? { saved: opts.saved } : {}),
      ...(opts.cursor
        ? {
            OR: [
              { score: { lt: opts.cursor.score } },
              { score: opts.cursor.score, id: { gt: opts.cursor.id } },
            ],
          }
        : {}),
    },
    include: {
      posts: {
        include: { post: true },
        orderBy: { position: "asc" },
      },
    },
    orderBy: [{ score: "desc" }, { id: "asc" }],
    take: take + 1,
  });

  const page = rows.slice(0, take);
  const last = page[page.length - 1];

  return {
    stories: page.map((story) => {
      const original = story.posts.find((p) => p.role === XPostRole.ORIGINAL);
      return {
        id: story.id,
        kind: story.kind,
        title: story.title,
        summary: story.summary,
        coverUrl: story.coverUrl,
        score: story.score,
        scoring: (story.scoring as Record<string, unknown>) ?? {},
        details: (story.details as Record<string, unknown>) ?? {},
        topics: story.topics,
        saved: story.saved,
        source: story.source,
        createdAt: story.createdAt,
        original: original ? viewOf(original) : null,
        replies: story.posts
          .filter((p) => p.role === XPostRole.REPLY)
          .map(viewOf),
      };
    }),
    nextCursor:
      rows.length > take && last ? { score: last.score, id: last.id } : null,
  };
}

type JoinedPost = {
  post: {
    id: string;
    externalId: string;
    authorHandle: string;
    authorName: string | null;
    authorAvatarUrl: string | null;
    authorVerified: boolean;
    text: string;
    permalink: string | null;
    mediaType: string;
    mediaUrls: string[];
    likes: number;
    replies: number;
    reposts: number;
    views: number;
    publishedAt: Date;
  };
  humour: number | null;
  roast: number | null;
  virality: number | null;
  engagement: number | null;
};

function viewOf(row: JoinedPost): StoryPostView {
  return {
    ...row.post,
    humour: row.humour,
    roast: row.roast,
    virality: row.virality,
    engagement: row.engagement,
  };
}

export async function setSaved(
  session: Session,
  input: { storyId: string; saved: boolean }
) {
  assertCan(session.role, "idea.write");
  const story = await db.xStory.findFirst({
    where: { id: input.storyId, orgId: session.orgId },
    select: { id: true },
  });
  if (!story) throw new Error("Story not found");

  return db.xStory.update({
    where: { id: story.id },
    data: { saved: input.saved, savedAt: input.saved ? new Date() : null },
  });
}

export async function hubCounts(session: Session) {
  const [total, saved] = await Promise.all([
    db.xStory.count({ where: { orgId: session.orgId } }),
    db.xStory.count({ where: { orgId: session.orgId, saved: true } }),
  ]);
  return { total, saved };
}
