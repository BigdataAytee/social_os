import { Platform } from "@prisma/client";

import { assertCan } from "@/lib/auth/permissions";
import type { Session } from "@/lib/auth/session";
import { db } from "@/lib/db";
import type { XPostData } from "./source";
import { SyndicationSource } from "./sources/syndication";

/**
 * Fill the hub from the X account that's already connected (X-HUB.md §1).
 *
 * The hub started as paste-only, which made it a tool you had to remember to
 * feed. But this app is *already* pulling real X data for other reasons — the
 * account sync stores your posts, the engagement inbox stores mentions and
 * replies, and competitor tracking stores rivals' posts. All three are X
 * content sitting in the database, and none of it was reaching the hub.
 *
 * So harvesting costs **no new API calls and no new permissions**. It reads
 * rows this app already has, normalises them into the hub's shape, and then —
 * only for your own posts, where a tweet id exists — asks the embed endpoint
 * for the replies, because "what did people say back" is the one thing the
 * other pipelines don't store.
 */

export type HarvestResult = {
  /** Your own posts, brought across from the account sync. */
  own: number;
  /** Replies and mentions, from the engagement inbox. */
  mentions: number;
  /** Competitors' posts, from competitor tracking. */
  rivals: number;
  /** Conversations hydrated for their replies. */
  hydrated: number;
  stories: number;
  /** Why nothing came back, when nothing did. */
  note: string | null;
};

const WINDOW_DAYS = 30;

export async function harvest(session: Session): Promise<HarvestResult> {
  assertCan(session.role, "idea.write");

  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);

  const [accounts, ownPosts, conversations, rivalPosts] = await Promise.all([
    db.connectedAccount.findMany({
      where: { orgId: session.orgId, platform: Platform.X },
      select: { id: true, handle: true },
    }),
    db.externalPost.findMany({
      where: {
        orgId: session.orgId,
        account: { platform: Platform.X },
        publishedAt: { gte: since },
      },
      include: { account: { select: { handle: true } } },
      orderBy: { publishedAt: "desc" },
      take: 100,
    }),
    db.conversation.findMany({
      where: {
        orgId: session.orgId,
        platform: Platform.X,
        lastMessageAt: { gte: since },
      },
      include: { messages: { where: { outbound: false }, orderBy: { sentAt: "asc" } } },
      take: 200,
    }),
    db.competitorPost.findMany({
      where: {
        orgId: session.orgId,
        competitor: { platform: Platform.X },
        publishedAt: { gte: since },
      },
      include: { competitor: { select: { handle: true } } },
      orderBy: { publishedAt: "desc" },
      take: 100,
    }),
  ]);

  if (accounts.length === 0) {
    return {
      own: 0,
      mentions: 0,
      rivals: 0,
      hydrated: 0,
      stories: 0,
      note: "No X account connected. Connect one in Settings and the hub fills itself from your posts, your mentions and the competitors you track.",
    };
  }

  const posts: XPostData[] = [];

  for (const post of ownPosts) {
    posts.push({
      externalId: post.externalId,
      authorHandle: post.account.handle,
      authorName: null,
      authorAvatarUrl: null,
      authorVerified: false,
      text: post.text,
      conversationId: post.externalId,
      replyToId: null,
      permalink: post.permalink,
      mediaType: post.mediaType as XPostData["mediaType"],
      mediaUrls: [],
      likes: post.likes,
      replies: post.comments,
      reposts: post.shares,
      views: post.views,
      publishedAt: post.publishedAt,
    });
  }

  // Inbox messages are already the replies people sent us. Their ids are the
  // platform's, so a mention stored by the inbox and the same mention hydrated
  // from an embed are one row, not two.
  let mentions = 0;
  for (const conversation of conversations) {
    for (const message of conversation.messages) {
      if (!message.externalId) continue;
      posts.push({
        externalId: message.externalId,
        authorHandle: conversation.authorHandle,
        authorName: conversation.authorName,
        authorAvatarUrl: null,
        authorVerified: false,
        text: message.text,
        conversationId: conversation.externalId,
        replyToId: conversation.externalId,
        permalink: conversation.permalink,
        mediaType: "text",
        mediaUrls: [],
        // The inbox doesn't store engagement on individual replies — the
        // platform doesn't report it on that endpoint. Zeroes rather than
        // guesses; the ranking treats missing reach as missing.
        likes: 0,
        replies: 0,
        reposts: 0,
        views: 0,
        publishedAt: message.sentAt,
      });
      mentions += 1;
    }
  }

  for (const post of rivalPosts) {
    posts.push({
      externalId: post.externalId,
      authorHandle: `@${post.competitor.handle}`,
      authorName: null,
      authorAvatarUrl: null,
      authorVerified: false,
      text: post.text,
      conversationId: post.externalId,
      replyToId: null,
      permalink: post.permalink,
      mediaType: post.mediaType as XPostData["mediaType"],
      mediaUrls: [],
      likes: post.likes,
      replies: post.comments,
      reposts: post.shares,
      views: post.views,
      publishedAt: post.publishedAt,
    });
  }

  const { storePosts, buildSavageStory } = await import("./service");
  await storePosts(session.orgId, posts);

  /**
   * Replies to our best posts, from the embed endpoint.
   *
   * Only our own, and only the top few. This is the one place harvesting makes
   * an outbound request, and it is bounded on purpose: the endpoint is for
   * rendering embeds, and walking every post we have ever published would turn
   * a helpful pull into a crawl.
   *
   * Mock ids are skipped — a seeded demo row has no real tweet behind it, and
   * asking for one wastes a request to learn that.
   */
  const source = new SyndicationSource();
  const candidates = ownPosts
    .filter((post) => !post.externalId.startsWith("mock_"))
    .sort((a, b) => b.likes + b.shares - (a.likes + a.shares))
    .slice(0, 5);

  let hydrated = 0;
  let stories = 0;

  for (const post of candidates) {
    const replies = await source.conversation(post.externalId);
    if (replies.length === 0) continue;
    hydrated += 1;

    const original = posts.find((p) => p.externalId === post.externalId);
    if (!original) continue;

    const built = await buildSavageStory(session, {
      original,
      replies,
      source: "harvest",
    });
    if (built) stories += 1;
  }

  // Mentions grouped by the conversation they belong to also make stories —
  // no outbound request needed, because the inbox already fetched them.
  for (const conversation of conversations) {
    const replies = posts.filter(
      (post) => post.replyToId === conversation.externalId
    );
    if (replies.length === 0) continue;

    const original =
      posts.find((post) => post.externalId === conversation.externalId) ??
      // The post being replied to isn't always ours or stored; the thread is
      // still worth showing, anchored on its first reply.
      replies[0]!;

    const built = await buildSavageStory(session, {
      original,
      replies: replies.filter((reply) => reply.externalId !== original.externalId),
      source: "harvest",
    });
    if (built) stories += 1;
  }

  return {
    own: ownPosts.length,
    mentions,
    rivals: rivalPosts.length,
    hydrated,
    stories,
    note:
      posts.length === 0
        ? "Your X account is connected but nothing has synced yet. Run a sync in Settings, or paste a few links to get started."
        : null,
  };
}
