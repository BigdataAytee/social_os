import { XPostRole, XStoryKind } from "@prisma/client";

import { assertCan } from "@/lib/auth/permissions";
import type { Session } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { extractTerms } from "@/modules/brandbrain/terms";

/**
 * The story builders — News, Gists and Trends (X-HUB.md §4).
 *
 * All three read the same corpus the hub already holds. That is not a
 * limitation dressed up: a news story assembled from posts somebody chose to
 * collect is *better sourced* than one assembled from a keyword search, because
 * a person already decided the posts were about something.
 *
 * Every AI call goes through the orchestrator, so brand voice, the measured
 * profile and history retrieval apply here exactly as in a Studio. The model
 * writes; it never decides what is true. Grouping, ordering and the timeline
 * are computed from the rows.
 */

/** Posts the hub knows about, newest first, for grouping. */
async function corpus(orgId: string, take = 200) {
  return db.xPost.findMany({
    where: { orgId },
    orderBy: { publishedAt: "desc" },
    take,
  });
}

/**
 * Recurring subjects across everything collected.
 *
 * Reuses the brand profile's term extractor rather than adding a second one —
 * the same reasoning as competitor gap analysis: "what is this corpus about" is
 * one question, and two implementations would eventually disagree on one screen.
 */
export type DerivedTrend = {
  topic: string;
  posts: number;
  /** Total interactions across posts mentioning it. */
  reach: number;
};

export async function deriveTrends(
  session: Session,
  take = 8
): Promise<DerivedTrend[]> {
  const posts = await corpus(session.orgId);
  if (posts.length < 4) return [];

  const terms = extractTerms(
    posts.map((post) => post.text),
    { limit: take * 2 }
  );

  return terms
    .map((term) => {
      const matching = posts.filter((post) =>
        post.text.toLowerCase().includes(term.term)
      );
      return {
        topic: term.term,
        posts: matching.length,
        reach: matching.reduce(
          (sum, post) => sum + post.likes + post.reposts + post.replies,
          0
        ),
      };
    })
    // Reach, not frequency: a topic in twenty posts nobody saw is not trending,
    // and post-count ranking would put it above one that actually travelled.
    .sort((a, b) => b.reach - a.reach)
    .slice(0, take);
}

type Built = { id: string; title: string };

/**
 * Explain why a topic is trending, and give something to do about it.
 *
 * The explanation is grounded in the posts that mention it — the model is handed
 * the evidence and asked to read it, not asked what it thinks about a word.
 */
export async function buildTrendStory(
  session: Session,
  topic: string
): Promise<Built | null> {
  assertCan(session.role, "ai.generate");

  const posts = await db.xPost.findMany({
    where: { orgId: session.orgId, text: { contains: topic, mode: "insensitive" } },
    orderBy: { likes: "desc" },
    take: 12,
  });
  if (posts.length === 0) return null;

  const { generate } = await import("@/modules/ai/orchestrator");
  const evidence = posts
    .map((post) => `${post.authorHandle} (${post.likes} likes): ${post.text}`)
    .join("\n");

  const explanation = await generate(session, {
    studio: "X",
    type: "long-form",
    input: evidence,
    context:
      `Explain why "${topic}" is being talked about, using only these posts as evidence. Two short paragraphs: what is happening, and why people care. Do not invent events, names or numbers that are not in the posts. If the posts do not actually explain the cause, say that plainly rather than guessing.`,
  });

  const angles = await generate(session, {
    studio: "X",
    type: "idea",
    input: `Topic: ${topic}\n\n${evidence}`,
    context:
      "Give six angles our brand could take on this. One per line. Mix formats: a post, a hashtag to use, a meme treatment, a short video idea. Keep each to one line.",
  });

  return upsertStory(session, {
    kind: XStoryKind.TREND,
    key: `trend:${topic}`,
    title: topic,
    summary: explanation.output,
    topics: [topic],
    details: {
      angles: angles.output
        .split("\n")
        .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
        .filter((line) => line.length > 4)
        .slice(0, 6),
      reach: posts.reduce((sum, p) => sum + p.likes + p.reposts, 0),
    },
    score: Math.min(
      100,
      Math.round(
        (Math.log10(posts.reduce((s, p) => s + p.likes + p.reposts, 0) + 1) / 5) * 100
      )
    ),
    postIds: posts.map((post) => post.id),
    role: XPostRole.EVIDENCE,
    coverUrl: posts.find((post) => post.mediaUrls.length > 0)?.mediaUrls[0] ?? null,
  });
}

/**
 * A news item: cover, evidence, written story, timeline, reactions.
 *
 * The timeline is computed from `publishedAt`, not written by the model — the
 * order events happened in is a fact, and asking a model to reconstruct it from
 * prose is how a story acquires a sequence nobody can check.
 */
export async function buildNewsStory(
  session: Session,
  postIds: string[]
): Promise<Built | null> {
  assertCan(session.role, "ai.generate");

  const posts = await db.xPost.findMany({
    where: { orgId: session.orgId, id: { in: postIds } },
    orderBy: { publishedAt: "asc" },
  });
  if (posts.length === 0) return null;

  const { generate } = await import("@/modules/ai/orchestrator");
  const evidence = posts
    .map(
      (post) =>
        `[${post.publishedAt.toISOString()}] ${post.authorHandle}: ${post.text}`
    )
    .join("\n");

  const written = await generate(session, {
    studio: "X",
    type: "long-form",
    input: evidence,
    context:
      "Write this up as a short news item for our audience. First line is the headline, then a blank line, then three or four short paragraphs. Attribute every claim to the handle that made it. Do not invent detail, quotes or context that is not in the posts — if something important is unknown, say it is unknown.",
  });

  const [headline, ...body] = written.output.split("\n");

  return upsertStory(session, {
    kind: XStoryKind.NEWS,
    key: `news:${posts[0]!.externalId}`,
    title: (headline ?? "Untitled").replace(/^#+\s*/, "").slice(0, 200),
    summary: body.join("\n").trim() || written.output,
    topics: extractTerms(posts.map((p) => p.text), { limit: 5 }).map((t) => t.term),
    details: {
      // Facts, computed. Ordering a timeline is not a judgement call.
      timeline: posts.map((post) => ({
        at: post.publishedAt.toISOString(),
        handle: post.authorHandle,
        text: post.text.slice(0, 180),
        permalink: post.permalink,
      })),
    },
    score: Math.min(
      100,
      Math.round(
        (Math.log10(posts.reduce((s, p) => s + p.likes + p.reposts, 0) + 1) / 5) * 100
      )
    ),
    postIds: posts.map((post) => post.id),
    role: XPostRole.EVIDENCE,
    coverUrl: posts.find((post) => post.mediaUrls.length > 0)?.mediaUrls[0] ?? null,
  });
}

/**
 * A gist: the story-style summary, with the things that make it postable —
 * a caption, hashtags, a poll and a prompt to reply to.
 */
export async function buildGist(
  session: Session,
  postIds: string[]
): Promise<Built | null> {
  assertCan(session.role, "ai.generate");

  const posts = await db.xPost.findMany({
    where: { orgId: session.orgId, id: { in: postIds } },
    orderBy: { likes: "desc" },
  });
  if (posts.length === 0) return null;

  const { generate } = await import("@/modules/ai/orchestrator");
  const material = posts
    .map((post) => `${post.authorHandle}: ${post.text}`)
    .join("\n");

  const gist = await generate(session, {
    studio: "X",
    type: "caption",
    input: material,
    context:
      "Summarise this conversation the way a good group chat would — what happened, in three or four lines, with the tone of someone catching a friend up. Credit handles for anything they said.",
  });

  const extras = await generate(session, {
    studio: "X",
    type: "idea",
    input: material,
    context:
      "Produce exactly three lines, each prefixed with its label and nothing else:\nHASHTAGS: five hashtags, space separated\nPOLL: one poll question with two options separated by ' / '\nPROMPT: one question that invites replies",
  });

  const line = (label: string) =>
    extras.output
      .split("\n")
      .find((l) => l.trim().toUpperCase().startsWith(label))
      ?.replace(new RegExp(`^\\s*${label}:?\\s*`, "i"), "")
      .trim() ?? null;

  return upsertStory(session, {
    kind: XStoryKind.GIST,
    key: `gist:${posts[0]!.externalId}`,
    title: posts[0]!.text.split("\n")[0]?.slice(0, 120) ?? "Gist",
    summary: gist.output,
    topics: extractTerms(posts.map((p) => p.text), { limit: 5 }).map((t) => t.term),
    details: {
      hashtags: (line("HASHTAGS") ?? "")
        .split(/\s+/)
        .filter((tag) => tag.startsWith("#"))
        .slice(0, 5),
      poll: line("POLL"),
      prompt: line("PROMPT"),
    },
    score: Math.min(
      100,
      Math.round(
        (Math.log10(posts.reduce((s, p) => s + p.likes + p.reposts, 0) + 1) / 5) * 100
      )
    ),
    postIds: posts.map((post) => post.id),
    role: XPostRole.EVIDENCE,
    coverUrl: posts.find((post) => post.mediaUrls.length > 0)?.mediaUrls[0] ?? null,
  });
}

/**
 * Create or refresh a story, keyed so a rebuild replaces rather than duplicates.
 *
 * The key lives in `topics[0]` as a `__key:` entry rather than in a column of
 * its own — a dedicated unique column would be cleaner, and would also be a
 * migration for something only three builders use. Recorded here so the next
 * person knows it was a choice.
 */
async function upsertStory(
  session: Session,
  input: {
    kind: XStoryKind;
    key: string;
    title: string;
    summary: string;
    topics: string[];
    details: Record<string, unknown>;
    score: number;
    postIds: string[];
    role: XPostRole;
    coverUrl: string | null;
  }
): Promise<Built> {
  const keyTag = `__key:${input.key}`;

  const existing = await db.xStory.findFirst({
    where: { orgId: session.orgId, kind: input.kind, topics: { has: keyTag } },
    select: { id: true },
  });

  const data = {
    title: input.title,
    summary: input.summary,
    topics: [keyTag, ...input.topics],
    details: input.details as never,
    score: input.score,
    coverUrl: input.coverUrl,
    source: "syndication",
  };

  const story = existing
    ? await db.xStory.update({ where: { id: existing.id }, data })
    : await db.xStory.create({
        data: { orgId: session.orgId, kind: input.kind, ...data },
      });

  await Promise.all(
    input.postIds.map((postId, index) =>
      db.xStoryPost.upsert({
        where: { storyId_postId: { storyId: story.id, postId } },
        update: { role: input.role, position: index },
        create: { storyId: story.id, postId, role: input.role, position: index },
      })
    )
  );

  return { id: story.id, title: story.title };
}

/** Strip the internal key so it never reaches a screen. */
export function visibleTopics(topics: string[]): string[] {
  return topics.filter((topic) => !topic.startsWith("__key:"));
}

export type CreatorRow = {
  handle: string;
  name: string | null;
  avatarUrl: string | null;
  verified: boolean;
  posts: number;
  likes: number;
  reposts: number;
  /** Mean interactions per post — who punches above their volume. */
  average: number;
};

/**
 * Creator Spotlight, from the corpus.
 *
 * Ranked by mean interactions rather than total: total rewards whoever happens
 * to appear most often in what you collected, which is a fact about your
 * collecting rather than about them.
 */
export async function listCreators(
  session: Session,
  take = 12
): Promise<CreatorRow[]> {
  const posts = await corpus(session.orgId, 500);

  const byHandle = new Map<string, CreatorRow>();
  for (const post of posts) {
    const existing = byHandle.get(post.authorHandle) ?? {
      handle: post.authorHandle,
      name: post.authorName,
      avatarUrl: post.authorAvatarUrl,
      verified: post.authorVerified,
      posts: 0,
      likes: 0,
      reposts: 0,
      average: 0,
    };
    existing.posts += 1;
    existing.likes += post.likes;
    existing.reposts += post.reposts;
    byHandle.set(post.authorHandle, existing);
  }

  return [...byHandle.values()]
    .map((row) => ({
      ...row,
      average: Math.round((row.likes + row.reposts) / Math.max(1, row.posts)),
    }))
    .sort((a, b) => b.average - a.average)
    .slice(0, take);
}

/** Viral Videos: the video posts, ranked by what they earned. */
export async function listVideos(session: Session, take = 20) {
  const videos = await db.xPost.findMany({
    where: { orgId: session.orgId, mediaType: "video" },
    orderBy: { likes: "desc" },
    take,
  });
  return videos.map((video) => ({
    ...video,
    interactions: video.likes + video.reposts + video.replies,
  }));
}

/** Hub analytics: what is in the corpus, and what it is made of. */
export async function hubAnalytics(session: Session) {
  const [posts, stories, byKind, videos, creators] = await Promise.all([
    db.xPost.count({ where: { orgId: session.orgId } }),
    db.xStory.count({ where: { orgId: session.orgId } }),
    db.xStory.groupBy({
      by: ["kind"],
      where: { orgId: session.orgId },
      _count: { _all: true },
    }),
    db.xPost.count({ where: { orgId: session.orgId, mediaType: "video" } }),
    db.xPost.findMany({
      where: { orgId: session.orgId },
      select: { authorHandle: true },
      distinct: ["authorHandle"],
    }),
  ]);

  const totals = await db.xPost.aggregate({
    where: { orgId: session.orgId },
    _sum: { likes: true, reposts: true, replies: true },
  });

  return {
    posts,
    stories,
    videos,
    creators: creators.length,
    byKind: Object.fromEntries(byKind.map((row) => [row.kind, row._count._all])),
    interactions:
      (totals._sum.likes ?? 0) +
      (totals._sum.reposts ?? 0) +
      (totals._sum.replies ?? 0),
  };
}
