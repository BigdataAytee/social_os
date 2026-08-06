import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { XStoryKind, type Platform } from "@prisma/client";

import { PageHeader } from "@/components/shell/page-placeholder";
import { StudioShell } from "@/components/studio/studio-shell";
import { Badge } from "@/components/ui/badge";
import { can } from "@/lib/auth/permissions";
import { requireSession, type Session } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { listStories } from "@/modules/xhub/service";
import { deriveTrends } from "@/modules/xhub/stories";
import { getStudio } from "@/lib/studios";
import { isModelConfigured } from "@/modules/ai/orchestrator";
import {
  getBestPostingTimes,
  getSeries,
  getTotals,
  listCompetitors,
} from "@/modules/analytics/service";
import { listCampaigns } from "@/modules/campaigns/service";
import { listRecommendations } from "@/modules/strategy/engine";
import { listTrendEvents } from "@/modules/trends/pipeline";
import { listIdeas } from "@/modules/ideas/service";
import {
  connectAvailability,
  listAccounts,
} from "@/modules/integrations/oauth/service";
import { getPlatformAdapter } from "@/modules/integrations/registry";
import { listPosts } from "@/modules/posts/service";
import { templatesFor } from "@/modules/templates/registry";

type Params = { params: { studio: string } };

export function generateMetadata({ params }: Params): Metadata {
  const studio = getStudio(params.studio);
  return {
    title: studio ? `${studio.label} Studio · SocialOS` : "Studio · SocialOS",
  };
}

/**
 * Every Studio renders through this one route (ARCHITECTURE.md §6). The five
 * differ by registry entry and by the data loaded here — not by component.
 */
export default async function StudioPage({ params }: Params) {
  const studio = getStudio(params.studio);
  if (!studio) notFound();

  const session = await requireSession();
  const platform = studio.platform;

  const [
    posts,
    ideas,
    competitors,
    trends,
    series,
    totals,
    bestTimes,
    campaigns,
    accounts,
    trendEvents,
    recommendations,
    hubFeed,
    hubTrends,
  ] = await Promise.all([
    listPosts(session, { platform, take: 40 }),
    listIdeas(session, { platform, take: 50 }),
    listCompetitors(session, platform),
    trendsFor(session, platform),
    getSeries(session, { platform, days: 30 }),
    getTotals(session, { platform, days: 30 }),
    getBestPostingTimes(session, platform),
    listCampaigns(session),
    listAccounts(session, platform),
    listTrendEvents(session),
    listRecommendations(session, platform),
    // Only the X Studio renders the hub, so the other four don't pay for the
    // query at all.
    platform === "X"
      ? listStories(session, { kind: XStoryKind.SAVAGE, take: 10 })
      : Promise.resolve({ stories: [], nextCursor: null }),
    platform === "X" ? deriveTrends(session, 6) : Promise.resolve([]),
  ]);

  // The briefing is stored, not regenerated per view — it's the one LLM step in
  // the Growth Strategist and would otherwise cost a model call every page load.
  const briefingRow = recommendations.find((row) => row.type === "weekly-briefing");
  const briefing = {
    narrative:
      (briefingRow?.payload as { narrative?: string } | null)?.narrative ?? null,
    basedOnDataThrough: briefingRow?.basedOnDataThrough.toISOString() ?? null,
    confidence: briefingRow?.confidence ?? null,
  };

  // Three different reasons a platform can't be connected — no encryption key,
  // no OAuth app, or both — each with its own fix, so the reason travels with
  // the flag rather than being reconstructed in the client.
  const availability = connectAvailability(platform);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-8 animate-fade-in">
      <PageHeader
        accent
        eyebrow="Studio"
        title={`${studio.label} Studio`}
        description={studio.tagline}
        action={
          <Badge variant="studio">
            {posts.length} post{posts.length === 1 ? "" : "s"}
          </Badge>
        }
      />

      <StudioShell
        studio={studio}
        canCreate={can(session.role, "post.create")}
        canApprove={can(session.role, "post.approve")}
        canPublish={can(session.role, "post.publish")}
        canWriteIdeas={can(session.role, "idea.write")}
        canManageIntegrations={can(session.role, "integration.manage")}
        canGenerate={can(session.role, "ai.generate")}
        connectAvailable={availability.available}
        unavailableReason={
          availability.available ? null : availability.reason
        }
        modelConfigured={isModelConfigured()}
        data={{
          posts: posts.map((p) => ({
            id: p.id,
            platform: p.platform,
            status: p.status,
            body: p.body,
            scheduledAt: p.scheduledAt?.toISOString() ?? null,
            publishedAt: p.publishedAt?.toISOString() ?? null,
            campaignName: p.campaign?.name ?? null,
            authorName: p.author.name ?? p.author.email,
          })),
          ideas: ideas.map((i) => ({
            id: i.id,
            content: i.content,
            source: i.source,
          })),
          competitors: competitors.map((c) => ({
            id: c.id,
            handle: c.handle,
            notes: c.notes,
          })),
          trends,
          series: series[0] ?? null,
          totals,
          // The hub is an X surface — the other Studios get null, and the tab
          // simply isn't rendered for them.
          hub:
            platform === "X"
              ? {
                  stories: hubFeed.stories.map((story) => ({
                    ...story,
                    createdAt: story.createdAt.toISOString(),
                    original: story.original
                      ? {
                          ...story.original,
                          publishedAt: story.original.publishedAt.toISOString(),
                        }
                      : null,
                    replies: story.replies.map((reply) => ({
                      ...reply,
                      publishedAt: reply.publishedAt.toISOString(),
                    })),
                  })),
                  trends: hubTrends,
                  canAct: can(session.role, "idea.write"),
                  canGenerate: can(session.role, "ai.generate"),
                  modelConfigured: isModelConfigured(),
                }
              : null,
          bestTimes: bestTimes.slots,
          bestTimesZone: bestTimes.timezone,
          templates: templatesFor(platform),
          campaigns: campaigns.map((c) => ({ id: c.id, name: c.name })),
          briefing,
          trendEvents: trendEvents.map((event) => ({
            id: event.id,
            topic: event.topic,
            summary: event.summary,
            velocity: event.velocity,
            depth: event.depth,
            responses: event.responses.length,
          })),
          accounts: accounts.map((a) => ({
            id: a.id,
            handle: a.handle,
            status: a.status,
            connected: a.connected,
            lastSyncAt: a.lastSyncAt?.toISOString() ?? null,
            lastSyncError: a.lastSyncError,
          })),
        }}
      />
    </div>
  );
}

/**
 * Trends for this Studio, scoped to the connected account's region.
 *
 * A small helper rather than an inline await so the page's `Promise.all` stays
 * one list of parallel reads — the region lookup is a second query and would
 * otherwise serialise the whole block behind it.
 */
async function trendsFor(session: Session, platform: Platform) {
  const account = await db.connectedAccount.findFirst({
    where: { orgId: session.orgId, platform },
    select: { region: true },
    orderBy: { createdAt: "asc" },
  });
  return getPlatformAdapter(platform).fetchTrends(account?.region);
}
