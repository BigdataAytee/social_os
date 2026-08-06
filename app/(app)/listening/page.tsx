import type { Metadata } from "next";
import { Platform } from "@prisma/client";

import { CompetitorPanel } from "@/components/listening/competitor-panel";
import { MonitorPanel } from "@/components/listening/monitor-panel";
import { PageHeader } from "@/components/shell/page-placeholder";
import { Badge } from "@/components/ui/badge";
import { Section } from "@/components/ui/section";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";
import {
  benchmark,
  contentGaps,
  listCompetitorSummaries,
  topCompetitorPosts,
} from "@/modules/competitors/service";
import {
  listMentions,
  listMonitors,
  sentimentBreakdown,
} from "@/modules/listening/service";

export const metadata: Metadata = { title: "Listening · SocialOS" };
export const dynamic = "force-dynamic";

/**
 * Listening and competitor intelligence (OS-ARCHITECTURE.md §11 stage 6).
 *
 * One page rather than two because the two halves feed each other: a monitor's
 * mentions include competitors' posts, and the gap analysis is what turns "they
 * talk about this" into "we don't".
 */
export default async function ListeningPage() {
  const session = await requireSession();

  const [monitors, mentions, sentiment, competitors, gaps, top, xBenchmark] =
    await Promise.all([
      listMonitors(session),
      listMentions(session, { take: 40 }),
      sentimentBreakdown(session),
      listCompetitorSummaries(session),
      contentGaps(session),
      topCompetitorPosts(session, { take: 5 }),
      benchmark(session, Platform.X),
    ]);

  const canManage = can(session.role, "campaign.manage");

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-8 animate-fade-in">
      <PageHeader
        eyebrow="Intelligence"
        title="Listening"
        description="Terms worth watching, and what your competitors are doing that you aren't."
        action={
          sentiment.net !== null ? (
            <Badge
              variant={
                sentiment.net > 0.1
                  ? "success"
                  : sentiment.net < -0.1
                    ? "danger"
                    : "default"
              }
            >
              net sentiment {sentiment.net > 0 ? "+" : ""}
              {Math.round(sentiment.net * 100)}
            </Badge>
          ) : undefined
        }
      />

      <MonitorPanel
        monitors={monitors}
        mentions={mentions.map((mention) => ({
          ...mention,
          publishedAt: mention.publishedAt.toISOString(),
        }))}
        sentiment={sentiment}
        canManage={canManage}
      />

      <CompetitorPanel
        competitors={competitors.map((competitor) => ({
          ...competitor,
          lastSyncAt: competitor.lastSyncAt?.toISOString() ?? null,
        }))}
        gaps={gaps}
        benchmark={xBenchmark}
        canManage={canManage}
      />

      {top.length > 0 && (
        <Section
          title="Their best work"
          description="Highest engagement rate across everything tracked in the last 90 days"
        >
          <ul className="flex flex-col gap-2">
            {top.map((post) => (
              <li
                key={post.id}
                className="rounded-lg border border-border bg-surface p-4"
              >
                <div className="mb-1.5 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted">
                  <span>@{post.competitor.handle}</span>
                  <span>·</span>
                  <span>{post.competitor.platform}</span>
                  <span>·</span>
                  <span>{post.mediaType}</span>
                  <span>·</span>
                  <span>{post.rate.toFixed(1)}% engagement</span>
                </div>
                <p className="line-clamp-3 text-sm text-primary">{post.text}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
