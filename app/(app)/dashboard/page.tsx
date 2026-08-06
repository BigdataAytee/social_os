import Link from "next/link";
import type { Metadata } from "next";
import { Platform, PostStatus } from "@prisma/client";
import { formatDistanceToNow } from "date-fns";
import {
  Activity,
  Bell,
  CalendarClock,
  CheckSquare,
  Flame,
  Inbox,
  Lightbulb,
  Megaphone,
  PenLine,
  Plug,
  Sparkles,
} from "lucide-react";

import { MultiSeriesChart } from "@/components/charts/series-chart";
import { PlatformDot } from "@/components/content/platform-badge";
import { PostCard } from "@/components/content/post-card";
import { PageHeader } from "@/components/shell/page-placeholder";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Section } from "@/components/ui/section";
import { StatTile } from "@/components/ui/stat-tile";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";
import { STUDIOS, studioForPlatform } from "@/lib/studios";
import { formatCompact } from "@/lib/utils";
import { listActivity } from "@/modules/activity/service";
import {
  getSeries,
  getTotals,
  listConnectedAccounts,
} from "@/modules/analytics/service";
import { listCampaigns } from "@/modules/campaigns/service";
import { listIdeas } from "@/modules/ideas/service";
import { getPlatformAdapter } from "@/modules/integrations/registry";
import { listNotifications } from "@/modules/notifications/service";
import { countByStatus, listPosts } from "@/modules/posts/service";
import { listTasks } from "@/modules/team/service";

export const metadata: Metadata = { title: "Dashboard · SocialOS" };

/**
 * The cross-platform view (Phase 1). Every number and list on this page is a
 * database read — edit a row and the dashboard changes.
 */
export default async function DashboardPage() {
  const session = await requireSession();

  const [
    totals,
    series,
    accounts,
    scheduled,
    approvals,
    campaigns,
    tasks,
    notifications,
    activity,
    ideas,
    counts,
    trends,
  ] = await Promise.all([
    getTotals(session, { days: 30 }),
    getSeries(session, { days: 30 }),
    listConnectedAccounts(session),
    listPosts(session, {
      status: [PostStatus.SCHEDULED, PostStatus.QUEUED],
      take: 5,
    }),
    listPosts(session, { status: PostStatus.NEEDS_APPROVAL, take: 5 }),
    listCampaigns(session),
    listTasks(session),
    listNotifications(session, 6),
    listActivity(session, 8),
    listIdeas(session, { take: 5 }),
    countByStatus(session),
    getPlatformAdapter(Platform.X).fetchTrends(),
  ]);

  const openTasks = tasks.filter((t) => t.status !== "DONE");
  const canCreate = can(session.role, "post.create");
  const canApprove = can(session.role, "post.approve");
  const canPublish = can(session.role, "post.publish");

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-8 animate-fade-in">
      <PageHeader
        eyebrow="Workspace"
        title={`Good to see you, ${session.name?.split(" ")[0] ?? "there"}`}
        description={`${session.orgName} — what's going out, what just happened, and what needs you.`}
        action={
          <div className="flex gap-2">
            <Button asChild size="sm" variant="secondary">
              <Link href="/calendar">
                <CalendarClock />
                Calendar
              </Link>
            </Button>
            {canCreate && (
              <Button asChild size="sm">
                <Link href="/studio/x">
                  <PenLine />
                  New post
                </Link>
              </Button>
            )}
          </div>
        }
      />

      <Section
        title="Performance"
        description="Last 30 days across every connected account"
        href="/analytics"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Followers"
            value={totals.followers}
            delta={totals.deltas.followers}
          />
          <StatTile label="Reach" value={totals.reach} delta={totals.deltas.reach} />
          <StatTile
            label="Engagement"
            value={totals.engagement}
            delta={totals.deltas.engagement}
          />
          <StatTile
            label="Impressions"
            value={totals.impressions}
            delta={totals.deltas.impressions}
          />
        </div>

        {series.some((s) => s.points.length > 0) && (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted">
              Follower growth · indexed to 100 at the start of the window
            </p>
            <MultiSeriesChart series={series} metric="followers" normalize />
          </div>
        )}
      </Section>

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="flex flex-col gap-8 lg:col-span-2">
          <Section
            title="Publishing queue"
            description={`${counts.SCHEDULED + counts.QUEUED} scheduled · ${counts.DRAFT} drafts · ${counts.NEEDS_APPROVAL} awaiting approval`}
            href="/calendar"
          >
            {scheduled.length === 0 ? (
              <EmptyState
                icon={Inbox}
                title="Nothing scheduled"
                description="Write something in a Studio and give it a time."
                action={
                  <Button asChild size="sm" variant="secondary">
                    <Link href="/studio/x">Open X Studio</Link>
                  </Button>
                }
              />
            ) : (
              <div className="flex flex-col gap-3">
                {scheduled.map((post) => (
                  <PostCard
                    key={post.id}
                    compact
                    canApprove={canApprove}
                    canPublish={canPublish}
                    post={{
                      id: post.id,
                      platform: post.platform,
                      status: post.status,
                      body: post.body,
                      scheduledAt: post.scheduledAt?.toISOString() ?? null,
                      publishedAt: post.publishedAt?.toISOString() ?? null,
                      campaignName: post.campaign?.name ?? null,
                      authorName: post.author.name ?? post.author.email,
                    }}
                  />
                ))}
              </div>
            )}
          </Section>

          {approvals.length > 0 && (
            <Section
              title="Needs approval"
              description={`${approvals.length} post${approvals.length === 1 ? "" : "s"} waiting`}
            >
              <div className="flex flex-col gap-3">
                {approvals.map((post) => (
                  <PostCard
                    key={post.id}
                    compact
                    canApprove={canApprove}
                    canPublish={canPublish}
                    post={{
                      id: post.id,
                      platform: post.platform,
                      status: post.status,
                      body: post.body,
                      scheduledAt: post.scheduledAt?.toISOString() ?? null,
                      publishedAt: post.publishedAt?.toISOString() ?? null,
                      campaignName: post.campaign?.name ?? null,
                      authorName: post.author.name ?? post.author.email,
                    }}
                  />
                ))}
              </div>
            </Section>
          )}

          <Section title="Campaigns" description={`${campaigns.length} running`}>
            {campaigns.length === 0 ? (
              <EmptyState icon={Megaphone} title="No campaigns yet" />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {campaigns.map((campaign) => (
                  <div
                    key={campaign.id}
                    className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-display text-sm font-medium text-primary">
                        {campaign.name}
                      </h3>
                      <span className="shrink-0 font-mono text-[11px] tabular text-muted">
                        {campaign._count.posts} posts
                      </span>
                    </div>
                    {campaign.description && (
                      <p className="line-clamp-2 text-xs text-muted">
                        {campaign.description}
                      </p>
                    )}
                    <p className="font-mono text-[10px] uppercase tracking-wider text-muted">
                      {campaign.startDate
                        ? campaign.startDate.toISOString().slice(0, 10)
                        : "—"}
                      {" → "}
                      {campaign.endDate
                        ? campaign.endDate.toISOString().slice(0, 10)
                        : "ongoing"}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Activity" description="Newest first">
            <ul className="flex flex-col gap-2">
              {activity.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2"
                >
                  <Activity className="h-3.5 w-3.5 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate text-sm text-secondary">
                    <span className="text-primary">
                      {entry.user.name ?? entry.user.email}
                    </span>{" "}
                    <span className="font-mono text-xs text-muted">
                      {entry.action}
                    </span>
                  </span>
                  <time
                    dateTime={entry.createdAt.toISOString()}
                    className="shrink-0 font-mono text-[10px] tabular text-muted"
                  >
                    {formatDistanceToNow(entry.createdAt, { addSuffix: true })}
                  </time>
                </li>
              ))}
            </ul>
          </Section>
        </div>

        <div className="flex flex-col gap-8">
          <Section title="Connected accounts" href="/settings">
            <div className="flex flex-col gap-2">
              {accounts.map((account) => {
                const studio = studioForPlatform(account.platform);
                return (
                  <Link
                    key={account.id}
                    href={`/studio/${studio.slug}`}
                    className="flex items-center gap-2.5 rounded-md border border-border bg-surface px-3 py-2.5 transition-colors hover:border-border-strong"
                  >
                    <PlatformDot platform={account.platform} />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-primary">
                      {account.handle}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted">
                      {account.status}
                    </span>
                  </Link>
                );
              })}
              {accounts.length === 0 && (
                <EmptyState icon={Plug} title="No accounts connected" />
              )}
            </div>
          </Section>

          <Section
            title="Notifications"
            description={`${notifications.filter((n) => !n.read).length} unread`}
          >
            {notifications.length === 0 ? (
              <EmptyState icon={Bell} title="Nothing new" />
            ) : (
              <ul className="flex flex-col gap-2">
                {notifications.map((n) => (
                  <li
                    key={n.id}
                    className={`flex flex-col gap-1 rounded-md border px-3 py-2 ${
                      n.read
                        ? "border-border bg-surface"
                        : "border-accent/25 bg-accent/5"
                    }`}
                  >
                    <span className="text-sm text-secondary">{n.body}</span>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
                      {n.type}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Tasks" description={`${openTasks.length} open`} href="/team">
            {openTasks.length === 0 ? (
              <EmptyState icon={CheckSquare} title="Nothing outstanding" />
            ) : (
              <ul className="flex flex-col gap-2">
                {openTasks.slice(0, 6).map((task) => (
                  <li
                    key={task.id}
                    className="flex items-center gap-2.5 rounded-md border border-border bg-surface px-3 py-2"
                  >
                    <CheckSquare className="h-3.5 w-3.5 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate text-sm text-secondary">
                      {task.title}
                    </span>
                    {task.assignee && (
                      <span className="shrink-0 font-mono text-[10px] text-muted">
                        {(task.assignee.name ?? task.assignee.email).split(" ")[0]}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Trending" description="On X, right now">
            <ul className="flex flex-col gap-2">
              {trends.slice(0, 5).map((trend) => (
                <li
                  key={trend.topic}
                  className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2"
                >
                  <Flame className="h-3.5 w-3.5 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate text-sm text-secondary">
                    {trend.topic}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] tabular text-muted">
                    {formatCompact(trend.volume)}
                  </span>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Saved ideas" href="/studio/x">
            {ideas.length === 0 ? (
              <EmptyState icon={Lightbulb} title="No ideas saved" />
            ) : (
              <ul className="flex flex-col gap-2">
                {ideas.map((idea) => (
                  <li
                    key={idea.id}
                    className="flex items-start gap-2.5 rounded-md border border-border bg-surface px-3 py-2"
                  >
                    <PlatformDot platform={idea.platform} className="mt-1.5" />
                    <span className="min-w-0 flex-1 text-sm text-secondary">
                      {idea.content}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Quick actions">
            <div className="grid grid-cols-2 gap-2">
              {STUDIOS.map((studio) => (
                <Button
                  key={studio.slug}
                  asChild
                  variant="secondary"
                  size="sm"
                  className="justify-start"
                >
                  <Link href={`/studio/${studio.slug}`}>
                    <span
                      aria-hidden
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{
                        backgroundColor: `rgb(var(${studio.accentVar}))`,
                      }}
                    />
                    {studio.label}
                  </Link>
                </Button>
              ))}
              <Button asChild variant="secondary" size="sm" className="justify-start">
                <Link href="/assistant">
                  <Sparkles />
                  Assistant
                </Link>
              </Button>
            </div>
          </Section>

          <Section title="Recommendations" description="From your own numbers">
            <ul className="flex flex-col gap-2">
              {buildRecommendations({
                totals,
                counts,
                approvals: approvals.length,
              }).map((rec) => (
                <li
                  key={rec}
                  className="flex items-start gap-2.5 rounded-md border border-accent/20 bg-accent/5 px-3 py-2 text-sm text-secondary"
                >
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                  {rec}
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}

/**
 * Recommendations derived from the org's own data. Deliberately rule-based
 * rather than a model call: these run on every dashboard load, and spending a
 * generation on "you have 4 posts awaiting approval" would be absurd.
 */
function buildRecommendations({
  totals,
  counts,
  approvals,
}: {
  totals: {
    engagementRate: number;
    deltas: { reach: number; followers: number };
  };
  counts: Record<PostStatus, number>;
  approvals: number;
}) {
  const out: string[] = [];

  if (approvals > 0) {
    out.push(
      `${approvals} post${approvals === 1 ? "" : "s"} ${approvals === 1 ? "is" : "are"} waiting on approval — that's the queue's bottleneck right now.`
    );
  }
  if (counts.FAILED > 0) {
    out.push(
      `${counts.FAILED} post${counts.FAILED === 1 ? "" : "s"} failed to publish. Retry ${counts.FAILED === 1 ? "it" : "them"} or check the connection.`
    );
  }
  if (counts.SCHEDULED + counts.QUEUED < 5) {
    out.push(
      "Fewer than five posts are scheduled. Fill the next two weeks while you have momentum."
    );
  }
  if (totals.deltas.reach < -5) {
    out.push(
      `Reach is down ${Math.abs(totals.deltas.reach).toFixed(0)}% on the previous 30 days. Find which format slipped before changing cadence.`
    );
  }
  if (totals.engagementRate > 4) {
    out.push(
      `Engagement rate is ${totals.engagementRate.toFixed(1)}% — above your usual. Whatever you shipped recently, do more of it.`
    );
  }
  if (counts.DRAFT > 8) {
    out.push(
      `${counts.DRAFT} drafts are sitting unpublished. A draft without a date is an idea.`
    );
  }

  return out.length > 0
    ? out.slice(0, 4)
    : ["Everything looks healthy. Nothing needs you right now."];
}
