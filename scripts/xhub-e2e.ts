/**
 * X Hub verification: hydration without an API key, ranking, grouping, and the
 * degradation that happens when no model is configured.
 *
 *   DATABASE_URL=… npx tsx scripts/xhub-e2e.ts
 *
 * Writes to the database. Point it at a throwaway one.
 */

import { XStoryKind } from "@prisma/client";

import type { Session } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { parseWit, scoreReplies } from "@/modules/xhub/ranking";
import type { XPostData } from "@/modules/xhub/source";
import {
  SyndicationSource,
  tweetIdFrom,
} from "@/modules/xhub/sources/syndication";
import { hubCounts, ingest, listStories, setSaved } from "@/modules/xhub/service";
import {
  buildGist,
  buildNewsStory,
  buildTrendStory,
  deriveTrends,
  hubAnalytics,
  listCreators,
  listVideos,
  visibleTopics,
} from "@/modules/xhub/stories";
import { DELETED_ID, IDS, startFakeSyndication } from "./fake-syndication";

let failures = 0;
let checks = 0;

function ok(label: string, condition: boolean, detail = "") {
  checks += 1;
  if (!condition) failures += 1;
  console.log(`  ${condition ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
}

async function throws(label: string, fn: () => Promise<unknown>) {
  checks += 1;
  try {
    await fn();
    failures += 1;
    console.log(`  ✗ ${label} — expected a rejection, got none`);
  } catch (error) {
    console.log(
      `  ✓ ${label} — ${(error instanceof Error ? error.message : String(error)).slice(0, 55)}`
    );
  }
}

function post(over: Partial<XPostData> & { externalId: string }): XPostData {
  return {
    authorHandle: "@someone",
    authorName: null,
    authorAvatarUrl: null,
    authorVerified: false,
    text: "text",
    conversationId: null,
    replyToId: null,
    permalink: null,
    mediaType: "text",
    mediaUrls: [],
    likes: 0,
    replies: 0,
    reposts: 0,
    views: 0,
    publishedAt: new Date(),
    ...over,
  };
}

async function main() {
  const fake = await startFakeSyndication();
  process.env.SOCIALOS_SYNDICATION_BASE = fake.url;

  const membership = await db.membership.findFirst({
    where: { role: "OWNER", org: { slug: "northwind" } },
    include: { org: true, user: true },
  });
  if (!membership) throw new Error("Seed the northwind demo org first");

  const session: Session = {
    userId: membership.userId,
    email: membership.user.email,
    name: null,
    avatarUrl: null,
    orgId: membership.orgId,
    orgName: membership.org.name,
    orgSlug: membership.org.slug,
    role: membership.role,
  };

  await db.xStory.deleteMany({ where: { orgId: session.orgId } });
  await db.xPost.deleteMany({ where: { orgId: session.orgId } });

  console.log("\nParsing what people actually paste");
  ok("a full x.com URL", tweetIdFrom(`https://x.com/andra/status/${IDS.original}`) === IDS.original);
  ok("an old twitter.com URL", tweetIdFrom(`https://twitter.com/a/status/${IDS.original}`) === IDS.original);
  ok(
    "a URL with tracking junk",
    tweetIdFrom(`https://x.com/a/status/${IDS.original}?s=20&t=abc`) === IDS.original
  );
  ok("a bare id", tweetIdFrom(IDS.original) === IDS.original);
  ok("a profile URL is not a post", tweetIdFrom("https://x.com/andra") === null);
  ok("prose is not a post", tweetIdFrom("look at this thing") === null);

  console.log("\nHydration — no API key, no connected account");
  const source = new SyndicationSource();
  const hydrated = await source.hydrate([
    `https://x.com/andra/status/${IDS.original}`,
  ]);
  ok("a post comes back", hydrated.length >= 1, `${hydrated.length}`);

  const original = hydrated.find((p) => p.externalId === IDS.original);
  ok("with its text", original?.text.includes("stingy man") === true);
  ok("its author", original?.authorHandle === "@SOghenerukewe");
  ok("verification", original?.authorVerified === true);
  ok("counts", (original?.likes ?? 0) > 0 && (original?.reposts ?? 0) > 0);
  ok(
    "a permalink built from the handle",
    original?.permalink === `https://x.com/SOghenerukewe/status/${IDS.original}`
  );
  ok(
    "views are zero rather than invented — the endpoint doesn't report them",
    original?.views === 0
  );
  ok("the token was sent", fake.requested.length > 0);

  const video = await source.hydrate([IDS.video]);
  ok("a video is classified as one", video[0]?.mediaType === "video");
  ok("with its media url", (video[0]?.mediaUrls.length ?? 0) === 1);

  const carousel = await source.hydrate([IDS.carousel]);
  ok(
    "several photos read as a carousel",
    carousel.find((p) => p.externalId === IDS.carousel)?.mediaType === "carousel"
  );
  ok(
    "and a parent comes back with it, free, in the same response",
    carousel.some((p) => p.externalId === IDS.carouselParent),
    `${carousel.length} posts`
  );

  const partial = await source.hydrate([IDS.original, DELETED_ID]);
  ok(
    "a deleted post doesn't lose the batch",
    partial.some((p) => p.externalId === IDS.original),
    `${partial.length} of 2`
  );

  console.log("\nCapabilities are declared, not discovered");
  const caps = source.supports();
  ok("conversations are supported", caps.conversations);
  ok("search is not", !caps.search);
  ok("trends are not", !caps.trends);
  ok("timelines are not", !caps.timelines);
  await throws("and search refuses rather than returning empty", () => source.search());
  await throws("as do trends", () => source.trends());
  ok(
    "each refusal explains itself in words a person can act on",
    (source.unavailableReason("search") ?? "").includes("paid X API tier")
  );

  console.log("\nRanking");
  const strong = post({
    externalId: "r1",
    text: "Your mummy don cry come ur room again , Chaii.",
    likes: 31000,
    reposts: 5100,
    replies: 240,
  });
  const weak = post({ externalId: "r2", text: "ok", likes: 3, reposts: 0, replies: 0 });
  const parent = post({ externalId: "o1", likes: 4200, reposts: 190 });

  const scored = await scoreReplies(session, {
    original: parent,
    replies: [weak, strong],
  });
  const best = scored.find((s) => s.post.externalId === "r1")!;
  const worst = scored.find((s) => s.post.externalId === "r2")!;

  ok("a reply that outdid its original scores high", best.score.total > worst.score.total,
    `${best.score.total} vs ${worst.score.total}`);
  ok("virality is the reply against its parent", best.score.virality > worst.score.virality);
  ok("scores stay inside 0–100",
    scored.every((s) => s.score.total >= 0 && s.score.total <= 100));

  // The property the whole design rests on: no model means no claim about wit.
  const noModel = !process.env.ANTHROPIC_API_KEY;
  if (noModel) {
    ok("with no model, humour is null rather than guessed", best.score.humour === null);
    ok("and the basis says engagement-only", best.score.basis === "engagement-only");
  } else {
    ok("with a model, the basis is full", best.score.basis === "full");
  }

  // Log scaling, checked directly: linear scaling makes one viral reply 100 and
  // everything else 2, which is a winner rather than a ranking.
  const mid = await scoreReplies(session, {
    original: parent,
    replies: [post({ externalId: "m", likes: 400, reposts: 40 })],
  });
  ok(
    "a mid-sized reply lands in the middle, not at the floor",
    mid[0]!.score.engagement > 25 && mid[0]!.score.engagement < 90,
    `${mid[0]!.score.engagement}`
  );

  console.log("\nParsing the model's wit scores");
  ok(
    "a clean array parses",
    parseWit('[{"id":"a","humour":80,"roast":20}]')?.get("a")?.humour === 80
  );
  ok(
    "a fenced array parses — models add fences even when told not to",
    parseWit('```json\n[{"id":"a","humour":70,"roast":10}]\n```')?.get("a")?.roast === 10
  );
  ok(
    "prose around it parses",
    parseWit('Here you go:\n[{"id":"a","humour":50,"roast":50}]\nHope that helps')?.size === 1
  );
  ok("out-of-range values are clamped", parseWit('[{"id":"a","humour":900,"roast":-5}]')?.get("a")?.humour === 100);
  ok("nonsense returns null rather than throwing", parseWit("no json here") === null);
  ok("a non-array returns null", parseWit('{"id":"a"}') === null);

  console.log("\nIngest builds stories");
  const result = await ingest(session, [
    `https://x.com/andra/status/${IDS.original}`,
  ]);
  ok("posts are stored", result.posts > 0, `${result.posts}`);
  ok("a story is built", result.stories === 1, `${result.stories}`);

  const feed = await listStories(session, { kind: XStoryKind.SAVAGE });
  ok("the story is listed", feed.stories.length === 1);

  const story = feed.stories[0]!;
  ok("it carries the original", story.original?.externalId === IDS.original);
  ok("and its replies", story.replies.length === 2, `${story.replies.length}`);
  ok(
    "ranked best first — the reply that beat the post leads",
    story.replies[0]?.externalId === IDS.bestReply,
    story.replies[0]?.text.slice(0, 30)
  );
  ok("the story's score is its best reply's", story.score > 0, `${story.score}`);
  ok("and the scoring basis is recorded for the UI", typeof story.scoring.basis === "string");

  console.log("\nIngest is idempotent");
  const again = await ingest(session, [`https://x.com/andra/status/${IDS.original}`]);
  ok("re-pasting builds no second story", again.stories === 1);
  ok(
    "and the database agrees",
    (await db.xStory.count({ where: { orgId: session.orgId } })) === 1
  );
  ok(
    "the original is stored once",
    (await db.xPost.count({
      where: { orgId: session.orgId, externalId: IDS.original },
    })) === 1
  );

  console.log("\nUnreadable links are named, not swallowed");
  const skipped = await ingest(session, [
    `https://x.com/a/status/${DELETED_ID}`,
    "not-a-link",
  ]);
  ok("both are reported", skipped.skipped.length === 2, skipped.skipped.join(", "));

  console.log("\nSaving");
  await setSaved(session, { storyId: story.id, saved: true });
  const savedFeed = await listStories(session, { saved: true });
  ok("a saved story is findable", savedFeed.stories.length === 1);
  ok("counts agree", (await hubCounts(session)).saved === 1);
  await setSaved(session, { storyId: story.id, saved: false });
  ok("and unsaving works", (await hubCounts(session)).saved === 0);

  console.log("\nIsolation");
  const other = await db.organization.create({
    data: { name: `xhub-${Date.now()}`, slug: `xhub-${Date.now()}` },
  });
  const outsider: Session = { ...session, orgId: other.id };
  ok(
    "another org sees none of these stories",
    (await listStories(outsider)).stories.length === 0
  );
  await throws("and cannot save one", () =>
    setSaved(outsider, { storyId: story.id, saved: true })
  );

  console.log("\nPagination");
  // Two more stories so a page of two has a cursor.
  await ingest(session, [IDS.video, IDS.carousel]);
  const firstPage = await listStories(session, { take: 1 });
  ok("a page is capped at its size", firstPage.stories.length === 1);
  ok("and hands back a cursor", firstPage.nextCursor !== null);
  const secondPage = await listStories(session, {
    take: 5,
    cursor: firstPage.nextCursor,
  });
  ok(
    "the next page does not repeat the first",
    secondPage.stories.every((s) => s.id !== firstPage.stories[0]!.id),
    `${secondPage.stories.length} more`
  );

  console.log("\nTrends derived from the corpus");
  const derived = await deriveTrends(session);
  ok("topics come back", derived.length > 0, derived.map((t) => t.topic).join(", ") || "none");
  ok(
    "ranked by reach, not frequency",
    derived.every((t, i) => i === 0 || derived[i - 1]!.reach >= t.reach)
  );
  ok("each names how many posts it came from", derived.every((t) => t.posts > 0));

  console.log("\nNews, Gists and the story builders");
  const stored = await db.xPost.findMany({
    where: { orgId: session.orgId },
    select: { id: true },
    take: 3,
  });

  const newsStory = await buildNewsStory(session, stored.map((p) => p.id));
  ok("a news item is built", newsStory !== null, newsStory?.title.slice(0, 40));

  const newsRow = await db.xStory.findFirst({
    where: { orgId: session.orgId, kind: XStoryKind.NEWS },
  });
  ok("with a summary", Boolean(newsRow?.summary));
  const timeline = (newsRow?.details as { timeline?: unknown[] })?.timeline ?? [];
  ok("and a timeline computed from the rows", timeline.length === stored.length,
    `${timeline.length} entries`);
  ok(
    "ordered oldest first — sequence is a fact, not a model's guess",
    (timeline as { at: string }[]).every(
      (entry, i) => i === 0 || entry.at >= (timeline as { at: string }[])[i - 1]!.at
    )
  );
  ok(
    "the internal key never reaches a screen",
    visibleTopics(newsRow?.topics ?? []).every((t) => !t.startsWith("__key:"))
  );

  const rebuilt = await buildNewsStory(session, stored.map((p) => p.id));
  ok(
    "rebuilding refreshes rather than duplicating",
    (await db.xStory.count({
      where: { orgId: session.orgId, kind: XStoryKind.NEWS },
    })) === 1,
    rebuilt?.title.slice(0, 20)
  );

  const gist = await buildGist(session, stored.map((p) => p.id));
  ok("a gist is built", gist !== null);
  const gistRow = await db.xStory.findFirst({
    where: { orgId: session.orgId, kind: XStoryKind.GIST },
  });
  const gistDetails = (gistRow?.details ?? {}) as Record<string, unknown>;
  ok("it carries a details payload", Object.keys(gistDetails).length > 0,
    Object.keys(gistDetails).join(", "));
  ok(
    "hashtags are hashtags or absent — never half-parsed prose",
    !Array.isArray(gistDetails.hashtags) ||
      (gistDetails.hashtags as string[]).every((tag) => tag.startsWith("#"))
  );

  const topic = derived[0]?.topic;
  if (topic) {
    const trendStory = await buildTrendStory(session, topic);
    ok("a trend is explained", trendStory !== null, topic);
    ok(
      "and stored under its own kind",
      (await db.xStory.count({
        where: { orgId: session.orgId, kind: XStoryKind.TREND },
      })) === 1
    );
  }
  ok(
    "a topic nothing mentions builds nothing rather than an empty story",
    (await buildTrendStory(session, "zzzznothingmentionsthis")) === null
  );

  console.log("\nVideos, creators and analytics");
  const vids = await listVideos(session);
  ok("videos are found", vids.length > 0, `${vids.length}`);
  ok("all of them are videos", vids.every((v) => v.mediaType === "video"));
  ok(
    "ranked by what they earned",
    vids.every((v, i) => i === 0 || vids[i - 1]!.likes >= v.likes)
  );

  const people = await listCreators(session);
  ok("creators are found", people.length > 0, `${people.length}`);
  ok(
    "ranked by average, not total — total just rewards who you collected most of",
    people.every((c, i) => i === 0 || people[i - 1]!.average >= c.average)
  );
  ok("each carries its post count", people.every((c) => c.posts > 0));

  const analytics = await hubAnalytics(session);
  ok("analytics counts posts", analytics.posts > 0, `${analytics.posts}`);
  ok("and stories by kind", Object.keys(analytics.byKind).length > 0,
    Object.keys(analytics.byKind).join(", "));
  ok("and total interactions", analytics.interactions > 0);
  ok("creator count agrees with the list", analytics.creators >= people.length);

  console.log("\nIsolation, again — the new surfaces");
  ok("another org derives no trends", (await deriveTrends(outsider)).length === 0);
  ok("sees no videos", (await listVideos(outsider)).length === 0);
  ok("no creators", (await listCreators(outsider)).length === 0);
  ok("and empty analytics", (await hubAnalytics(outsider)).posts === 0);

  console.log("\nCleanup");
  await db.xStory.deleteMany({ where: { orgId: session.orgId } });
  await db.xPost.deleteMany({ where: { orgId: session.orgId } });
  await db.organization.delete({ where: { id: other.id } });
  await fake.close();
  console.log("  ✓ test rows removed");

  console.log(
    `\n${failures === 0 ? "✓" : "✗"} ${checks - failures}/${checks} checks passed\n`
  );
  await db.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("\nX Hub e2e threw:\n", error);
  await db.$disconnect();
  process.exit(1);
});
