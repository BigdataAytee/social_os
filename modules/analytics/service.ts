import { Platform } from "@prisma/client";

import type { Session } from "@/lib/auth/session";
import { db } from "@/lib/db";

/**
 * Analytics reads (ARCHITECTURE.md §12). Every chart in the product goes
 * through here — no screen may hardcode numbers.
 */

export type SeriesPoint = {
  date: string;
  followers: number;
  reach: number;
  engagement: number;
  impressions: number;
  clicks: number;
};

export type PlatformSeries = {
  platform: Platform;
  handle: string;
  points: SeriesPoint[];
};

function since(days: number) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

export async function getSeries(
  session: Session,
  opts: { platform?: Platform; days?: number } = {}
): Promise<PlatformSeries[]> {
  const days = opts.days ?? 30;

  const accounts = await db.connectedAccount.findMany({
    where: {
      orgId: session.orgId,
      ...(opts.platform ? { platform: opts.platform } : {}),
    },
    include: {
      snapshots: {
        where: { date: { gte: since(days) } },
        orderBy: { date: "asc" },
      },
    },
    orderBy: { platform: "asc" },
  });

  return accounts.map((account) => ({
    platform: account.platform,
    handle: account.handle,
    points: account.snapshots.map((s) => ({
      date: s.date.toISOString().slice(0, 10),
      followers: s.followers,
      reach: s.reach,
      engagement: s.engagement,
      impressions: s.impressions,
      clicks: s.clicks,
    })),
  }));
}

export type Totals = {
  followers: number;
  reach: number;
  engagement: number;
  impressions: number;
  clicks: number;
  /** Percent change vs the preceding window of equal length. */
  deltas: Record<"followers" | "reach" | "engagement" | "impressions", number>;
  engagementRate: number;
};

/**
 * Headline numbers. Deltas compare the requested window against the window
 * immediately before it, so "last 30 days" is judged against the 30 before that.
 */
export async function getTotals(
  session: Session,
  opts: { platform?: Platform; days?: number } = {}
): Promise<Totals> {
  const days = opts.days ?? 30;

  const accountIds = (
    await db.connectedAccount.findMany({
      where: {
        orgId: session.orgId,
        ...(opts.platform ? { platform: opts.platform } : {}),
      },
      select: { id: true },
    })
  ).map((a) => a.id);

  if (accountIds.length === 0) {
    return {
      followers: 0,
      reach: 0,
      engagement: 0,
      impressions: 0,
      clicks: 0,
      deltas: { followers: 0, reach: 0, engagement: 0, impressions: 0 },
      engagementRate: 0,
    };
  }

  const snapshots = await db.analyticsSnapshot.findMany({
    where: { accountId: { in: accountIds }, date: { gte: since(days * 2) } },
    orderBy: { date: "asc" },
  });

  const cutoff = since(days);
  const current = snapshots.filter((s) => s.date >= cutoff);
  const previous = snapshots.filter((s) => s.date < cutoff);

  const sum = (rows: typeof snapshots, key: "reach" | "engagement" | "impressions" | "clicks") =>
    rows.reduce((acc, r) => acc + r[key], 0);

  // Followers is a level, not a flow — take the latest reading per account.
  const latestFollowers = (rows: typeof snapshots) => {
    const byAccount = new Map<string, number>();
    for (const row of rows) byAccount.set(row.accountId, row.followers);
    return [...byAccount.values()].reduce((a, b) => a + b, 0);
  };

  const followers = latestFollowers(current);
  const prevFollowers = latestFollowers(previous);
  const reach = sum(current, "reach");
  const engagement = sum(current, "engagement");
  const impressions = sum(current, "impressions");
  const clicks = sum(current, "clicks");

  const pct = (now: number, before: number) =>
    before === 0 ? 0 : ((now - before) / before) * 100;

  return {
    followers,
    reach,
    engagement,
    impressions,
    clicks,
    engagementRate: reach === 0 ? 0 : (engagement / reach) * 100,
    deltas: {
      followers: pct(followers, prevFollowers),
      reach: pct(reach, sum(previous, "reach")),
      engagement: pct(engagement, sum(previous, "engagement")),
      impressions: pct(impressions, sum(previous, "impressions")),
    },
  };
}

/**
 * Best posting times, derived from published posts and the engagement recorded
 * on their day — not a hardcoded "post at 9am" table.
 */
export async function getBestPostingTimes(
  session: Session,
  platform?: Platform
) {
  const posts = await db.post.findMany({
    where: {
      orgId: session.orgId,
      status: "PUBLISHED",
      publishedAt: { not: null },
      ...(platform ? { platform } : {}),
    },
    select: { publishedAt: true, platform: true },
  });

  const accounts = await db.connectedAccount.findMany({
    where: { orgId: session.orgId, ...(platform ? { platform } : {}) },
    select: { id: true, platform: true },
  });

  const snapshots = await db.analyticsSnapshot.findMany({
    where: { accountId: { in: accounts.map((a) => a.id) } },
    select: { accountId: true, date: true, engagement: true },
  });

  const platformOf = new Map(accounts.map((a) => [a.id, a.platform]));
  const engagementByDay = new Map<string, number>();
  for (const s of snapshots) {
    const key = `${platformOf.get(s.accountId)}:${s.date.toISOString().slice(0, 10)}`;
    engagementByDay.set(key, (engagementByDay.get(key) ?? 0) + s.engagement);
  }

  const buckets = new Map<string, { total: number; count: number }>();
  for (const post of posts) {
    if (!post.publishedAt) continue;
    const day = post.publishedAt.getUTCDay();
    const hour = post.publishedAt.getUTCHours();
    const key = `${day}:${hour}`;
    const engagement =
      engagementByDay.get(
        `${post.platform}:${post.publishedAt.toISOString().slice(0, 10)}`
      ) ?? 0;
    const bucket = buckets.get(key) ?? { total: 0, count: 0 };
    bucket.total += engagement;
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .map(([key, v]) => {
      const [day, hour] = key.split(":").map(Number);
      return { day, hour, score: Math.round(v.total / v.count), posts: v.count };
    })
    .sort((a, b) => b.score - a.score);
}

export async function listConnectedAccounts(session: Session) {
  return db.connectedAccount.findMany({
    where: { orgId: session.orgId },
    orderBy: { platform: "asc" },
  });
}

export async function listCompetitors(session: Session, platform?: Platform) {
  return db.competitor.findMany({
    where: { orgId: session.orgId, ...(platform ? { platform } : {}) },
    orderBy: { handle: "asc" },
  });
}
