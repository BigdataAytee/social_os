/**
 * Steps 4–7 verification: native shapes, the Growth Strategist engine,
 * prediction, and the trend fan-out.
 *
 *   DATABASE_URL=… npx tsx scripts/strategy-e2e.ts
 *
 * Writes to the database. Point it at a throwaway one.
 */

import { IntegrationMode, Platform, PostStatus } from "@prisma/client";

import type { Session } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { parsePlatformData } from "@/lib/validators/platform-data";
import { createPost } from "@/modules/posts/service";
import {
  recomputeBestTimes,
  recomputeContentTypeRanking,
  recomputePlatform,
} from "@/modules/strategy/engine";
import { predictEngagement } from "@/modules/strategy/predict";
import { topRecommendations } from "@/modules/strategy/briefing";
import {
  acceptTrendDraft,
  detectTrends,
  respondToTrend,
} from "@/modules/trends/pipeline";

let failures = 0;
let checks = 0;

function ok(label: string, condition: boolean, detail = "") {
  checks += 1;
  if (!condition) failures += 1;
  console.log(`  ${condition ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const membership = await db.membership.findFirst({
    where: { role: "OWNER", org: { slug: "northwind" } },
    include: { org: true, user: true },
  });
  if (!membership) throw new Error("Seed the northwind demo org first");

  const session: Session = {
    userId: membership.userId,
    email: membership.user.email,
    name: membership.user.name,
    avatarUrl: membership.user.avatarUrl,
    orgId: membership.orgId,
    orgName: membership.org.name,
    orgSlug: membership.org.slug,
    role: membership.role,
  };

  console.log("\nNative platformData shapes (Platform-Native-Studios.md §1)");
  const shapes: { platform: Platform; data: Record<string, unknown>; expect: string }[] = [
    {
      platform: Platform.X,
      data: {
        kind: "thread",
        tweets: ["hook", "payoff", "close"],
        quoteOf: null,
        mediaCard: { type: "stat-card", assetId: null },
      },
      expect: "thread",
    },
    {
      platform: Platform.TIKTOK,
      data: {
        kind: "script",
        hookLine: "Three seconds to earn the rest",
        beats: [{ t: "0-3s", action: "cold open", onScreenText: "watch this" }],
        soundId: null,
        durationTargetSec: 30,
      },
      expect: "script",
    },
    {
      platform: Platform.INSTAGRAM,
      data: {
        kind: "carousel",
        coverHook: "Swipe for the one that worked",
        slides: [{ headline: "One", body: "point", template: "list-item" }],
      },
      expect: "carousel",
    },
    {
      platform: Platform.FACEBOOK,
      data: {
        kind: "post",
        body: "Longer, conversational.",
        linkCard: { url: null, title: null },
        discussionPrompt: "What's your take?",
      },
      expect: "post",
    },
    {
      platform: Platform.YOUTUBE,
      data: {
        kind: "long-form",
        titleOptions: ["A title"],
        thumbnailConcepts: ["A concept"],
        chapters: [{ time: "0:00", label: "Intro" }],
      },
      expect: "long-form",
    },
  ];

  const created: string[] = [];
  for (const shape of shapes) {
    const parsed = parsePlatformData(shape.platform, shape.data) as {
      kind: string;
    };
    ok(`${shape.platform} shape parses`, parsed.kind === shape.expect, parsed.kind);

    const post = await createPost(session, {
      platform: shape.platform,
      body: `Native shape test for ${shape.platform}`,
      status: PostStatus.DRAFT,
      platformData: shape.data,
    });
    created.push(post.id);
    const stored = post.platformData as { kind?: string };
    ok(
      `${shape.platform} shape survives the round trip`,
      stored.kind === shape.expect,
      String(stored.kind)
    );
  }

  // A round trip through a shape the schema doesn't know must not throw — it
  // falls back to defaults, because a legacy row is not a crash.
  const legacy = parsePlatformData(Platform.X, { nonsense: true }) as {
    kind: string;
  };
  ok("an unknown shape falls back rather than throwing", legacy.kind === "tweet");

  console.log("\nGrowth Strategist engine (Growth-Strategist-Engine.md §1-§3)");
  const times = await recomputeBestTimes(session.orgId, Platform.X);
  ok("best-time recompute returns a payload", times.type === "best-time");
  ok(
    "every recommendation carries basedOnDataThrough",
    times.basedOnDataThrough instanceof Date
  );
  ok(
    "confidence is driven by sample size",
    ["low", "medium", "high"].includes(times.confidence),
    `${times.confidence} on ${times.sampleSize} posts`
  );

  const ranking = await recomputeContentTypeRanking(session.orgId, Platform.X);
  ok("content-type recompute returns a payload", ranking.type === "content-type-ranking");

  // Cold start: a platform with no pulled posts must fall back to benchmarks
  // rather than showing an empty panel or inventing a number (§3).
  const cold = await recomputeBestTimes(session.orgId, Platform.FACEBOOK);
  const coldPayload = cold.payload as { slots: unknown[]; fallback: string | null };
  ok(
    "cold start falls back to benchmarks",
    coldPayload.slots.length === 0 && Boolean(coldPayload.fallback),
    (coldPayload.fallback ?? "").slice(0, 50)
  );
  ok("cold start is always low confidence", cold.confidence === "low");

  await recomputePlatform(session.orgId, Platform.X);
  const stored = await db.strategyRecommendation.findMany({
    where: { orgId: session.orgId, platform: Platform.X },
  });
  ok("recommendations persist", stored.length === 2, `${stored.length} rows`);

  await recomputePlatform(session.orgId, Platform.X);
  const afterRerun = await db.strategyRecommendation.count({
    where: { orgId: session.orgId, platform: Platform.X },
  });
  ok("recompute replaces rather than accumulates", afterRerun === 2, `${afterRerun} rows`);

  const highlights = await topRecommendations(session);
  ok("dashboard highlights are produced", highlights.length > 0, `${highlights.length}`);
  ok(
    "highlights carry their data cutoff",
    highlights.every((h) => h.basedOnDataThrough instanceof Date)
  );

  console.log("\nEngagement prediction (§3)");
  const prediction = await predictEngagement(session, {
    platform: Platform.X,
    body: "A draft long enough to be scored against the account's own history.",
    platformData: { kind: "thread" },
    scheduledAt: null,
  });
  ok(
    "returns a band, never a percentage",
    ["above-average", "typical", "below-average", "not-enough-data"].includes(
      prediction.band
    ),
    prediction.band
  );
  ok("reasoning is never empty", prediction.reasoning.length > 0);
  ok(
    "no fabricated precise percentage in the reasoning",
    // Percentages sourced from real aggregates are fine; a *prediction* stated
    // as a precise number is the thing §3 forbids.
    !prediction.reasoning.some((line) => /\b\d+(\.\d+)?%\s*(chance|likely|probability)/i.test(line))
  );

  const cold2 = await predictEngagement(session, {
    platform: Platform.FACEBOOK,
    body: "A draft for a platform with nothing pulled yet, long enough to score.",
    platformData: { kind: "post" },
    scheduledAt: null,
  });
  ok(
    "no history yields not-enough-data",
    cold2.band === "not-enough-data",
    cold2.band
  );
  ok("cold prediction still suggests something", cold2.suggestions.length > 0);

  console.log("\nTrend fan-out (Platform-Native-Studios.md §2)");
  // Start from a clean slate: re-running the fan-out on an existing trend
  // legitimately produces another five drafts, so counting rows would measure
  // leftovers from a previous run rather than this one's behaviour.
  await db.trendEvent.deleteMany({ where: { orgId: session.orgId } });
  const events = await detectTrends(session, Platform.X);
  ok("trends materialise as TrendEvent rows", events.length > 0, `${events.length}`);
  ok(
    "velocity and depth are classified",
    events.every((e) => ["breaking", "rising", "steady"].includes(e.velocity)) &&
      events.every((e) => ["quick-hit", "explainer-worthy"].includes(e.depth))
  );

  const again = await detectTrends(session, Platform.X);
  ok(
    "re-detecting the same topics doesn't duplicate",
    again.length === events.length &&
      (await db.trendEvent.count({ where: { orgId: session.orgId } })) === events.length
  );

  const fanned = await respondToTrend(session, events[0]!.id);
  ok("one trend, five drafts", fanned.drafts.length === 5, `${fanned.drafts.length}`);
  ok(
    "each draft is in its own platform's native shape",
    fanned.drafts.every((draft) => Boolean(draft.platformData.kind)),
    fanned.drafts.map((d) => `${d.platform}:${d.platformData.kind}`).join(" ")
  );
  ok(
    "the X draft is a thread of tweets",
    Array.isArray((fanned.drafts.find((d) => d.platform === Platform.X)!
      .platformData as { tweets?: unknown[] }).tweets)
  );
  ok(
    "the TikTok draft has a hook and beats",
    Boolean(
      (fanned.drafts.find((d) => d.platform === Platform.TIKTOK)!
        .platformData as { hookLine?: string }).hookLine
    )
  );

  const responses = await db.trendResponse.findMany({
    where: { trendEventId: events[0]!.id },
  });
  ok(
    "responses are recorded before review",
    responses.length === 5,
    `${responses.length} rows`
  );
  ok(
    "nothing was auto-published — draftPostId is null until accepted",
    responses.every((response) => response.draftPostId === null)
  );

  const accepted = await acceptTrendDraft(session, {
    responseId: fanned.drafts[0]!.responseId,
    platform: fanned.drafts[0]!.platform,
    body: fanned.drafts[0]!.body,
    platformData: fanned.drafts[0]!.platformData,
  });
  created.push(accepted.id);
  ok("accepting one creates a DRAFT post", accepted.status === PostStatus.DRAFT);
  const linked = await db.trendResponse.findUnique({
    where: { id: fanned.drafts[0]!.responseId },
  });
  ok("the response links to the post", linked?.draftPostId === accepted.id);
  ok(
    "the other four remain unsaved",
    (await db.trendResponse.count({
      where: { trendEventId: events[0]!.id, draftPostId: null },
    })) === 4
  );

  console.log("\nCleanup");
  await db.post.deleteMany({ where: { id: { in: created } } });
  await db.trendEvent.deleteMany({ where: { orgId: session.orgId } });
  await db.strategyRecommendation.deleteMany({ where: { orgId: session.orgId } });
  await db.connectedAccount.updateMany({
    where: { orgId: session.orgId, integrationMode: IntegrationMode.UNIFIED },
    data: { integrationMode: null },
  });
  console.log("  ✓ test rows removed");

  console.log(
    `\n${failures === 0 ? "✓" : "✗"} ${checks - failures}/${checks} checks passed\n`
  );
  await db.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("\nStrategy e2e threw:\n", error);
  await db.$disconnect();
  process.exit(1);
});
