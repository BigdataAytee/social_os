import { Platform } from "@prisma/client";

import type { Session } from "@/lib/auth/session";
import { db } from "@/lib/db";
import benchmarks from "./benchmarks.json";

/**
 * The Growth Strategist's statistical half (Growth-Strategist-Engine.md §1, §2).
 *
 * Statistics plus one LLM step, not a trained model. A new org has no
 * proprietary training data on day one and standing up training infrastructure
 * for that would be disproportionate — real numbers from the org's own history,
 * recomputed as they grow, gets "smarter over time" honestly and cheaply. This
 * file is the recompute pipeline; there is no training pipeline.
 *
 * Everything here is a plain aggregation. Only `briefing.ts` hits the model.
 */

export type Confidence = "low" | "medium" | "high";

/** §3: a straightforward sample-size threshold is enough. */
const MIN_FOR_OWN_DATA = benchmarks.minimumPostsForOwnData;
const MEDIUM_AT = 25;
const HIGH_AT = 60;

export function confidenceFor(sampleSize: number): Confidence {
  if (sampleSize >= HIGH_AT) return "high";
  if (sampleSize >= MEDIUM_AT) return "medium";
  return "low";
}

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export type BestTimeSlot = {
  day: number;
  dayName: string;
  hour: number;
  posts: number;
  averageEngagementRate: number;
};

export type ContentTypeRow = {
  /** `platformData.kind` — thread vs tweet, carousel vs reel (§1.2). */
  kind: string;
  posts: number;
  averageEngagementRate: number;
  liftVsAverage: number;
};

export type BestTimePayload = {
  slots: BestTimeSlot[];
  /** Set when there wasn't enough history and benchmarks were used instead. */
  fallback: string | null;
};

export type ContentTypePayload = {
  rows: ContentTypeRow[];
  fallback: string | null;
};

export type Recomputed = {
  platform: Platform;
  type: "best-time" | "content-type-ranking" | "weekly-briefing";
  payload: BestTimePayload | ContentTypePayload | Record<string, unknown>;
  confidence: Confidence;
  basedOnDataThrough: Date;
  sampleSize: number;
};

/**
 * Engagement rate, not raw engagement — an account that grew during the window
 * would otherwise score every recent post highest, which is an artefact rather
 * than a finding.
 */
function rateOf(post: {
  likes: number;
  comments: number;
  shares: number;
  views: number;
}): number {
  const interactions = post.likes + post.comments + post.shares;
  if (post.views <= 0) return interactions === 0 ? 0 : interactions;
  return (interactions / post.views) * 100;
}

function mean(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((a, b) => a + b, 0) / values.length;
}

function benchmarkFor(platform: Platform) {
  return benchmarks.platforms[platform as keyof typeof benchmarks.platforms];
}

/**
 * "Which past posting times correlated with above-average engagement for this
 * account" — literally that, not an AI guess (§1.1).
 *
 * Weekday and hour are bucketed together: "Tuesday" and "9am" can each look
 * good separately while Tuesday 9am was never actually tried.
 */
export async function recomputeBestTimes(
  orgId: string,
  platform: Platform
): Promise<Recomputed> {
  const posts = await db.externalPost.findMany({
    where: { orgId, account: { platform } },
    orderBy: { publishedAt: "desc" },
    take: 500,
  });

  const freshest = posts[0]?.publishedAt ?? new Date();

  if (posts.length < MIN_FOR_OWN_DATA) {
    return {
      platform,
      type: "best-time",
      payload: { slots: [], fallback: benchmarkFor(platform).bestTimes },
      confidence: "low",
      basedOnDataThrough: freshest,
      sampleSize: posts.length,
    };
  }

  const buckets = new Map<string, number[]>();
  for (const post of posts) {
    const key = `${post.publishedAt.getUTCDay()}:${post.publishedAt.getUTCHours()}`;
    buckets.set(key, [...(buckets.get(key) ?? []), rateOf(post)]);
  }

  const slots = [...buckets.entries()]
    // Two posts in a slot is noise. A "best time" drawn from that is worse than
    // no answer, because it will be believed.
    .filter(([, values]) => values.length >= 3)
    .map(([key, values]) => {
      const [day, hour] = key.split(":").map(Number);
      return {
        day: day!,
        dayName: DAY_NAMES[day!]!,
        hour: hour!,
        posts: values.length,
        averageEngagementRate: mean(values),
      };
    })
    .sort((a, b) => b.averageEngagementRate - a.averageEngagementRate)
    .slice(0, 5);

  return {
    platform,
    type: "best-time",
    payload: {
      slots,
      fallback: slots.length === 0 ? benchmarkFor(platform).bestTimes : null,
    },
    confidence: slots.length === 0 ? "low" : confidenceFor(posts.length),
    basedOnDataThrough: freshest,
    sampleSize: posts.length,
  };
}

/**
 * Content-type ranking (§1.2) — groups by the native `platformData.kind` so a
 * Studio can say "carousels out-save your reels 3:1 this month".
 *
 * Reads authored `Post` rows for the kind and `ExternalPost` for the outcome,
 * matched on publish time: `platformData` only exists on posts written here,
 * while the metrics only exist on what the platform reported back.
 */
export async function recomputeContentTypeRanking(
  orgId: string,
  platform: Platform
): Promise<Recomputed> {
  const [authored, external] = await Promise.all([
    db.post.findMany({
      where: { orgId, platform, status: "PUBLISHED", publishedAt: { not: null } },
      select: { publishedAt: true, platformData: true },
    }),
    db.externalPost.findMany({
      where: { orgId, account: { platform } },
      orderBy: { publishedAt: "desc" },
      take: 500,
    }),
  ]);

  const freshest = external[0]?.publishedAt ?? new Date();

  // Match an authored post to its pulled counterpart by publish day. Exact
  // timestamps never agree — the platform stamps its own — and a day is tight
  // enough to be meaningful without dropping most of the sample.
  const byDay = new Map<string, typeof external>();
  for (const post of external) {
    const key = post.publishedAt.toISOString().slice(0, 10);
    byDay.set(key, [...(byDay.get(key) ?? []), post]);
  }

  const byKind = new Map<string, number[]>();
  for (const post of authored) {
    if (!post.publishedAt) continue;
    const kind = (post.platformData as { kind?: string } | null)?.kind;
    if (!kind) continue;
    const matches = byDay.get(post.publishedAt.toISOString().slice(0, 10)) ?? [];
    for (const match of matches) {
      byKind.set(kind, [...(byKind.get(kind) ?? []), rateOf(match)]);
    }
  }

  const total = [...byKind.values()].flat();
  const average = mean(total);

  const rows = [...byKind.entries()]
    .filter(([, values]) => values.length >= 3)
    .map(([kind, values]) => ({
      kind,
      posts: values.length,
      averageEngagementRate: mean(values),
      liftVsAverage:
        average === 0 ? 0 : ((mean(values) - average) / average) * 100,
    }))
    .sort((a, b) => b.averageEngagementRate - a.averageEngagementRate);

  return {
    platform,
    type: "content-type-ranking",
    payload: {
      rows,
      // No kinds cleared the threshold — which is the normal state until enough
      // posts have been written through the native composers.
      fallback: rows.length === 0 ? benchmarkFor(platform).contentTypes : null,
    },
    confidence: rows.length === 0 ? "low" : confidenceFor(total.length),
    basedOnDataThrough: freshest,
    sampleSize: total.length,
  };
}

/** Persist a recomputation, replacing the previous row of the same type. */
export async function storeRecommendation(orgId: string, result: Recomputed) {
  await db.strategyRecommendation.deleteMany({
    where: { orgId, platform: result.platform, type: result.type },
  });
  return db.strategyRecommendation.create({
    data: {
      orgId,
      platform: result.platform,
      type: result.type,
      payload: result.payload as object,
      confidence: result.confidence,
      basedOnDataThrough: result.basedOnDataThrough,
    },
  });
}

export async function recomputePlatform(orgId: string, platform: Platform) {
  const results = await Promise.all([
    recomputeBestTimes(orgId, platform),
    recomputeContentTypeRanking(orgId, platform),
  ]);
  for (const result of results) await storeRecommendation(orgId, result);
  return results;
}

export async function listRecommendations(
  session: Session,
  platform?: Platform
) {
  return db.strategyRecommendation.findMany({
    where: { orgId: session.orgId, ...(platform ? { platform } : {}) },
    orderBy: { generatedAt: "desc" },
  });
}

export { benchmarkFor, MIN_FOR_OWN_DATA };
