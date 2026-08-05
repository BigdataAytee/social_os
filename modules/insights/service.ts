import { Platform } from "@prisma/client";

import type { Session } from "@/lib/auth/session";
import { db } from "@/lib/db";

/**
 * Turning pulled posts into patterns worth acting on.
 *
 * The unit throughout is **engagement rate**, not raw engagement: an account
 * that tripled its following in the window would otherwise show every recent
 * post beating every older one, and "post more like the recent ones" is not an
 * insight, it's an artefact. Rate divides by the reach that post actually got.
 *
 * Everything here reads ExternalPost — real observations from the platform —
 * and every claim is either derived from at least MIN_SAMPLE posts or omitted.
 * A "best time to post" drawn from two posts is worse than no answer, because
 * it will be believed.
 */

/** Below this, a bucket's average is noise and is not reported. */
const MIN_SAMPLE = 3;

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export type TopPost = {
  externalId: string;
  permalink: string | null;
  text: string;
  mediaType: string;
  publishedAt: Date;
  likes: number;
  comments: number;
  shares: number;
  views: number;
  engagementRate: number;
};

export type FormatPerformance = {
  mediaType: string;
  posts: number;
  averageEngagementRate: number;
  /** Percent better or worse than the account's overall average. */
  liftVsAverage: number;
};

export type TimingSlot = {
  day: number;
  dayName: string;
  hour: number;
  posts: number;
  averageEngagementRate: number;
};

export type LengthBand = {
  label: string;
  posts: number;
  averageEngagementRate: number;
};

export type TopicSignal = {
  term: string;
  posts: number;
  averageEngagementRate: number;
  liftVsAverage: number;
};

export type AccountInsights = {
  platform: Platform;
  handles: string[];
  /** Posts analysed. Zero means nothing has been synced yet. */
  sampleSize: number;
  windowDays: number;
  /** True when there is too little data to say anything honest. */
  thin: boolean;
  averageEngagementRate: number;
  followerGrowth: { start: number; end: number; percent: number } | null;
  topPosts: TopPost[];
  formats: FormatPerformance[];
  timing: TimingSlot[];
  lengths: LengthBand[];
  topics: TopicSignal[];
};

function engagementRate(post: {
  likes: number;
  comments: number;
  shares: number;
  views: number;
}): number {
  const interactions = post.likes + post.comments + post.shares;
  // Views can legitimately be zero (a platform that doesn't report them, or a
  // post too new). Falling back to interactions keeps the post comparable
  // rather than scoring it zero and hiding a genuinely good one.
  if (post.views <= 0) return interactions === 0 ? 0 : interactions;
  return (interactions / post.views) * 100;
}

function mean(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((a, b) => a + b, 0) / values.length;
}

function lift(value: number, baseline: number): number {
  return baseline === 0 ? 0 : ((value - baseline) / baseline) * 100;
}

/**
 * Words worth counting. Stop words plus the vocabulary every social post
 * contains — without this the "topics" are "the", "and" and "you".
 */
const STOP_WORDS = new Set(
  `a about after all also am an and any are as at be because been before being but by can could did do does doing don for from get got had has have having he her here hers him his how i if in into is it its just like me more most my new no not now of off on once only or other our out over own re said same she should so some such than that the their them then there these they this those through to too under until up us very was we were what when where which while who why will with would you your yours
   comment comments dm follow followers following like likes link bio new post share subscribe tag video watch`
    .split(/\s+/)
    .filter(Boolean)
);

function terms(text: string): string[] {
  const found = new Set<string>();

  // Hashtags are the strongest topic signal a post carries — keep them whole.
  for (const tag of text.match(/#[\p{L}\p{N}_]{2,}/gu) ?? []) {
    found.add(tag.toLowerCase());
  }

  for (const word of text.toLowerCase().match(/[\p{L}][\p{L}'-]{3,}/gu) ?? []) {
    if (!STOP_WORDS.has(word)) found.add(word);
  }

  return [...found];
}

export async function getAccountInsights(
  session: Session,
  opts: { platform: Platform; days?: number }
): Promise<AccountInsights> {
  const windowDays = opts.days ?? 90;
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - windowDays);

  const [posts, accounts] = await Promise.all([
    db.externalPost.findMany({
      where: {
        orgId: session.orgId,
        publishedAt: { gte: since },
        account: { platform: opts.platform },
      },
      orderBy: { publishedAt: "desc" },
    }),
    db.connectedAccount.findMany({
      where: { orgId: session.orgId, platform: opts.platform },
      select: { id: true, handle: true },
    }),
  ]);

  const handles = accounts.map((a) => a.handle);
  const rates = posts.map(engagementRate);
  const average = mean(rates);

  const followerGrowth = await growth(
    accounts.map((a) => a.id),
    since
  );

  if (posts.length === 0) {
    return {
      platform: opts.platform,
      handles,
      sampleSize: 0,
      windowDays,
      thin: true,
      averageEngagementRate: 0,
      followerGrowth,
      topPosts: [],
      formats: [],
      timing: [],
      lengths: [],
      topics: [],
    };
  }

  const withRate = posts.map((post) => ({
    ...post,
    engagementRate: engagementRate(post),
  }));

  // ------------------------------------------------------------ top posts
  const topPosts: TopPost[] = [...withRate]
    .sort((a, b) => b.engagementRate - a.engagementRate)
    .slice(0, 5)
    .map((post) => ({
      externalId: post.externalId,
      permalink: post.permalink,
      text: post.text,
      mediaType: post.mediaType,
      publishedAt: post.publishedAt,
      likes: post.likes,
      comments: post.comments,
      shares: post.shares,
      views: post.views,
      engagementRate: post.engagementRate,
    }));

  // -------------------------------------------------------------- formats
  const byFormat = new Map<string, number[]>();
  for (const post of withRate) {
    byFormat.set(post.mediaType, [
      ...(byFormat.get(post.mediaType) ?? []),
      post.engagementRate,
    ]);
  }
  const formats: FormatPerformance[] = [...byFormat.entries()]
    .filter(([, values]) => values.length >= MIN_SAMPLE)
    .map(([mediaType, values]) => ({
      mediaType,
      posts: values.length,
      averageEngagementRate: mean(values),
      liftVsAverage: lift(mean(values), average),
    }))
    .sort((a, b) => b.averageEngagementRate - a.averageEngagementRate);

  // --------------------------------------------------------------- timing
  // Bucketed by weekday and hour together: "Tuesday" and "9am" separately can
  // both look good while Tuesday 9am was never actually tried.
  const bySlot = new Map<string, number[]>();
  for (const post of withRate) {
    const key = `${post.publishedAt.getUTCDay()}:${post.publishedAt.getUTCHours()}`;
    bySlot.set(key, [...(bySlot.get(key) ?? []), post.engagementRate]);
  }
  const timing: TimingSlot[] = [...bySlot.entries()]
    .filter(([, values]) => values.length >= MIN_SAMPLE)
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

  // -------------------------------------------------------------- lengths
  const BANDS: { label: string; max: number }[] = [
    { label: "Under 80 characters", max: 80 },
    { label: "80–200 characters", max: 200 },
    { label: "200–500 characters", max: 500 },
    { label: "Over 500 characters", max: Infinity },
  ];
  const byBand = new Map<string, number[]>();
  for (const post of withRate) {
    const band = BANDS.find((b) => post.text.length <= b.max)!;
    byBand.set(band.label, [
      ...(byBand.get(band.label) ?? []),
      post.engagementRate,
    ]);
  }
  const lengths: LengthBand[] = BANDS.map((band) => ({
    label: band.label,
    posts: byBand.get(band.label)?.length ?? 0,
    averageEngagementRate: mean(byBand.get(band.label) ?? []),
  })).filter((band) => band.posts >= MIN_SAMPLE);

  // --------------------------------------------------------------- topics
  const byTerm = new Map<string, number[]>();
  for (const post of withRate) {
    for (const term of terms(post.text)) {
      byTerm.set(term, [...(byTerm.get(term) ?? []), post.engagementRate]);
    }
  }
  const topics: TopicSignal[] = [...byTerm.entries()]
    .filter(([, values]) => values.length >= MIN_SAMPLE)
    .map(([term, values]) => ({
      term,
      posts: values.length,
      averageEngagementRate: mean(values),
      liftVsAverage: lift(mean(values), average),
    }))
    .sort((a, b) => b.averageEngagementRate - a.averageEngagementRate)
    .slice(0, 8);

  return {
    platform: opts.platform,
    handles,
    sampleSize: posts.length,
    windowDays,
    // Below the minimum sample nothing above could clear its own threshold, so
    // say the data is thin rather than presenting empty sections as findings.
    thin: posts.length < MIN_SAMPLE,
    averageEngagementRate: average,
    followerGrowth,
    topPosts,
    formats,
    timing,
    lengths,
    topics,
  };
}

async function growth(
  accountIds: string[],
  since: Date
): Promise<AccountInsights["followerGrowth"]> {
  if (accountIds.length === 0) return null;

  const snapshots = await db.analyticsSnapshot.findMany({
    where: { accountId: { in: accountIds }, date: { gte: since } },
    orderBy: { date: "asc" },
  });
  if (snapshots.length < 2) return null;

  // Followers is a level per account, so sum the first and last reading of each
  // rather than the first and last row overall.
  const first = new Map<string, number>();
  const last = new Map<string, number>();
  for (const row of snapshots) {
    if (!first.has(row.accountId)) first.set(row.accountId, row.followers);
    last.set(row.accountId, row.followers);
  }

  const start = [...first.values()].reduce((a, b) => a + b, 0);
  const end = [...last.values()].reduce((a, b) => a + b, 0);
  if (start === 0) return null;

  return { start, end, percent: ((end - start) / start) * 100 };
}

/**
 * The insights rendered as text for the model.
 *
 * Kept next to the analysis rather than in prompts.ts because it must change in
 * lockstep with the shape above — a prompt that describes fields that no longer
 * exist is worse than one that describes fewer.
 */
export function describeInsights(insights: AccountInsights): string {
  if (insights.sampleSize === 0) {
    return `No posts have been pulled from ${insights.platform} yet.`;
  }

  const lines: string[] = [
    `Account: ${insights.handles.join(", ") || insights.platform}`,
    `Window: last ${insights.windowDays} days, ${insights.sampleSize} posts`,
    `Average engagement rate: ${insights.averageEngagementRate.toFixed(2)}%`,
  ];

  if (insights.followerGrowth) {
    lines.push(
      `Followers: ${insights.followerGrowth.start.toLocaleString()} → ${insights.followerGrowth.end.toLocaleString()} (${insights.followerGrowth.percent >= 0 ? "+" : ""}${insights.followerGrowth.percent.toFixed(1)}%)`
    );
  }

  if (insights.formats.length > 0) {
    lines.push(
      "",
      "Format performance:",
      ...insights.formats.map(
        (f) =>
          `- ${f.mediaType}: ${f.averageEngagementRate.toFixed(2)}% across ${f.posts} posts (${f.liftVsAverage >= 0 ? "+" : ""}${f.liftVsAverage.toFixed(0)}% vs average)`
      )
    );
  }

  if (insights.timing.length > 0) {
    lines.push(
      "",
      "Best performing slots:",
      ...insights.timing.map(
        (t) =>
          `- ${t.dayName} ${String(t.hour).padStart(2, "0")}:00 UTC: ${t.averageEngagementRate.toFixed(2)}% across ${t.posts} posts`
      )
    );
  }

  if (insights.lengths.length > 0) {
    lines.push(
      "",
      "Length:",
      ...insights.lengths.map(
        (l) => `- ${l.label}: ${l.averageEngagementRate.toFixed(2)}% across ${l.posts} posts`
      )
    );
  }

  if (insights.topics.length > 0) {
    lines.push(
      "",
      "Topics that outperform:",
      ...insights.topics.map(
        (t) =>
          `- "${t.term}": ${t.averageEngagementRate.toFixed(2)}% across ${t.posts} posts (${t.liftVsAverage >= 0 ? "+" : ""}${t.liftVsAverage.toFixed(0)}%)`
      )
    );
  }

  if (insights.topPosts.length > 0) {
    lines.push(
      "",
      "Top posts:",
      ...insights.topPosts.map(
        (p, i) =>
          `${i + 1}. [${p.mediaType}, ${p.engagementRate.toFixed(2)}%] ${p.text.replace(/\s+/g, " ").slice(0, 180)}`
      )
    );
  }

  return lines.join("\n");
}
