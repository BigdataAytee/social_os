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

export interface PlatformAdapter {
  platform: Platform;
  publish(post: Post): Promise<PublishResult>;
  fetchAnalytics(accountId: string, since: Date): Promise<Snapshot[]>;
  fetchTrends(): Promise<Trend[]>;
}
