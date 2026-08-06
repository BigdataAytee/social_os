import {
  ConversationKind,
  MentionSource,
  MonitorKind,
  Platform,
  Sentiment,
} from "@prisma/client";

import { assertCan } from "@/lib/auth/permissions";
import type { Session } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { logActivity } from "@/modules/activity/service";
import { triage } from "@/modules/inbox/triage";

/**
 * Social listening (OS-ARCHITECTURE.md §11 stage 6).
 *
 * **What this watches, stated plainly, because the alternative is a lie.**
 * None of the five platforms exposes open search on the scopes this app holds —
 * X retired free search, TikTok and Meta never had it, YouTube's costs a
 * hundred quota units a query. A monitor that claimed to watch all of X would
 * be watching nothing at all, and would look like it was working.
 *
 * So a monitor watches the three corpora we legitimately have: the engagement
 * inbox (what people say *to* us), our own synced posts (what we said), and
 * tracked competitors' posts (what they said). That is a real and useful
 * surface — "who is asking about pricing", "is anyone complaining", "are our
 * rivals talking about this before we are" — and the UI names the three so
 * nobody mistakes it for the whole internet.
 *
 * Sentiment reuses `inbox/triage` rather than adding a second lexicon: a
 * complaint is a complaint whichever corpus it was found in, and two scorers
 * would eventually disagree about the same sentence on the same screen.
 */

export type MonitorSummary = {
  id: string;
  term: string;
  kind: MonitorKind;
  platform: Platform | null;
  active: boolean;
  mentions: number;
  /** Mentions in the last seven days, so a dead monitor is visibly dead. */
  recent: number;
  negative: number;
};

const WINDOW_DAYS = 90;

export async function listMonitors(
  session: Session
): Promise<MonitorSummary[]> {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);

  const monitors = await db.monitor.findMany({
    where: { orgId: session.orgId },
    include: {
      mentions: {
        select: { publishedAt: true, sentiment: true },
      },
    },
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
  });

  return monitors.map((monitor) => ({
    id: monitor.id,
    term: monitor.term,
    kind: monitor.kind,
    platform: monitor.platform,
    active: monitor.active,
    mentions: monitor.mentions.length,
    recent: monitor.mentions.filter((m) => m.publishedAt >= weekAgo).length,
    negative: monitor.mentions.filter(
      (m) => m.sentiment === Sentiment.NEGATIVE
    ).length,
  }));
}

export async function createMonitor(
  session: Session,
  input: { term: string; kind?: MonitorKind; platform?: Platform | null }
) {
  assertCan(session.role, "campaign.manage");

  const term = input.term.trim().toLowerCase();
  if (term.length < 2) throw new Error("A monitor needs at least two characters");
  // A one-character or all-punctuation term would match every row in the
  // database and produce a mention list nobody can read.
  if (!/[\p{L}\p{N}]/u.test(term)) {
    throw new Error("A monitor needs at least one letter or number");
  }

  const monitor = await db.monitor.upsert({
    where: {
      orgId_term_kind: {
        orgId: session.orgId,
        term,
        kind: input.kind ?? MonitorKind.KEYWORD,
      },
    },
    update: { active: true, platform: input.platform ?? null },
    create: {
      orgId: session.orgId,
      term,
      kind: input.kind ?? MonitorKind.KEYWORD,
      platform: input.platform ?? null,
    },
  });

  await logActivity(session, "monitor.created", "monitor", monitor.id, { term });
  return monitor;
}

export async function setMonitorActive(
  session: Session,
  input: { id: string; active: boolean }
) {
  assertCan(session.role, "campaign.manage");
  const monitor = await db.monitor.findFirst({
    where: { id: input.id, orgId: session.orgId },
    select: { id: true },
  });
  if (!monitor) throw new Error("Monitor not found");
  return db.monitor.update({
    where: { id: monitor.id },
    data: { active: input.active },
  });
}

export async function deleteMonitor(session: Session, id: string) {
  assertCan(session.role, "campaign.manage");
  const monitor = await db.monitor.findFirst({
    where: { id, orgId: session.orgId },
    select: { id: true },
  });
  if (!monitor) throw new Error("Monitor not found");
  await db.monitor.delete({ where: { id: monitor.id } });
}

/**
 * Run every active monitor over everything we can see.
 *
 * Substring matching, lowercased, not full-text. The terms people monitor are
 * brand names, product names and handles — "SocialOS", "@northwind", "acme
 * pro" — and stemming would turn a brand into its root while a tsquery would
 * refuse to match a term inside a hashtag. This is the one place where the
 * naive approach is the correct one.
 *
 * Idempotent: mentions are unique on `(monitor, source, sourceId)`, so a rescan
 * refreshes rather than accumulating. That matters because the scan runs on a
 * schedule over an overlapping window.
 */
export async function scanMonitors(
  orgId: string
): Promise<{ scanned: number; matched: number }> {
  const monitors = await db.monitor.findMany({
    where: { orgId, active: true },
  });
  if (monitors.length === 0) return { scanned: 0, matched: 0 };

  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);

  const [conversations, ownPosts, competitorPosts] = await Promise.all([
    db.conversation.findMany({
      where: { orgId, lastMessageAt: { gte: since } },
      include: { messages: { where: { outbound: false }, orderBy: { sentAt: "asc" } } },
      take: 1000,
    }),
    db.externalPost.findMany({
      where: { orgId, publishedAt: { gte: since } },
      include: { account: { select: { platform: true, handle: true } } },
      take: 1000,
    }),
    db.competitorPost.findMany({
      where: { orgId, publishedAt: { gte: since } },
      include: { competitor: { select: { platform: true, handle: true } } },
      take: 1000,
    }),
  ]);

  let matched = 0;

  for (const monitor of monitors) {
    const term = monitor.term;
    const platformOk = (platform: Platform) =>
      monitor.platform === null || monitor.platform === platform;

    for (const conversation of conversations) {
      if (!platformOk(conversation.platform)) continue;
      const text = conversation.messages.map((m) => m.text).join("\n");
      if (!text.toLowerCase().includes(term)) continue;

      const scored = triage({
        text,
        kind: conversation.kind as ConversationKind,
      });
      await upsertMention({
        orgId,
        monitorId: monitor.id,
        source: MentionSource.INBOX,
        sourceId: conversation.id,
        platform: conversation.platform,
        authorHandle: conversation.authorHandle,
        text: text.slice(0, 2000),
        permalink: conversation.permalink,
        sentiment: scored.sentiment,
        // An inbox item has no reach of its own; unread depth is the closest
        // honest stand-in for "how loud is this".
        reach: conversation.messages.length,
        publishedAt: conversation.lastMessageAt,
      });
      matched += 1;
    }

    for (const post of ownPosts) {
      if (!platformOk(post.account.platform)) continue;
      if (!post.text.toLowerCase().includes(term)) continue;
      await upsertMention({
        orgId,
        monitorId: monitor.id,
        source: MentionSource.OWN_POST,
        sourceId: post.id,
        platform: post.account.platform,
        authorHandle: post.account.handle,
        text: post.text.slice(0, 2000),
        permalink: post.permalink,
        sentiment: triage({
          text: post.text,
          kind: ConversationKind.COMMENT,
        }).sentiment,
        reach: post.likes + post.comments + post.shares,
        publishedAt: post.publishedAt,
      });
      matched += 1;
    }

    for (const post of competitorPosts) {
      if (!platformOk(post.competitor.platform)) continue;
      if (!post.text.toLowerCase().includes(term)) continue;
      await upsertMention({
        orgId,
        monitorId: monitor.id,
        source: MentionSource.COMPETITOR,
        sourceId: post.id,
        platform: post.competitor.platform,
        authorHandle: post.competitor.handle,
        text: post.text.slice(0, 2000),
        permalink: post.permalink,
        sentiment: triage({
          text: post.text,
          kind: ConversationKind.COMMENT,
        }).sentiment,
        reach: post.likes + post.comments + post.shares,
        publishedAt: post.publishedAt,
      });
      matched += 1;
    }
  }

  return { scanned: monitors.length, matched };
}

async function upsertMention(data: {
  orgId: string;
  monitorId: string;
  source: MentionSource;
  sourceId: string;
  platform: Platform;
  authorHandle: string;
  text: string;
  permalink: string | null;
  sentiment: Sentiment;
  reach: number;
  publishedAt: Date;
}) {
  const { monitorId, source, sourceId, ...rest } = data;
  return db.mention.upsert({
    where: { monitorId_source_sourceId: { monitorId, source, sourceId } },
    update: {
      text: rest.text,
      sentiment: rest.sentiment,
      reach: rest.reach,
    },
    create: { monitorId, source, sourceId, ...rest },
  });
}

export type MentionRow = {
  id: string;
  monitorTerm: string;
  source: MentionSource;
  platform: Platform;
  authorHandle: string;
  text: string;
  permalink: string | null;
  sentiment: Sentiment;
  reach: number;
  publishedAt: Date;
};

export async function listMentions(
  session: Session,
  filters: {
    monitorId?: string;
    source?: MentionSource;
    sentiment?: Sentiment;
    take?: number;
  } = {}
): Promise<MentionRow[]> {
  const rows = await db.mention.findMany({
    where: {
      orgId: session.orgId,
      ...(filters.monitorId ? { monitorId: filters.monitorId } : {}),
      ...(filters.source ? { source: filters.source } : {}),
      ...(filters.sentiment ? { sentiment: filters.sentiment } : {}),
    },
    include: { monitor: { select: { term: true } } },
    // Reach first: a mention seen by ten thousand people matters more than one
    // posted a minute ago, and this is a review surface rather than a feed.
    orderBy: [{ reach: "desc" }, { publishedAt: "desc" }],
    take: Math.min(filters.take ?? 50, 200),
  });

  return rows.map((row) => ({
    id: row.id,
    monitorTerm: row.monitor.term,
    source: row.source,
    platform: row.platform,
    authorHandle: row.authorHandle,
    text: row.text,
    permalink: row.permalink,
    sentiment: row.sentiment,
    reach: row.reach,
    publishedAt: row.publishedAt,
  }));
}

export type SentimentBreakdown = {
  positive: number;
  neutral: number;
  negative: number;
  total: number;
  /** Positive minus negative, over total. -1 to 1. Null when there's nothing. */
  net: number | null;
};

/**
 * Sentiment across a monitor, or across everything.
 *
 * `net` rather than "83% positive": a score that moves in both directions is
 * harder to misread as a grade, and neutral mentions — the majority in any real
 * corpus — shouldn't count against you.
 */
export async function sentimentBreakdown(
  session: Session,
  monitorId?: string
): Promise<SentimentBreakdown> {
  const rows = await db.mention.groupBy({
    by: ["sentiment"],
    where: {
      orgId: session.orgId,
      ...(monitorId ? { monitorId } : {}),
    },
    _count: { _all: true },
  });

  const byType = Object.fromEntries(
    rows.map((row) => [row.sentiment, row._count._all])
  ) as Partial<Record<Sentiment, number>>;

  const positive = byType.POSITIVE ?? 0;
  const neutral = byType.NEUTRAL ?? 0;
  const negative = byType.NEGATIVE ?? 0;
  const total = positive + neutral + negative;

  return {
    positive,
    neutral,
    negative,
    total,
    net: total > 0 ? (positive - negative) / total : null,
  };
}

export type ShareOfVoice = {
  handle: string;
  /** Ours or theirs. */
  own: boolean;
  posts: number;
  reach: number;
  share: number;
};

/**
 * Who is doing the talking about a term — us or them.
 *
 * Share of *reach*, not share of posts: posting twice as often as a rival while
 * reaching a tenth as many people is not winning, and a post-count share would
 * report it as a lead.
 */
export async function shareOfVoice(
  session: Session,
  monitorId: string
): Promise<ShareOfVoice[]> {
  const mentions = await db.mention.findMany({
    where: { orgId: session.orgId, monitorId },
    select: { authorHandle: true, source: true, reach: true },
    take: 1000,
  });
  if (mentions.length === 0) return [];

  const byHandle = new Map<string, { own: boolean; posts: number; reach: number }>();
  for (const mention of mentions) {
    const key = mention.authorHandle;
    const existing = byHandle.get(key) ?? {
      own: mention.source !== MentionSource.COMPETITOR,
      posts: 0,
      reach: 0,
    };
    existing.posts += 1;
    existing.reach += mention.reach;
    byHandle.set(key, existing);
  }

  const totalReach = [...byHandle.values()].reduce((sum, v) => sum + v.reach, 0);

  return [...byHandle.entries()]
    .map(([handle, value]) => ({
      handle,
      own: value.own,
      posts: value.posts,
      reach: value.reach,
      // Falls back to post share when nothing has reach data, rather than
      // dividing by zero and reporting NaN% for every row.
      share:
        totalReach > 0
          ? value.reach / totalReach
          : value.posts / mentions.length,
    }))
    .sort((a, b) => b.share - a.share)
    .slice(0, 10);
}
