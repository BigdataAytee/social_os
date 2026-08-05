import type { Platform, Post } from "@prisma/client";

/**
 * One interface per capability (ARCHITECTURE.md §10).
 *
 * v1 ships MockAdapter for all five platforms. The UI reads
 * ConnectedAccount.status for display only and must never branch its behaviour
 * on mock vs real — when a real adapter lands, only the registry entry changes.
 */

export type PublishResult =
  | { ok: true; externalId: string; url: string }
  | { ok: false; error: string };

export type Trend = {
  topic: string;
  /** Posts/videos/mentions in the last 24h, as the platform reports it. */
  volume: number;
  /** Percent change vs the previous day. */
  change: number;
  category: string;
};

export type Snapshot = {
  date: Date;
  followers: number;
  reach: number;
  engagement: number;
  impressions: number;
  clicks: number;
};

/**
 * One post as the platform reports it, normalised across all five.
 *
 * `mediaType` is the deliberate normalisation: TikTok has only videos, X calls
 * them "media attachments", YouTube has nothing else, and Instagram
 * distinguishes REELS from CAROUSEL_ALBUM. Collapsing them to four values is
 * what lets insights compare formats across platforms instead of per-platform
 * vocabularies that can't be aggregated.
 */
export type ExternalPostData = {
  externalId: string;
  permalink: string | null;
  text: string;
  mediaType: "video" | "image" | "carousel" | "text";
  publishedAt: Date;
  likes: number;
  comments: number;
  shares: number;
  views: number;
  /** Platform-specific extras — saves, watch time, click-throughs. */
  metrics: Record<string, number>;
};

export interface PlatformAdapter {
  platform: Platform;
  publish(post: Post): Promise<PublishResult>;
  fetchAnalytics(accountId: string, since: Date): Promise<Snapshot[]>;
  fetchTrends(): Promise<Trend[]>;
  /**
   * Recent posts with the metrics the platform reports for each.
   *
   * Added for the connected-account feature: AnalyticsSnapshot's daily rollups
   * can say engagement rose, but not which post caused it or what format it
   * was, and both are what idea generation needs.
   */
  fetchPosts(accountId: string, since: Date): Promise<ExternalPostData[]>;
}
