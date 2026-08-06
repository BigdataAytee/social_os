import { Platform, type Post } from "@prisma/client";

import { db } from "@/lib/db";
import type {
  ExternalPostData,
  InboxItemData,
  PlatformAdapter,
  PublishResult,
  ReplyResult,
  Snapshot,
  Trend,
} from "./types";

/**
 * The v1 adapter for every platform (ARCHITECTURE.md §10).
 *
 * Analytics reads real AnalyticsSnapshot rows rather than inventing numbers, so
 * the mock and a future real adapter return the same shape from the same table.
 * Trends are deterministic per platform per day — they change day to day like a
 * real feed, but two page loads in the same day agree with each other.
 */

const TREND_POOL: Record<Platform, { topic: string; category: string }[]> = {
  [Platform.X]: [
    { topic: "content operations", category: "Marketing" },
    { topic: "creator economy", category: "Business" },
    { topic: "posting cadence", category: "Marketing" },
    { topic: "algorithm changes", category: "Platform" },
    { topic: "brand voice", category: "Marketing" },
    { topic: "social ROI", category: "Analytics" },
    { topic: "thread writing", category: "Craft" },
    { topic: "community management", category: "Marketing" },
  ],
  [Platform.TIKTOK]: [
    { topic: "#smallbusinesscheck", category: "Business" },
    { topic: "day in the life", category: "Lifestyle" },
    { topic: "green screen explainer", category: "Format" },
    { topic: "#marketingtips", category: "Marketing" },
    { topic: "behind the scenes", category: "Format" },
    { topic: "trending: Quiet Morning", category: "Sound" },
    { topic: "3-second hook", category: "Craft" },
    { topic: "#contentcreator", category: "Creator" },
  ],
  [Platform.INSTAGRAM]: [
    { topic: "carousel teardowns", category: "Format" },
    { topic: "#reelsstrategy", category: "Format" },
    { topic: "save-rate optimisation", category: "Analytics" },
    { topic: "story polls", category: "Engagement" },
    { topic: "brand photography", category: "Craft" },
    { topic: "#socialmediamanager", category: "Career" },
    { topic: "caption hooks", category: "Craft" },
    { topic: "grid planning", category: "Planning" },
  ],
  [Platform.FACEBOOK]: [
    { topic: "group-led growth", category: "Community" },
    { topic: "event promotion", category: "Marketing" },
    { topic: "long-form posts", category: "Format" },
    { topic: "local business pages", category: "Business" },
    { topic: "comment moderation", category: "Community" },
    { topic: "Messenger automation", category: "Support" },
    { topic: "reach decline", category: "Platform" },
    { topic: "community guidelines", category: "Policy" },
  ],
  [Platform.YOUTUBE]: [
    { topic: "thumbnail A/B testing", category: "Craft" },
    { topic: "retention curves", category: "Analytics" },
    { topic: "Shorts strategy", category: "Format" },
    { topic: "video SEO", category: "Discovery" },
    { topic: "title formulas", category: "Craft" },
    { topic: "faceless channels", category: "Format" },
    { topic: "chapter markers", category: "Craft" },
    { topic: "end screens", category: "Retention" },
  ],
};

/** Stable hash so the same (platform, topic, day) always yields the same volume. */
function hash(input: string) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

export class MockAdapter implements PlatformAdapter {
  constructor(public readonly platform: Platform) {}

  async publish(post: Post): Promise<PublishResult> {
    // The mock always succeeds. A real adapter's failures surface through the
    // same PublishResult union, so the caller needs no new branch later.
    const externalId = `mock_${post.id.slice(-10)}`;
    return {
      ok: true,
      externalId,
      url: `https://example.com/${this.platform.toLowerCase()}/${externalId}`,
    };
  }

  async fetchAnalytics(accountId: string, since: Date): Promise<Snapshot[]> {
    const rows = await db.analyticsSnapshot.findMany({
      where: { accountId, date: { gte: since } },
      orderBy: { date: "asc" },
    });
    return rows.map((r) => ({
      date: r.date,
      followers: r.followers,
      reach: r.reach,
      engagement: r.engagement,
      impressions: r.impressions,
      clicks: r.clicks,
    }));
  }

  async fetchTrends(): Promise<Trend[]> {
    const day = new Date().toISOString().slice(0, 10);
    return TREND_POOL[this.platform]
      .map(({ topic, category }) => {
        const seed = hash(`${this.platform}:${topic}:${day}`);
        return {
          topic,
          category,
          volume: Math.round(2_000 + seed * 180_000),
          change: Math.round((seed - 0.35) * 180),
        };
      })
      .sort((a, b) => b.volume - a.volume);
  }

  /**
   * Derived from the org's own published posts rather than invented, so a demo
   * org's insights describe content that actually exists in the app and the
   * numbers move with the seeded analytics. Engagement is apportioned from the
   * day's snapshot, which keeps the mock and a real pull the same shape.
   */
  async fetchPosts(accountId: string, since: Date): Promise<ExternalPostData[]> {
    const account = await db.connectedAccount.findUnique({
      where: { id: accountId },
      select: { orgId: true },
    });
    if (!account) return [];

    const [posts, snapshots] = await Promise.all([
      db.post.findMany({
        where: {
          orgId: account.orgId,
          platform: this.platform,
          status: "PUBLISHED",
          publishedAt: { gte: since },
        },
        orderBy: { publishedAt: "desc" },
        take: 50,
      }),
      db.analyticsSnapshot.findMany({
        where: { accountId, date: { gte: since } },
      }),
    ]);

    const byDay = new Map(
      snapshots.map((s) => [s.date.toISOString().slice(0, 10), s])
    );

    return posts
      .filter((post): post is typeof post & { publishedAt: Date } =>
        Boolean(post.publishedAt)
      )
      .map((post) => {
        const day = post.publishedAt.toISOString().slice(0, 10);
        const snapshot = byDay.get(day);
        const seed = hash(`${this.platform}:${post.id}`);

        // A share of that day's engagement, weighted by a per-post seed so the
        // ordering is stable across reloads but not uniform.
        const engagement = Math.round((snapshot?.engagement ?? 400) * (0.15 + seed * 0.5));
        const views = Math.round((snapshot?.impressions ?? 5_000) * (0.1 + seed * 0.4));

        const platformData = post.platformData as Record<string, unknown>;
        const mediaType: ExternalPostData["mediaType"] =
          this.platform === Platform.TIKTOK || this.platform === Platform.YOUTUBE
            ? "video"
            : Array.isArray(platformData?.slides)
              ? "carousel"
              : Array.isArray(platformData?.media) && platformData.media.length > 0
                ? "image"
                : "text";

        return {
          externalId: `mock_${post.id.slice(-12)}`,
          permalink: `https://example.com/${this.platform.toLowerCase()}/${post.id.slice(-12)}`,
          text: post.body,
          mediaType,
          publishedAt: post.publishedAt,
          likes: Math.round(engagement * 0.72),
          comments: Math.round(engagement * 0.14),
          shares: Math.round(engagement * 0.14),
          views,
          metrics: { saves: Math.round(engagement * 0.08) },
        };
      });
  }

  /**
   * Comments and mentions hanging off the org's own published posts.
   *
   * Same principle as `fetchPosts`: derived from content that actually exists
   * rather than invented, so the inbox in a demo org is about the posts in that
   * demo org. Deterministic per post, so two syncs agree and the dedupe path in
   * `ingest` is exercised rather than papered over by fresh random ids.
   *
   * The mix is deliberately not all-positive. An inbox where nothing is ever
   * negative can't demonstrate triage, and triage is the feature.
   */
  async fetchInbox(accountId: string, since: Date): Promise<InboxItemData[]> {
    const account = await db.connectedAccount.findUnique({
      where: { id: accountId },
      select: { orgId: true, handle: true },
    });
    if (!account) return [];

    const posts = await db.post.findMany({
      where: {
        orgId: account.orgId,
        platform: this.platform,
        status: "PUBLISHED",
        publishedAt: { gte: since },
      },
      orderBy: { publishedAt: "desc" },
      take: 20,
    });

    const items: InboxItemData[] = [];

    for (const post of posts) {
      if (!post.publishedAt) continue;
      const seed = hash(`inbox:${this.platform}:${post.id}`);
      // Zero to three per post: some posts get nothing, which is what makes the
      // inbox look like an inbox rather than a uniform grid.
      const count = Math.floor(seed * 4);

      for (let i = 0; i < count; i++) {
        const itemSeed = hash(`inbox:${post.id}:${i}`);
        const template = COMMENT_TEMPLATES[
          Math.floor(itemSeed * COMMENT_TEMPLATES.length)
        ]!;
        items.push({
          threadId: `mock_thread_${post.id.slice(-10)}_${i}`,
          messageId: `mock_msg_${post.id.slice(-10)}_${i}`,
          kind: itemSeed > 0.85 ? "DM" : itemSeed > 0.7 ? "MENTION" : "COMMENT",
          authorHandle: `@${HANDLES[Math.floor(itemSeed * HANDLES.length)]}`,
          authorName: null,
          text: template,
          // Spread through the hours after the post went out.
          sentAt: new Date(
            post.publishedAt.getTime() + (1 + i) * 3_600_000 * (1 + itemSeed * 5)
          ),
          permalink: `https://example.com/${this.platform.toLowerCase()}/${post.id.slice(-12)}#c${i}`,
          externalPostId: `mock_${post.id.slice(-12)}`,
        });
      }
    }

    return items.filter((item) => item.sentAt >= since);
  }

  async replyTo(
    accountId: string,
    threadId: string,
    text: string
  ): Promise<ReplyResult> {
    if (!text.trim()) return { ok: false, error: "A reply can't be empty" };
    return { ok: true, externalId: `mock_reply_${hash(threadId + text).toString(36).slice(2, 12)}` };
  }
}

/**
 * Written to span the range triage has to handle: praise, a real question, a
 * complaint, a lead, and spam. A demo inbox of five variations on "great post!"
 * would make the sentiment and priority columns look like they work when they
 * had nothing to distinguish.
 */
const COMMENT_TEMPLATES = [
  "This is genuinely useful, thanks for writing it up.",
  "Wait, how does this work if the team is remote?",
  "Disagree — we tried this and it made retention worse, not better.",
  "Do you offer this as a service? Would like to talk about pricing.",
  "Saved. Sending this to my whole team.",
  "This didn't work for us at all. Really disappointed, we wasted a quarter on it.",
  "What tool are you using for the charts?",
  "🔥🔥🔥",
  "Third time I've asked and still no reply. Is anyone actually reading these?",
  "Great breakdown. Any chance of a follow-up on the measurement side?",
];

const HANDLES = [
  "priya_builds",
  "marcus.ops",
  "the_growth_desk",
  "jenna_writes",
  "devon_r",
  "smallteamcmo",
  "kofi_analytics",
  "rowan.media",
];
