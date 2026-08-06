import { Platform } from "@prisma/client";

import type { Session } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getBrandVoice } from "@/modules/brandvoice/service";
import { complete } from "@/modules/ai/provider";
import { systemPrompt } from "@/modules/ai/prompts";
import {
  benchmarkFor,
  recomputeBestTimes,
  recomputeContentTypeRanking,
  storeRecommendation,
  type BestTimePayload,
  type ContentTypePayload,
} from "./engine";

/**
 * The weekly strategy briefing — the one LLM step in this system
 * (Growth-Strategist-Engine.md §1.3, §2).
 *
 * Everything else here is aggregation. This takes the finished aggregations,
 * current trends and the brand voice, and writes the plain-language plan. It
 * runs once per org/platform per recompute, never per page view: the output is
 * stored as a `StrategyRecommendation` and read from there.
 *
 * The model is handed a finished report rather than raw rows, for the same
 * reason `generateIdeasFromAccount` is — asking it to do arithmetic over a
 * hundred posts invites confident wrong numbers.
 */

export type BriefingPayload = {
  narrative: string;
  /** Whether the model or the offline writer produced it. */
  source: "anthropic" | "local";
  /** True when this leans on benchmarks rather than the org's own history. */
  coldStart: boolean;
};

export async function generateWeeklyBriefing(
  session: Session,
  platform: Platform
): Promise<BriefingPayload> {
  const [times, ranking, voice, trends] = await Promise.all([
    recomputeBestTimes(session.orgId, platform),
    recomputeContentTypeRanking(session.orgId, platform),
    getBrandVoice(session),
    db.trendEvent.findMany({
      where: { orgId: session.orgId },
      orderBy: { detectedAt: "desc" },
      take: 5,
    }),
  ]);

  const timing = times.payload as BestTimePayload;
  const formats = ranking.payload as ContentTypePayload;
  const coldStart = Boolean(timing.fallback && formats.fallback);

  const report = [
    `Platform: ${platform}`,
    `Posts analysed: ${times.sampleSize}`,
    "",
    "Best slots:",
    timing.slots.length > 0
      ? timing.slots
          .map(
            (slot) =>
              `- ${slot.dayName} ${String(slot.hour).padStart(2, "0")}:00 UTC — ${slot.averageEngagementRate.toFixed(2)}% across ${slot.posts} posts`
          )
          .join("\n")
      : `- Not enough history. General guidance: ${timing.fallback}`,
    "",
    "Content types:",
    formats.rows.length > 0
      ? formats.rows
          .map(
            (row) =>
              `- ${row.kind}: ${row.averageEngagementRate.toFixed(2)}% (${row.liftVsAverage >= 0 ? "+" : ""}${row.liftVsAverage.toFixed(0)}% vs average) across ${row.posts} posts`
          )
          .join("\n")
      : `- Not enough history. General guidance: ${formats.fallback}`,
    trends.length > 0
      ? `\nTrending now:\n${trends.map((trend) => `- ${trend.topic} (${trend.velocity}, ${trend.depth}): ${trend.summary}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const result = await complete({
    system: systemPrompt({ voice, platform, orgName: session.orgName }),
    messages: [
      {
        role: "user",
        content: [
          "Write this week's plan for this account from the report below.",
          "",
          "Three or four short paragraphs, no headings, no bullet list. Say what to post, roughly when, and why — citing the report's own numbers. Do not invent numbers that aren't in it.",
          coldStart
            ? "This account has too little history to draw its own patterns from, so say plainly that this is general best practice and will get specific after its first posts."
            : "",
          "",
          "---",
          report,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  });

  const payload: BriefingPayload = {
    narrative: result.text.trim(),
    source: result.source,
    coldStart,
  };

  await storeRecommendation(session.orgId, {
    platform,
    type: "weekly-briefing",
    payload: payload as unknown as Record<string, unknown>,
    confidence: times.confidence,
    basedOnDataThrough: times.basedOnDataThrough,
    sampleSize: times.sampleSize,
  });

  return payload;
}

/**
 * The Dashboard's "This Week's Strategy" card (§6): the strongest few
 * recommendations across every platform, not one platform's full briefing.
 */
export type StrategyHighlight = {
  platform: Platform;
  headline: string;
  detail: string;
  confidence: string;
  basedOnDataThrough: Date;
};

export async function topRecommendations(
  session: Session,
  limit = 5
): Promise<StrategyHighlight[]> {
  const rows = await db.strategyRecommendation.findMany({
    where: { orgId: session.orgId },
    orderBy: { generatedAt: "desc" },
  });

  const highlights: StrategyHighlight[] = [];

  for (const row of rows) {
    if (row.type === "best-time") {
      const payload = row.payload as unknown as BestTimePayload;
      const slot = payload.slots[0];
      highlights.push({
        platform: row.platform,
        headline: slot
          ? `Post on ${slot.dayName} around ${String(slot.hour).padStart(2, "0")}:00 UTC`
          : "Not enough history to pick a slot yet",
        detail: slot
          ? `${slot.averageEngagementRate.toFixed(2)}% engagement across ${slot.posts} posts in that slot.`
          : (payload.fallback ?? benchmarkFor(row.platform).bestTimes),
        confidence: row.confidence,
        basedOnDataThrough: row.basedOnDataThrough,
      });
    }
    if (row.type === "content-type-ranking") {
      const payload = row.payload as unknown as ContentTypePayload;
      const best = payload.rows[0];
      highlights.push({
        platform: row.platform,
        headline: best
          ? `Lean on ${best.kind} — ${best.liftVsAverage >= 0 ? "+" : ""}${best.liftVsAverage.toFixed(0)}% vs average`
          : "Not enough history to rank formats yet",
        detail: best
          ? `${best.averageEngagementRate.toFixed(2)}% across ${best.posts} posts.`
          : (payload.fallback ?? benchmarkFor(row.platform).contentTypes),
        confidence: row.confidence,
        basedOnDataThrough: row.basedOnDataThrough,
      });
    }
  }

  // Real findings first: a recommendation the org's own data supports beats a
  // benchmark, and a card that led with cold-start advice would bury them.
  const rank = { high: 0, medium: 1, low: 2 } as const;
  return highlights
    .sort(
      (a, b) =>
        (rank[a.confidence as keyof typeof rank] ?? 3) -
        (rank[b.confidence as keyof typeof rank] ?? 3)
    )
    .slice(0, limit);
}
