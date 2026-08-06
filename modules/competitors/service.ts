import { Platform } from "@prisma/client";

import { assertCan } from "@/lib/auth/permissions";
import type { Session } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { logActivity } from "@/modules/activity/service";
import { getAdapter } from "@/modules/integrations/registry";
import { CompetitorUnsupportedError } from "@/modules/integrations/types";

/**
 * Competitor intelligence (OS-ARCHITECTURE.md §11 stage 6).
 *
 * The `Competitor` table already existed and was a list of handles nobody did
 * anything with. This module gives it content and comparison: what a rival
 * posts, how often, in what formats, how it performs against our own, and which
 * subjects they cover that we don't.
 *
 * **Every comparison is against the org's own numbers, never a global
 * benchmark.** "Their carousels get 40% more engagement than your average" is a
 * decision someone can act on; "carousels perform well" is a magazine headline.
 */

export type CompetitorSummary = {
  id: string;
  platform: Platform;
  handle: string;
  displayName: string | null;
  notes: string | null;
  posts: number;
  /** Posts per week over the window. */
  cadence: number;
  /** Mean engagement rate, on the same scale as our own insights. */
  engagementRate: number;
  lastSyncAt: Date | null;
  lastSyncError: string | null;
};

const WINDOW_DAYS = 90;

function windowStart(days = WINDOW_DAYS): Date {
  return new Date(Date.now() - days * 86_400_000);
}

/** Engagement rate on the same scale insights uses, so the two are comparable. */
function rateOf(post: {
  likes: number;
  comments: number;
  shares: number;
  views: number;
}): number {
  const interactions = post.likes + post.comments + post.shares;
  return post.views > 0 ? (interactions / post.views) * 100 : interactions;
}

export async function addCompetitor(
  session: Session,
  input: { platform: Platform; handle: string; notes?: string }
) {
  assertCan(session.role, "campaign.manage");

  const handle = input.handle.trim().replace(/^@+/, "");
  if (!handle) throw new Error("A competitor needs a handle");

  const competitor = await db.competitor.upsert({
    where: {
      orgId_platform_handle: {
        orgId: session.orgId,
        platform: input.platform,
        handle,
      },
    },
    update: { notes: input.notes ?? null },
    create: {
      orgId: session.orgId,
      platform: input.platform,
      handle,
      notes: input.notes ?? null,
    },
  });

  await logActivity(session, "competitor.added", "competitor", competitor.id, {
    platform: input.platform,
    handle,
  });

  return competitor;
}

export async function removeCompetitor(session: Session, id: string) {
  assertCan(session.role, "campaign.manage");
  const existing = await db.competitor.findFirst({
    where: { id, orgId: session.orgId },
  });
  if (!existing) throw new Error("Competitor not found");
  await db.competitor.delete({ where: { id: existing.id } });
  await logActivity(session, "competitor.removed", "competitor", id, {});
}

export async function listCompetitorSummaries(
  session: Session,
  platform?: Platform
): Promise<CompetitorSummary[]> {
  const since = windowStart();
  const competitors = await db.competitor.findMany({
    where: { orgId: session.orgId, ...(platform ? { platform } : {}) },
    include: { posts: { where: { publishedAt: { gte: since } } } },
    orderBy: { handle: "asc" },
  });

  return competitors.map((competitor) => {
    const posts = competitor.posts;
    const rates = posts.map(rateOf);
    return {
      id: competitor.id,
      platform: competitor.platform,
      handle: competitor.handle,
      displayName: competitor.displayName,
      notes: competitor.notes,
      posts: posts.length,
      cadence: posts.length / (WINDOW_DAYS / 7),
      engagementRate:
        rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : 0,
      lastSyncAt: competitor.lastSyncAt,
      lastSyncError: competitor.lastSyncError,
    };
  });
}

/**
 * Pull one competitor's recent posts.
 *
 * Which account's token is used matters: a competitor on X is read through *our*
 * X connection, because that is the credential that can see X. Resolved from the
 * org rather than passed in, so a caller can't point a Meta token at a YouTube
 * lookup.
 */
export async function syncCompetitor(
  session: Session,
  competitorId: string
): Promise<{ posts: number; unsupported?: string }> {
  assertCan(session.role, "campaign.manage");

  const competitor = await db.competitor.findFirst({
    where: { id: competitorId, orgId: session.orgId },
  });
  if (!competitor) throw new Error("Competitor not found");

  const account = await db.connectedAccount.findFirst({
    where: { orgId: session.orgId, platform: competitor.platform },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
  if (!account) {
    // Not an error worth throwing: the fix is "connect the account", and a
    // recorded reason is how the person finds that out.
    const reason = `Connect a ${competitor.platform} account first — competitor content is read through your own connection.`;
    await db.competitor.update({
      where: { id: competitor.id },
      data: { lastSyncError: reason },
    });
    return { posts: 0, unsupported: reason };
  }

  const adapter = getAdapter(competitor.platform, account.integrationMode);
  const since = windowStart();

  let posts;
  try {
    posts = await adapter.fetchCompetitorPosts(
      account.id,
      competitor.handle,
      since
    );
  } catch (error) {
    if (error instanceof CompetitorUnsupportedError) {
      await db.competitor.update({
        where: { id: competitor.id },
        data: { lastSyncError: error.reason },
      });
      return { posts: 0, unsupported: error.reason };
    }
    await db.competitor.update({
      where: { id: competitor.id },
      data: {
        lastSyncError: error instanceof Error ? error.message : "Sync failed",
      },
    });
    throw error;
  }

  for (const post of posts) {
    await db.competitorPost.upsert({
      where: {
        competitorId_externalId: {
          competitorId: competitor.id,
          externalId: post.externalId,
        },
      },
      update: {
        text: post.text,
        likes: post.likes,
        comments: post.comments,
        shares: post.shares,
        views: post.views,
        fetchedAt: new Date(),
      },
      create: {
        orgId: session.orgId,
        competitorId: competitor.id,
        externalId: post.externalId,
        text: post.text,
        mediaType: post.mediaType,
        permalink: post.permalink,
        publishedAt: post.publishedAt,
        likes: post.likes,
        comments: post.comments,
        shares: post.shares,
        views: post.views,
      },
    });
  }

  await db.competitor.update({
    where: { id: competitor.id },
    data: { lastSyncAt: new Date(), lastSyncError: null },
  });

  return { posts: posts.length };
}

export type Benchmark = {
  platform: Platform;
  /** Our own mean engagement rate over the window. */
  ours: number;
  /** Theirs, across every tracked competitor on this platform. */
  theirs: number;
  ourCadence: number;
  theirCadence: number;
  /** Their best-performing format, and how much it beats their own average. */
  theirBestFormat: { kind: string; lift: number } | null;
  ourSample: number;
  theirSample: number;
  /** True when either side is too thin to compare honestly. */
  thin: boolean;
};

/**
 * Us against them, on one platform.
 *
 * `thin` exists because the alternative is a chart that says we are 400% behind
 * on the strength of two posts. Below the threshold the caller shows the sample
 * sizes and no comparison — the same rule the insights module already follows.
 */
export async function benchmark(
  session: Session,
  platform: Platform
): Promise<Benchmark> {
  const since = windowStart();

  const [ours, theirs, competitorCount] = await Promise.all([
    db.externalPost.findMany({
      // Filtered by platform, same as theirs. Without this the comparison is
      // our cross-platform average against their single-platform one, which
      // reads as a like-for-like number and isn't.
      where: {
        orgId: session.orgId,
        publishedAt: { gte: since },
        account: { platform },
      },
      select: { likes: true, comments: true, shares: true, views: true },
    }),
    db.competitorPost.findMany({
      where: {
        orgId: session.orgId,
        publishedAt: { gte: since },
        competitor: { platform },
      },
      select: {
        likes: true,
        comments: true,
        shares: true,
        views: true,
        mediaType: true,
      },
    }),
    db.competitor.count({ where: { orgId: session.orgId, platform } }),
  ]);

  const ourRates = ours.map(rateOf);
  const theirRates = theirs.map(rateOf);
  const mean = (values: number[]) =>
    values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;

  // Their formats, against their own average — the same construction the brand
  // profile uses for ours, so the two numbers mean the same thing.
  const theirAverage = mean(theirRates);
  const byFormat = new Map<string, number[]>();
  for (const post of theirs) {
    byFormat.set(post.mediaType, [
      ...(byFormat.get(post.mediaType) ?? []),
      rateOf(post),
    ]);
  }
  const formats = [...byFormat.entries()]
    .filter(([, rates]) => rates.length >= 3)
    .map(([kind, rates]) => ({
      kind,
      lift: theirAverage > 0 ? (mean(rates) / theirAverage - 1) * 100 : 0,
    }))
    // A format has to actually lead to be called their best. When everything
    // they post is one format, that format *is* the average, and reporting
    // "their best format: image, +0%" states a finding where there is none —
    // the e2e caught exactly that. Ten points is the same floor the brand
    // profile uses for our own formats, so the two read the same way.
    .filter((format) => format.lift > 10)
    .sort((a, b) => b.lift - a.lift);

  return {
    platform,
    ours: mean(ourRates),
    theirs: theirAverage,
    ourCadence: ours.length / (WINDOW_DAYS / 7),
    theirCadence:
      competitorCount > 0
        ? theirs.length / competitorCount / (WINDOW_DAYS / 7)
        : 0,
    theirBestFormat: formats[0] ?? null,
    ourSample: ours.length,
    theirSample: theirs.length,
    thin: ourRates.length < 5 || theirRates.length < 5,
  };
}

export type ContentGap = {
  term: string;
  /** How many of their posts touch it. */
  theirPosts: number;
  /** Mean engagement rate of theirs that do. */
  theirRate: number;
};

/**
 * Subjects they cover and we don't.
 *
 * Deliberately reuses the vocabulary extraction that already exists for the
 * brand profile rather than adding a second, subtly different one — "what is
 * this corpus about" is one question, and answering it two ways would let the
 * gap analysis disagree with the profile on the same page.
 *
 * A gap is only worth reporting if it *worked for them*: a subject they post
 * about constantly to no response is not an opportunity, it is a warning.
 */
export async function contentGaps(
  session: Session,
  platform?: Platform
): Promise<ContentGap[]> {
  const since = windowStart();

  const [theirs, ours] = await Promise.all([
    db.competitorPost.findMany({
      where: {
        orgId: session.orgId,
        publishedAt: { gte: since },
        ...(platform ? { competitor: { platform } } : {}),
      },
      select: {
        text: true,
        likes: true,
        comments: true,
        shares: true,
        views: true,
      },
    }),
    db.externalPost.findMany({
      where: { orgId: session.orgId, publishedAt: { gte: since } },
      select: { text: true },
    }),
  ]);

  if (theirs.length < 5) return [];

  const { extractTerms } = await import("@/modules/brandbrain/terms");
  const theirTerms = extractTerms(theirs.map((post) => post.text));
  const ourTerms = new Set(
    extractTerms(ours.map((post) => post.text)).map((term) => term.term)
  );

  const theirAverage =
    theirs.reduce((sum, post) => sum + rateOf(post), 0) / theirs.length;

  const gaps: ContentGap[] = [];
  for (const term of theirTerms) {
    if (ourTerms.has(term.term)) continue;
    // Posts of theirs containing the term, and how those did.
    const matching = theirs.filter((post) =>
      post.text.toLowerCase().includes(term.term)
    );
    if (matching.length < 2) continue;
    const rate =
      matching.reduce((sum, post) => sum + rateOf(post), 0) / matching.length;
    if (rate < theirAverage) continue;
    gaps.push({ term: term.term, theirPosts: matching.length, theirRate: rate });
  }

  return gaps.sort((a, b) => b.theirRate - a.theirRate).slice(0, 8);
}

/** Their best-performing posts in the window. The "what should we study" list. */
export async function topCompetitorPosts(
  session: Session,
  opts: { platform?: Platform; take?: number } = {}
) {
  const posts = await db.competitorPost.findMany({
    where: {
      orgId: session.orgId,
      publishedAt: { gte: windowStart() },
      ...(opts.platform ? { competitor: { platform: opts.platform } } : {}),
    },
    include: { competitor: { select: { handle: true, platform: true } } },
    take: 200,
  });

  return posts
    .map((post) => ({ ...post, rate: rateOf(post) }))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, opts.take ?? 5);
}
