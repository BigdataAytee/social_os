import { Platform, type Post } from "@prisma/client";

import { db } from "@/lib/db";
import type { PlatformAdapter, PublishResult, Snapshot, Trend } from "./types";

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
}
