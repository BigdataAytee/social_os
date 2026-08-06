import { Platform, XPostRole, XStoryKind } from "@prisma/client";

import { assertCan } from "@/lib/auth/permissions";
import type { Session } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { extractTerms } from "@/modules/brandbrain/terms";
import {
  feedItems,
  newsFor,
  redditTop,
  topNews,
  type FeedItem,
} from "./sources/feeds";

/**
 * Pull the outside world in (X-HUB.md §1).
 *
 * The hub could see what you published and who replied. It could not see what
 * was *happening*, which is the thing a suggestion most needs to be about.
 *
 * **Queries come from the monitors you already keep.** Stage 6 built a table of
 * terms an org watches; those are exactly the topics it wants discovered, and
 * asking for the same list twice would be asking the same person the same
 * question in two places. An org with no monitors gets its market's front page
 * instead, so this is never a blank screen.
 *
 * Region and language come from the connected X account, so a Nigerian brand
 * gets Nigerian coverage rather than a global average.
 */

export type DiscoverResult = {
  items: number;
  stories: number;
  queries: string[];
  sources: string[];
  note: string | null;
};

/** Sources beyond news, configured per org. Stored on the account's meta. */
type DiscoveryConfig = {
  feeds?: string[];
  subreddits?: string[];
};

export async function discover(session: Session): Promise<DiscoverResult> {
  assertCan(session.role, "idea.write");

  const [monitors, account] = await Promise.all([
    db.monitor.findMany({
      where: { orgId: session.orgId, active: true },
      orderBy: { createdAt: "asc" },
      take: 5,
    }),
    db.connectedAccount.findFirst({
      where: { orgId: session.orgId, platform: Platform.X },
      select: { region: true, language: true, meta: true },
    }),
  ]);

  const region = account?.region ?? null;
  const language = account?.language ?? null;
  const config = ((account?.meta as { discovery?: DiscoveryConfig } | null)
    ?.discovery ?? {}) as DiscoveryConfig;

  const queries = monitors.map((monitor) => monitor.term);
  const collected: FeedItem[] = [];
  const sources = new Set<string>();

  if (queries.length === 0) {
    // No monitors. The front page beats nothing, and it teaches what this
    // surface does before anyone has configured it.
    const front = await topNews({ region, language });
    collected.push(...front);
    if (front.length > 0) sources.add("news");
  } else {
    for (const query of queries) {
      const items = await newsFor(query, { region, language });
      collected.push(...items);
      if (items.length > 0) sources.add("news");
    }
  }

  for (const url of (config.feeds ?? []).slice(0, 5)) {
    const items = await feedItems(url);
    collected.push(...items);
    if (items.length > 0) sources.add(items[0]!.source);
  }

  for (const subreddit of (config.subreddits ?? []).slice(0, 3)) {
    const items = await redditTop(subreddit);
    collected.push(...items);
    if (items.length > 0) sources.add("reddit");
  }

  if (collected.length === 0) {
    return {
      items: 0,
      stories: 0,
      queries,
      sources: [],
      note: "Nothing came back from the feeds. They may be unreachable from this deployment, or the topics you watch have no coverage right now.",
    };
  }

  // Deduplicated across queries: one article matching three monitors is one
  // row, not three, and a hub that lists the same headline repeatedly is a hub
  // people stop reading.
  const unique = new Map<string, FeedItem>();
  for (const item of collected) {
    if (!unique.has(item.externalId)) unique.set(item.externalId, item);
  }

  const items = [...unique.values()];
  await storeItems(session.orgId, items);

  const stories = await buildNewsStories(session, items);

  return {
    items: items.length,
    stories,
    queries,
    sources: [...sources],
    note: null,
  };
}

/**
 * Feed items live in `XPost` alongside real X posts.
 *
 * A separate table would have meant every module — trends, suggestions,
 * creators, analytics — learning about a second shape, and the hub's whole
 * premise is that one corpus feeds every lens. `source` is what keeps them
 * distinguishable, and it is on the row rather than inferred from the id.
 */
async function storeItems(orgId: string, items: FeedItem[]): Promise<void> {
  for (const item of items) {
    const data = {
      authorHandle: item.authorHandle,
      authorName: null,
      authorAvatarUrl: null,
      authorVerified: false,
      text: item.title === item.text ? item.title : `${item.title}\n\n${item.text}`,
      conversationId: null,
      replyToId: null,
      permalink: item.url,
      mediaType: item.imageUrl ? "image" : "text",
      mediaUrls: item.imageUrl ? [item.imageUrl] : [],
      // Reddit reports real engagement; RSS reports none. Zeros rather than
      // invented numbers — the ranking treats missing reach as missing.
      likes: item.score,
      replies: item.comments,
      reposts: 0,
      views: 0,
      publishedAt: item.publishedAt,
      source: item.source,
      fetchedAt: new Date(),
    };

    await db.xPost.upsert({
      where: { orgId_externalId: { orgId, externalId: item.externalId } },
      update: data,
      create: { orgId, externalId: item.externalId, ...data },
    });
  }
}

/**
 * Group discovered items into news stories, by shared subject.
 *
 * Grouped rather than one-card-per-article because five outlets covering one
 * event is one story, and a feed that lists all five is a wire service rather
 * than a hub. The grouping is term overlap — the same extractor the brand
 * profile and competitor gaps use, so "what is this about" gets one answer
 * across the app.
 */
async function buildNewsStories(
  session: Session,
  items: FeedItem[]
): Promise<number> {
  if (items.length < 2) return 0;

  const rows = await db.xPost.findMany({
    where: {
      orgId: session.orgId,
      externalId: { in: items.map((item) => item.externalId) },
    },
    select: { id: true, externalId: true, text: true, mediaUrls: true },
  });
  const byExternal = new Map(rows.map((row) => [row.externalId, row]));

  const terms = extractTerms(
    items.map((item) => `${item.title} ${item.text}`),
    { limit: 5, minDocumentRatio: 0.1 }
  );

  let built = 0;

  for (const term of terms) {
    const matching = items.filter((item) =>
      `${item.title} ${item.text}`.toLowerCase().includes(term.term)
    );
    // Two sources make a story. One is an article, and calling it a story
    // implies a corroboration that isn't there.
    if (matching.length < 2) continue;

    const postIds = matching
      .map((item) => byExternal.get(item.externalId)?.id)
      .filter((id): id is string => Boolean(id));
    if (postIds.length < 2) continue;

    const keyTag = `__key:discover:${term.term}`;
    const existing = await db.xStory.findFirst({
      where: {
        orgId: session.orgId,
        kind: XStoryKind.NEWS,
        topics: { has: keyTag },
      },
      select: { id: true },
    });

    const cover =
      matching.find((item) => item.imageUrl)?.imageUrl ??
      null;

    const data = {
      title: matching[0]!.title.slice(0, 200),
      // No summary yet — the writing happens when someone asks for it, so a
      // discovery pass costs no model calls at all.
      topics: [keyTag, term.term],
      coverUrl: cover,
      score: Math.min(
        100,
        Math.round((Math.log10(matching.length * 10 + 1) / 3) * 100)
      ),
      source: "discover",
      details: {
        outlets: [...new Set(matching.map((item) => item.authorHandle))],
        articles: matching.slice(0, 8).map((item) => ({
          title: item.title,
          outlet: item.authorHandle,
          url: item.url,
          at: item.publishedAt.toISOString(),
        })),
      } as never,
    };

    const story = existing
      ? await db.xStory.update({ where: { id: existing.id }, data })
      : await db.xStory.create({
          data: { orgId: session.orgId, kind: XStoryKind.NEWS, ...data },
        });

    await Promise.all(
      postIds.map((postId, index) =>
        db.xStoryPost.upsert({
          where: { storyId_postId: { storyId: story.id, postId } },
          update: { role: XPostRole.EVIDENCE, position: index },
          create: {
            storyId: story.id,
            postId,
            role: XPostRole.EVIDENCE,
            position: index,
          },
        })
      )
    );

    built += 1;
  }

  return built;
}

/** Configure extra feeds and subreddits for an org. */
export async function setDiscoveryConfig(
  session: Session,
  config: DiscoveryConfig
) {
  assertCan(session.role, "integration.manage");

  const account = await db.connectedAccount.findFirst({
    where: { orgId: session.orgId, platform: Platform.X },
  });
  if (!account) throw new Error("Connect an X account first");

  // Validated here rather than trusted: a bad URL would be fetched on every
  // discovery pass forever, and the failure would look like a quiet feed.
  const feeds = (config.feeds ?? [])
    .map((url) => url.trim())
    .filter(Boolean)
    .filter((url) => {
      try {
        const parsed = new URL(url);
        return parsed.protocol === "https:" || parsed.protocol === "http:";
      } catch {
        return false;
      }
    })
    .slice(0, 10);

  const subreddits = (config.subreddits ?? [])
    .map((name) => name.replace(/^\/?r\//, "").trim())
    .filter((name) => /^[A-Za-z0-9_]{2,24}$/.test(name))
    .slice(0, 10);

  return db.connectedAccount.update({
    where: { id: account.id },
    data: {
      meta: {
        ...(account.meta as object | null),
        discovery: { feeds, subreddits },
      },
    },
  });
}

export async function getDiscoveryConfig(
  session: Session
): Promise<DiscoveryConfig> {
  const account = await db.connectedAccount.findFirst({
    where: { orgId: session.orgId, platform: Platform.X },
    select: { meta: true },
  });
  return (
    ((account?.meta as { discovery?: DiscoveryConfig } | null)?.discovery ?? {
      feeds: [],
      subreddits: [],
    })
  );
}
