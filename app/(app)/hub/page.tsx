import type { Metadata } from "next";
import { XStoryKind } from "@prisma/client";

import { HubBoard } from "@/components/hub/hub-board";
import { PageHeader } from "@/components/shell/page-placeholder";
import { Badge } from "@/components/ui/badge";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";
import { isModelConfigured } from "@/modules/ai/orchestrator";
import { hubCounts, listStories } from "@/modules/xhub/service";

export const metadata: Metadata = { title: "X Hub · SocialOS" };
export const dynamic = "force-dynamic";

/**
 * The X Hub (X-HUB.md).
 *
 * Ranked by score rather than recency, for the same reason the inbox is: the
 * newest thing is rarely the best thing, and a feed sorted by arrival is a feed
 * you have to read all of.
 */
export default async function HubPage() {
  const session = await requireSession();

  const [feed, counts] = await Promise.all([
    listStories(session, { kind: XStoryKind.SAVAGE }),
    hubCounts(session),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8 animate-fade-in">
      <PageHeader
        eyebrow="Intelligence"
        title="X Hub"
        description="Posts worth reacting to, and the replies that outdid them — ranked, not just listed."
        action={
          <div className="flex items-center gap-2">
            {counts.saved > 0 && <Badge>{counts.saved} saved</Badge>}
            <Badge variant="accent">{counts.total} stories</Badge>
          </div>
        }
      />

      <HubBoard
        initial={feed.stories.map((story) => ({
          ...story,
          createdAt: story.createdAt.toISOString(),
          original: story.original
            ? { ...story.original, publishedAt: story.original.publishedAt.toISOString() }
            : null,
          replies: story.replies.map((reply) => ({
            ...reply,
            publishedAt: reply.publishedAt.toISOString(),
          })),
        }))}
        nextCursor={feed.nextCursor}
        canAct={can(session.role, "idea.write")}
        canGenerate={can(session.role, "ai.generate")}
        modelConfigured={isModelConfigured()}
      />
    </div>
  );
}
