import type { Metadata } from "next";
import { TrendingUp } from "lucide-react";

import { MultiSeriesChart } from "@/components/charts/series-chart";
import { PageHeader } from "@/components/shell/page-placeholder";
import { EmptyState } from "@/components/ui/empty-state";
import { Section } from "@/components/ui/section";
import { StatTile } from "@/components/ui/stat-tile";
import { requireSession } from "@/lib/auth/session";
import { zoneAbbreviation } from "@/lib/time";
import { studioForPlatform } from "@/lib/studios";
import { formatCompact } from "@/lib/utils";
import {
  getBestPostingTimes,
  getSeries,
  getTotals,
  listCompetitors,
} from "@/modules/analytics/service";

export const metadata: Metadata = { title: "Analytics · SocialOS" };

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Cross-platform analytics (Phase 7). Every chart and tile reads
 * AnalyticsSnapshot through the analytics service — nothing here is hardcoded.
 */
export default async function AnalyticsPage() {
  const session = await requireSession();

  const [totals, series, bestTimes, competitors] = await Promise.all([
    getTotals(session, { days: 30 }),
    getSeries(session, { days: 90 }),
    getBestPostingTimes(session),
    listCompetitors(session),
  ]);

  const hasData = series.some((s) => s.points.length > 0);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-8 animate-fade-in">
      <PageHeader
        eyebrow="Workspace"
        title="Analytics"
        description="Every platform on one axis. Totals cover the last 30 days; charts show 90."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile
          label="Followers"
          value={totals.followers}
          delta={totals.deltas.followers}
        />
        <StatTile label="Reach" value={totals.reach} delta={totals.deltas.reach} />
        <StatTile
          label="Impressions"
          value={totals.impressions}
          delta={totals.deltas.impressions}
        />
        <StatTile
          label="Engagement"
          value={totals.engagement}
          delta={totals.deltas.engagement}
        />
        <StatTile label="Clicks" value={totals.clicks} />
      </div>

      {!hasData ? (
        <EmptyState
          icon={TrendingUp}
          title="No analytics history yet"
          description="Connect an account, or run `npx prisma db seed` to populate 60–90 days of demo history."
        />
      ) : (
        <>
          <Section
            title="Follower growth"
            description="90 days, indexed to 100 at the start — platforms differ by an order of magnitude, so relative growth is the comparable view"
          >
            <div className="rounded-lg border border-border bg-surface p-5">
              <MultiSeriesChart
                series={series}
                metric="followers"
                height={300}
                normalize
              />
            </div>
          </Section>

          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Reach" description="90 days">
              <div className="rounded-lg border border-border bg-surface p-5">
                <MultiSeriesChart series={series} metric="reach" height={240} />
              </div>
            </Section>
            <Section title="Engagement" description="90 days">
              <div className="rounded-lg border border-border bg-surface p-5">
                <MultiSeriesChart series={series} metric="engagement" height={240} />
              </div>
            </Section>
          </div>

          <Section
            title="Audience by platform"
            description="Share of total following"
          >
            <div className="flex flex-col gap-2">
              {series
                .map((s) => ({
                  platform: s.platform,
                  handle: s.handle,
                  followers: s.points.at(-1)?.followers ?? 0,
                }))
                .sort((a, b) => b.followers - a.followers)
                .map((row) => {
                  const share =
                    totals.followers === 0
                      ? 0
                      : (row.followers / totals.followers) * 100;
                  const studio = studioForPlatform(row.platform);
                  return (
                    <div
                      key={row.platform}
                      className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2.5"
                    >
                      <span
                        aria-hidden
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{
                          backgroundColor: `rgb(var(${studio.accentVar}))`,
                        }}
                      />
                      <span className="w-24 shrink-0 text-sm text-primary">
                        {studio.label}
                      </span>
                      <span className="hidden min-w-0 flex-1 truncate font-mono text-xs text-muted sm:block">
                        {row.handle}
                      </span>
                      <div
                        className="h-1.5 w-32 shrink-0 overflow-hidden rounded-full bg-surface-raised"
                        role="presentation"
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${share}%`,
                            backgroundColor: `rgb(var(${studio.accentVar}))`,
                          }}
                        />
                      </div>
                      <span className="w-16 shrink-0 text-right font-mono text-xs tabular text-primary">
                        {formatCompact(row.followers)}
                      </span>
                      <span className="w-12 shrink-0 text-right font-mono text-xs tabular text-muted">
                        {share.toFixed(0)}%
                      </span>
                    </div>
                  );
                })}
            </div>
          </Section>
        </>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          title="Best posting times"
          description={`Ranked by engagement on the days you published — times in ${zoneAbbreviation(bestTimes.timezone)}`}
        >
          {bestTimes.slots.length === 0 ? (
            <EmptyState title="Publish a few posts and this fills in" />
          ) : (
            <div className="flex flex-wrap gap-2">
              {bestTimes.slots.slice(0, 10).map((slot) => (
                <div
                  key={`${slot.day}-${slot.hour}`}
                  className="flex flex-col gap-0.5 rounded-md border border-border bg-surface px-3 py-2"
                >
                  <span className="font-mono text-xs text-primary">
                    {DAYS[slot.day]} {String(slot.hour).padStart(2, "0")}:00
                  </span>
                  <span className="font-mono text-[10px] tabular text-muted">
                    {formatCompact(slot.score)} eng
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Competitors" description="Tracked across every platform">
          {competitors.length === 0 ? (
            <EmptyState title="No competitors tracked" />
          ) : (
            <div className="flex flex-col gap-2">
              {competitors.map((c) => {
                const studio = studioForPlatform(c.platform);
                return (
                  <div
                    key={c.id}
                    className="flex items-start gap-2.5 rounded-md border border-border bg-surface px-3 py-2.5"
                  >
                    <span
                      aria-hidden
                      className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                      style={{
                        backgroundColor: `rgb(var(${studio.accentVar}))`,
                      }}
                    />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-mono text-xs text-primary">
                        {c.handle}
                      </span>
                      {c.notes && (
                        <span className="text-xs text-muted">{c.notes}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
