import type { Metadata } from "next";
import { XStoryKind } from "@prisma/client";

import { HubTabs } from "@/components/hub/hub-tabs";
import { PageHeader } from "@/components/shell/page-placeholder";
import { Badge } from "@/components/ui/badge";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";
import { isModelConfigured } from "@/modules/ai/orchestrator";
import { listStories } from "@/modules/xhub/service";
import {
  deriveTrends,
  hubAnalytics,
  listCreators,
  listVideos,
  visibleTopics,
} from "@/modules/xhub/stories";

export const metadata: Metadata = { title: "X Hub · SocialOS" };
export const dynamic = "force-dynamic";

/**
 * The X Hub (X-HUB.md).
 *
 * Eight modules, one corpus. Everything on this page is a different lens on the
 * posts the org has collected — which is why the modules agree with each other,
 * and why adding a post improves all of them at once.
 */
export default async function HubPage() {
  const session = await requireSession();

  const [savage, news, gists, trendStories, videos, creators, trends, stats, saved] =
    await Promise.all([
      listStories(session, { kind: XStoryKind.SAVAGE }),
      listStories(session, { kind: XStoryKind.NEWS }),
      listStories(session, { kind: XStoryKind.GIST }),
      listStories(session, { kind: XStoryKind.TREND }),
      listVideos(session),
      listCreators(session),
      deriveTrends(session),
      hubAnalytics(session),
      listStories(session, { saved: true }),
    ]);

  const serialise = (feed: Awaited<ReturnType<typeof listStories>>) =>
    feed.stories.map((story) => ({
      ...story,
      topics: visibleTopics((story as unknown as { topics?: string[] }).topics ?? []),
      createdAt: story.createdAt.toISOString(),
      original: story.original
        ? { ...story.original, publishedAt: story.original.publishedAt.toISOString() }
        : null,
      replies: story.replies.map((reply) => ({
        ...reply,
        publishedAt: reply.publishedAt.toISOString(),
      })),
    }));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8 animate-fade-in">
      <PageHeader
        eyebrow="Intelligence"
        title="X Hub"
        description="Posts worth reacting to, the replies that outdid them, and everything you can make from both."
        action={
          <div className="flex items-center gap-2">
            {stats.videos > 0 && <Badge>{stats.videos} videos</Badge>}
            <Badge variant="accent">{stats.posts} posts</Badge>
          </div>
        }
      />

      <HubTabs
        savage={serialise(savage)}
        savageCursor={savage.nextCursor}
        news={serialise(news)}
        gists={serialise(gists)}
        trendStories={serialise(trendStories)}
        saved={serialise(saved)}
        trends={trends}
        videos={videos.map((video) => ({
          id: video.id,
          externalId: video.externalId,
          authorHandle: video.authorHandle,
          authorName: video.authorName,
          text: video.text,
          permalink: video.permalink,
          mediaUrls: video.mediaUrls,
          likes: video.likes,
          reposts: video.reposts,
          replies: video.replies,
          interactions: video.interactions,
          publishedAt: video.publishedAt.toISOString(),
        }))}
        creators={creators}
        stats={stats}
        canAct={can(session.role, "idea.write")}
        canGenerate={can(session.role, "ai.generate")}
        modelConfigured={isModelConfigured()}
      />
    </div>
  );
}
