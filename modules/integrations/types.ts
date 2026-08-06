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

/**
 * Thrown by an adapter whose connection genuinely cannot read an inbox — a
 * read-only OAuth scope set, or a provider that doesn't expose comments.
 *
 * A distinct type rather than a generic Error because the sync loop treats it
 * differently: it is a permanent fact about the connection, not a transient
 * failure, so it must not be retried or recorded as an outage.
 */
export class InboxUnsupportedError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "InboxUnsupportedError";
  }
}

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

/**
 * One inbound item — a comment, a mention, or a DM — normalised across
 * platforms (OS-ARCHITECTURE.md §11 stage 5).
 *
 * `threadId` rather than "post id": on X a mention's thread is a conversation,
 * on Instagram a comment's thread is the media it hangs off, and in a DM it's
 * the participant pair. Naming it after the shape they share is what keeps one
 * inbox from growing five branches.
 */
export type InboxItemData = {
  threadId: string;
  messageId: string;
  kind: "COMMENT" | "MENTION" | "DM";
  authorHandle: string;
  authorName: string | null;
  text: string;
  sentAt: Date;
  permalink: string | null;
  /** Our own post the item hangs off, when the platform tells us. */
  externalPostId: string | null;
};

export type ReplyResult =
  | { ok: true; externalId: string }
  | { ok: false; error: string };

export interface PlatformAdapter {
  platform: Platform;
  publish(post: Post): Promise<PublishResult>;
  /**
   * Comments, mentions and DMs since a moment.
   *
   * Returning `[]` and *throwing* mean different things and callers depend on
   * it: empty is "nothing new", a throw is "this didn't work". An adapter with
   * no inbox capability must throw `InboxUnsupportedError` rather than
   * returning empty, or a broken integration reads as a quiet inbox — which is
   * exactly the failure the person using it can't detect.
   */
  fetchInbox(accountId: string, since: Date): Promise<InboxItemData[]>;
  /** Send a reply into an existing thread. */
  replyTo(
    accountId: string,
    threadId: string,
    text: string
  ): Promise<ReplyResult>;
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
