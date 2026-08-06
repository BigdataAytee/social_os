import { Platform, PostStatus } from "@prisma/client";

import { assertCan } from "@/lib/auth/permissions";
import type { Session } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { complete } from "@/modules/ai/provider";
import { systemPrompt } from "@/modules/ai/prompts";
import { getBrandVoice } from "@/modules/brandvoice/service";
import { createPost } from "@/modules/posts/service";
import { getPlatformAdapter } from "@/modules/integrations/registry";

/**
 * Trend → platform-native format pipeline (Platform-Native-Studios.md §2).
 *
 * One detected trend, fanned out through five prompt scaffolds that each know
 * their platform's native shape from §1. Same orchestrator as §9 — the only
 * difference is what triggers it.
 *
 * **It auto-drafts, never auto-publishes.** Every draft lands in a review screen
 * and only becomes a `Post` when someone accepts it. That is why
 * `TrendResponse.draftPostId` is nullable: a generated-but-rejected response is
 * a real, recorded outcome, not an absence.
 */

export type TrendDraft = {
  platform: Platform;
  /** Plain-text rendering, for the review screen and the eventual Post.body. */
  body: string;
  /** The native shape from §1 — what makes this a fan-out and not five copies. */
  platformData: Record<string, unknown>;
  responseId: string;
  source: "anthropic" | "local";
};

/**
 * What each Studio is asked for, keyed to its native shape.
 *
 * Depth decides the YouTube branch specifically: a quick-hit becomes a Short,
 * an explainer-worthy trend becomes long-form. Everywhere else depth shifts the
 * length rather than the format.
 */
function scaffoldFor(platform: Platform, depth: string): string {
  switch (platform) {
    case Platform.X:
      return "Write a thread: a hook tweet that stops the scroll, one idea per tweet after it, and an explicit close. Return one tweet per line, no numbering.";
    case Platform.TIKTOK:
      return "Write a reaction script. First line is the 0–3 second hook. Each line after is one beat: what happens on camera. Keep it under 30 seconds of speech.";
    case Platform.INSTAGRAM:
      return "Write a carousel. First line is the cover hook that earns a swipe. Each line after is one slide, one point each. Close on something worth saving.";
    case Platform.FACEBOOK:
      return "Write a conversational post with context and explanation, then end on an explicit question — the algorithm rewards comments specifically. Put the question on its own final line.";
    case Platform.YOUTUBE:
      return depth === "quick-hit"
        ? "Write a Short. First line is the hook, each line after is one beat."
        : "Write a long-form video plan. First line is a title. Second line is a thumbnail concept. Each line after is a chapter: 'time — label'.";
  }
}

/** Turn a model's line-per-unit output into that platform's native shape. */
function toNativeShape(
  platform: Platform,
  lines: string[],
  depth: string
): { body: string; platformData: Record<string, unknown> } {
  const clean = lines
    .map((line) => line.replace(/^\s*(?:\d+[.)/]|[-*•])\s*/, "").trim())
    .filter(Boolean);

  switch (platform) {
    case Platform.X:
      return {
        body: clean.map((line, i) => `${i + 1}/ ${line}`).join("\n\n"),
        platformData: {
          kind: clean.length > 1 ? "thread" : "tweet",
          tweets: clean,
          quoteOf: null,
          mediaCard: { type: "stat-card", assetId: null },
        },
      };

    case Platform.TIKTOK:
    case Platform.INSTAGRAM: {
      const [first, ...rest] = clean;
      if (platform === Platform.TIKTOK) {
        return {
          body: [`HOOK: ${first ?? ""}`, ...rest].join("\n"),
          platformData: {
            kind: "script",
            hookLine: first ?? "",
            beats: rest.map((action, index) => ({
              t: index === 0 ? "0-3s" : `${index * 8}s+`,
              action,
              onScreenText: "",
            })),
            soundId: null,
            durationTargetSec: 30,
            hashtags: [],
          },
        };
      }
      return {
        body: clean.join("\n"),
        platformData: {
          kind: "carousel",
          coverHook: first ?? "",
          slides: rest.map((line, index) => ({
            headline: line.slice(0, 60),
            body: line.length > 60 ? line : "",
            template: index === rest.length - 1 ? "close" : "list-item",
          })),
          hashtags: [],
        },
      };
    }

    case Platform.FACEBOOK: {
      const last = clean[clean.length - 1] ?? "";
      const isQuestion = last.endsWith("?");
      const body = (isQuestion ? clean.slice(0, -1) : clean).join("\n\n");
      return {
        body: clean.join("\n\n"),
        platformData: {
          kind: "post",
          body,
          linkCard: { url: null, title: null },
          discussionPrompt: isQuestion ? last : "",
          audience: "public",
        },
      };
    }

    case Platform.YOUTUBE: {
      if (depth === "quick-hit") {
        const [hook, ...beats] = clean;
        return {
          body: [`HOOK: ${hook ?? ""}`, ...beats].join("\n"),
          platformData: {
            kind: "short",
            hookLine: hook ?? "",
            beats: beats.map((action, index) => ({
              t: index === 0 ? "0-3s" : `${index * 8}s+`,
              action,
              onScreenText: "",
            })),
            keywords: [],
          },
        };
      }
      const [title, thumbnail, ...chapters] = clean;
      return {
        body: clean.join("\n"),
        platformData: {
          kind: "long-form",
          titleOptions: title ? [title] : [],
          thumbnailConcepts: thumbnail ? [thumbnail] : [],
          chapters: chapters.map((line) => {
            const [time, ...label] = line.split(/\s*[—-]\s*/);
            return { time: time?.trim() ?? "0:00", label: label.join(" ").trim() };
          }),
          keywords: [],
        },
      };
    }
  }
}

/** Fan one trend out to all five Studios. Nothing is saved as a Post here. */
export async function respondToTrend(
  session: Session,
  trendEventId: string
): Promise<{ trend: { topic: string; summary: string }; drafts: TrendDraft[] }> {
  assertCan(session.role, "ai.generate");

  const trend = await db.trendEvent.findFirst({
    where: { id: trendEventId, orgId: session.orgId },
  });
  if (!trend) throw new Error("Trend not found");

  const voice = await getBrandVoice(session);
  const drafts: TrendDraft[] = [];

  for (const platform of Object.values(Platform)) {
    const result = await complete({
      system: systemPrompt({ voice, platform, orgName: session.orgName }),
      messages: [
        {
          role: "user",
          content: [
            scaffoldFor(platform, trend.depth),
            "",
            `Trend: ${trend.topic}`,
            `What's happening: ${trend.summary}`,
            `Velocity: ${trend.velocity}. Depth: ${trend.depth}.`,
            trend.sourceUrl ? `Source: ${trend.sourceUrl}` : "",
            "",
            "Respond with a take worth reading, not a summary of the news.",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    });

    const shaped = toNativeShape(
      platform,
      result.text.split("\n"),
      trend.depth
    );

    // Recorded before review, so a trend that produced five drafts and had all
    // five rejected is distinguishable from one that was never run.
    const response = await db.trendResponse.create({
      data: { trendEventId: trend.id, platform },
    });

    drafts.push({
      platform,
      body: shaped.body,
      platformData: shaped.platformData,
      responseId: response.id,
      source: result.source,
    });
  }

  return { trend: { topic: trend.topic, summary: trend.summary }, drafts };
}

/** Accept one reviewed draft — this is the only place a Post is created. */
export async function acceptTrendDraft(
  session: Session,
  input: {
    responseId: string;
    platform: Platform;
    body: string;
    platformData: Record<string, unknown>;
  }
) {
  const response = await db.trendResponse.findFirst({
    where: {
      id: input.responseId,
      trendEvent: { orgId: session.orgId },
    },
  });
  if (!response) throw new Error("Trend response not found");

  const post = await createPost(session, {
    platform: input.platform,
    body: input.body,
    status: PostStatus.DRAFT,
    platformData: input.platformData,
  });

  await db.trendResponse.update({
    where: { id: response.id },
    data: { draftPostId: post.id },
  });

  return post;
}

/**
 * Detected trends, materialised as `TrendEvent` rows.
 *
 * Sourced from the trend adapter for now (ARCHITECTURE.md §10) — real trend
 * sources later. Velocity and depth are classified here rather than by the
 * adapter, because they're judgements about what a *response* should look like,
 * not facts the platform reports.
 */
export async function detectTrends(session: Session, platform: Platform) {
  assertCan(session.role, "ai.generate");

  // Scoped to the account's region where one is set. What is trending in Lagos
  // is not what is trending in Los Angeles, and a worldwide list handed to a
  // local brand is a list of things their audience isn't talking about.
  const account = await db.connectedAccount.findFirst({
    where: { orgId: session.orgId, platform },
    select: { region: true },
    orderBy: { createdAt: "asc" },
  });
  const trends = await getPlatformAdapter(platform).fetchTrends(account?.region);

  const created = [];
  for (const trend of trends.slice(0, 5)) {
    const existing = await db.trendEvent.findFirst({
      where: { orgId: session.orgId, topic: trend.topic },
    });
    if (existing) {
      created.push(existing);
      continue;
    }
    created.push(
      await db.trendEvent.create({
        data: {
          orgId: session.orgId,
          topic: trend.topic,
          summary: `${trend.category} · ${trend.volume.toLocaleString()} mentions in 24h, ${trend.change >= 0 ? "+" : ""}${trend.change}% on yesterday.`,
          velocity:
            trend.change > 60 ? "breaking" : trend.change > 10 ? "rising" : "steady",
          // A spike wants a fast reaction; a steady climb is worth explaining.
          depth: trend.change > 60 ? "quick-hit" : "explainer-worthy",
        },
      })
    );
  }
  return created;
}

export async function listTrendEvents(session: Session, take = 10) {
  return db.trendEvent.findMany({
    where: { orgId: session.orgId },
    orderBy: { detectedAt: "desc" },
    include: { responses: true },
    take,
  });
}
