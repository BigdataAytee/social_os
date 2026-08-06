import { Platform } from "@prisma/client";

import type { Session } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  benchmarkFor,
  confidenceFor,
  recomputeBestTimes,
  recomputeContentTypeRanking,
  type BestTimePayload,
  type Confidence,
  type ContentTypePayload,
} from "./engine";

/**
 * Engagement prediction for a specific draft (Growth-Strategist-Engine.md §3).
 *
 * **A band and reasoning, never a fabricated precise percentage.** The account's
 * own history is a distribution of maybe forty posts; scoring a draft against it
 * supports "this looks above average, and here's why", and does not support
 * "7.4%". Quoting a number we can't stand behind would be the single easiest way
 * to make this feature untrustworthy.
 *
 * Computed on demand rather than stored: it's cheap, and a draft changes between
 * predictions so a persisted copy would just go stale (§4).
 */

export type PredictionBand =
  | "above-average"
  | "typical"
  | "below-average"
  | "not-enough-data";

export type Prediction = {
  band: PredictionBand;
  confidence: Confidence;
  reasoning: string[];
  suggestions: string[];
};

export type DraftForPrediction = {
  platform: Platform;
  body: string;
  platformData: Record<string, unknown>;
  /** ISO timestamp, when one has been chosen in the schedule control. */
  scheduledAt: string | null;
};

/** Below this, the account can't say anything about itself yet. */
const MIN_SAMPLE = 8;

export async function predictEngagement(
  session: Session,
  draft: DraftForPrediction
): Promise<Prediction> {
  const posts = await db.externalPost.findMany({
    where: { orgId: session.orgId, account: { platform: draft.platform } },
    orderBy: { publishedAt: "desc" },
    take: 300,
  });

  const benchmark = benchmarkFor(draft.platform);

  if (posts.length < MIN_SAMPLE) {
    return {
      band: "not-enough-data",
      confidence: "low",
      reasoning: [
        posts.length === 0
          ? `Nothing has been pulled from ${draft.platform} yet, so there's no history to score against.`
          : `Only ${posts.length} posts pulled — too few to say how this one compares.`,
        "Based on general best practices until then.",
      ],
      suggestions: benchmark.practices.slice(0, 2),
    };
  }

  const rates = posts
    .map((post) => {
      const interactions = post.likes + post.comments + post.shares;
      return post.views > 0 ? (interactions / post.views) * 100 : interactions;
    })
    .sort((a, b) => a - b);

  const median = rates[Math.floor(rates.length / 2)] ?? 0;
  const upperQuartile = rates[Math.floor(rates.length * 0.75)] ?? median;

  const reasoning: string[] = [];
  const suggestions: string[] = [];

  // Score is a count of signals that point up or down, not a synthetic number
  // pretending to be a rate. Each one carries its own sentence, so the person
  // can disagree with a specific claim rather than a total.
  let score = 0;

  // --- format -------------------------------------------------------------
  const kind = (draft.platformData.kind as string | undefined) ?? null;
  if (kind) {
    const ranking = (await recomputeContentTypeRanking(
      session.orgId,
      draft.platform
    )).payload as ContentTypePayload;
    const row = ranking.rows.find((entry) => entry.kind === kind);
    if (row) {
      const better = row.liftVsAverage > 10;
      const worse = row.liftVsAverage < -10;
      if (better) score += 1;
      if (worse) score -= 1;
      reasoning.push(
        `${kind} posts run ${row.liftVsAverage >= 0 ? "+" : ""}${row.liftVsAverage.toFixed(0)}% against this account's average, across ${row.posts} of them.`
      );
      if (worse && ranking.rows[0] && ranking.rows[0].kind !== kind) {
        suggestions.push(
          `${ranking.rows[0].kind} is this account's strongest format — worth considering for this idea.`
        );
      }
    }
  }

  // --- timing -------------------------------------------------------------
  if (draft.scheduledAt) {
    const when = new Date(draft.scheduledAt);
    const times = (await recomputeBestTimes(session.orgId, draft.platform))
      .payload as BestTimePayload;
    const slot = times.slots.find(
      (entry) =>
        entry.day === when.getUTCDay() && entry.hour === when.getUTCHours()
    );
    if (slot) {
      score += 1;
      reasoning.push(
        `${slot.dayName} ${String(slot.hour).padStart(2, "0")}:00 UTC is one of this account's strongest slots (${slot.averageEngagementRate.toFixed(2)}% across ${slot.posts} posts).`
      );
    } else if (times.slots.length > 0) {
      const best = times.slots[0]!;
      suggestions.push(
        `${best.dayName} ${String(best.hour).padStart(2, "0")}:00 UTC has been this account's best slot — ${best.averageEngagementRate.toFixed(2)}% across ${best.posts} posts.`
      );
    }
  } else {
    suggestions.push("Pick a time and this will factor the slot in too.");
  }

  // --- length -------------------------------------------------------------
  const lengths = posts.map((post) => post.text.length);
  const medianLength = [...lengths].sort((a, b) => a - b)[
    Math.floor(lengths.length / 2)
  ]!;
  const ratio = medianLength === 0 ? 1 : draft.body.length / medianLength;
  if (ratio > 2.5) {
    score -= 1;
    reasoning.push(
      `This is about ${ratio.toFixed(1)}× the length of a typical post on this account.`
    );
  } else if (ratio < 0.4 && draft.body.length > 0) {
    reasoning.push(
      `Shorter than most of what this account publishes — fine if it's deliberate.`
    );
  }

  // --- topic overlap with the account's own best posts ---------------------
  const top = [...posts]
    .sort((a, b) => {
      const rate = (p: typeof a) =>
        p.views > 0 ? (p.likes + p.comments + p.shares) / p.views : 0;
      return rate(b) - rate(a);
    })
    .slice(0, 5);
  const topTerms = new Set(
    top.flatMap((post) =>
      (post.text.toLowerCase().match(/[\p{L}][\p{L}'-]{4,}/gu) ?? []).slice(0, 40)
    )
  );
  const draftTerms = new Set(
    draft.body.toLowerCase().match(/[\p{L}][\p{L}'-]{4,}/gu) ?? []
  );
  const shared = [...draftTerms].filter((term) => topTerms.has(term));
  if (shared.length >= 3) {
    score += 1;
    reasoning.push(
      `Shares vocabulary with this account's top posts (${shared.slice(0, 3).join(", ")}).`
    );
  }

  if (reasoning.length === 0) {
    reasoning.push(
      `Nothing about this draft stands out against the last ${posts.length} posts either way.`
    );
  }
  if (suggestions.length === 0) {
    suggestions.push(benchmark.practices[0]!);
  }

  return {
    band:
      score >= 2 ? "above-average" : score <= -1 ? "below-average" : "typical",
    confidence: confidenceFor(posts.length),
    reasoning,
    suggestions,
  };
}

/** Where the median sits, for the badge's plain-language framing. */
export function bandLabel(band: PredictionBand): string {
  switch (band) {
    case "above-average":
      return "Likely above average";
    case "below-average":
      return "Likely below average";
    case "typical":
      return "Typical for this account";
    case "not-enough-data":
      return "Not enough data yet";
  }
}
