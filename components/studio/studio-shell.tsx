"use client";

import { useState, useTransition } from "react";
import type { Platform } from "@prisma/client";
import {
  Flame,
  Inbox,
  LayoutTemplate,
  Lightbulb,
  LineChart,
  PenLine,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { SingleSeriesChart } from "@/components/charts/series-chart";
import { PostCard, type PostCardData } from "@/components/content/post-card";
import { AIGenerateBox } from "@/components/studio/ai-generate-box";
import {
  AccountPanel,
  type StudioAccount,
} from "@/components/studio/account-panel";
import { NativeComposer } from "@/components/studio/composers";
import { InsightsPanel } from "@/components/studio/insights-panel";
import { StrategyPanel } from "@/components/studio/strategy-panel";
import {
  TrendResponsePanel,
  type TrendEventRow,
} from "@/components/studio/trend-response";
import { STUDIO_FEATURES } from "@/components/studio/features";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { StatTile } from "@/components/ui/stat-tile";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createIdeaAction, deleteIdeaAction } from "@/app/actions/workspace";
import type { Studio } from "@/lib/studios";
import { zoneAbbreviation } from "@/lib/time";
import type { PlatformSeries, Totals } from "@/modules/analytics/service";
import type { Template } from "@/modules/templates/registry";
import type { Trend } from "@/modules/integrations/types";
import { formatCompact } from "@/lib/utils";

/**
 * StudioShell (ARCHITECTURE.md §8).
 *
 * Built once and consumed unchanged by all five Studios — the only thing that
 * differs is the data the server page hands in and the accent the route sets.
 * If a Studio ever needs to fork this, its props are wrong, not the platform.
 */

export type StudioShellData = {
  posts: PostCardData[];
  ideas: { id: string; content: string; source: string | null }[];
  competitors: { id: string; handle: string; notes: string | null }[];
  trends: Trend[];
  series: PlatformSeries | null;
  totals: Totals;
  bestTimes: { day: number; hour: number; score: number; posts: number }[];
  /** The zone those hours are in. Rendered next to them — an unlabelled hour
   *  is how these numbers silently meant UTC to every account. */
  bestTimesZone: string;
  templates: Template[];
  campaigns: { id: string; name: string }[];
  accounts: StudioAccount[];
  trendEvents: TrendEventRow[];
  briefing: {
    narrative: string | null;
    basedOnDataThrough: string | null;
    confidence: string | null;
  };
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function StudioShell({
  studio,
  data,
  canCreate,
  canApprove,
  canPublish,
  canWriteIdeas,
  canManageIntegrations,
  canGenerate,
  connectAvailable,
  unavailableReason,
  modelConfigured,
}: {
  studio: Studio;
  data: StudioShellData;
  /** False for a VIEWER — the composer and the AI box would only ever fail. */
  canCreate: boolean;
  canApprove: boolean;
  canPublish: boolean;
  canWriteIdeas: boolean;
  canManageIntegrations: boolean;
  canGenerate: boolean;
  /** False when this platform has no OAuth app configured on the server. */
  connectAvailable: boolean;
  unavailableReason: string | null;
  modelConfigured: boolean;
}) {
  const [draft, setDraft] = useState("");
  const platform = studio.platform as Platform;

  return (
    <div className="flex flex-col gap-5">
      <AccountPanel
        platform={platform}
        slug={studio.slug}
        accounts={data.accounts}
        canManage={canManageIntegrations}
        connectAvailable={connectAvailable}
        unavailableReason={unavailableReason}
      />

      {/* A read-only role opens on the queue; Create isn't theirs to see. */}
      <Tabs
        defaultValue={canCreate ? "create" : "queue"}
        className="flex flex-col"
      >
        <TabsList>
          {canCreate && (
            <TabsTrigger value="create">
              <PenLine className="h-3.5 w-3.5" />
              Create
            </TabsTrigger>
          )}
          <TabsTrigger value="queue">
            <Inbox className="h-3.5 w-3.5" />
            Queue
            <span className="font-mono text-[10px] tabular text-muted">
              {data.posts.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="ideas">
            <Lightbulb className="h-3.5 w-3.5" />
            Ideas
          </TabsTrigger>
          <TabsTrigger value="trends">
            <Flame className="h-3.5 w-3.5" />
            Trends
          </TabsTrigger>
          <TabsTrigger value="analytics">
            <LineChart className="h-3.5 w-3.5" />
            Analytics
          </TabsTrigger>
          <TabsTrigger value="templates">
            <LayoutTemplate className="h-3.5 w-3.5" />
            Templates
          </TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------------------ create */}
        {canCreate && (
          <TabsContent value="create">
            <div className="grid gap-5 lg:grid-cols-2">
              <AIGenerateBox
                studio={platform}
                features={STUDIO_FEATURES[platform]}
                onUse={setDraft}
                modelConfigured={modelConfigured}
              />
              <NativeComposer
                platform={platform}
                seed={draft}
                campaigns={data.campaigns}
                canSchedule={canApprove}
                onConsumed={() => setDraft("")}
              />
            </div>
          </TabsContent>
        )}

        {/* ------------------------------------------------------------- queue */}
        <TabsContent value="queue">
          {data.posts.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title={`Nothing in the ${studio.label} queue`}
              description="Drafts, scheduled posts and anything awaiting approval land here."
            />
          ) : (
            <div className="flex flex-col gap-3">
              {data.posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  canApprove={canApprove}
                  canPublish={canPublish}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ------------------------------------------------------------- ideas */}
        <TabsContent value="ideas">
          <div className="flex flex-col gap-6">
            <InsightsPanel
              platform={platform}
              connected={data.accounts.some((a) => a.connected)}
              canGenerate={canGenerate}
              canWriteIdeas={canWriteIdeas}
            />
            <div className="flex flex-col gap-3 border-t border-border pt-6">
              <h3 className="font-display text-sm font-medium text-primary">
                Saved ideas
              </h3>
              <IdeaList
                platform={platform}
                ideas={data.ideas}
                canWrite={canWriteIdeas}
              />
            </div>
          </div>
        </TabsContent>

        {/* ------------------------------------------------------------ trends */}
        <TabsContent value="trends">
          <div className="flex flex-col gap-6">
            <TrendResponsePanel
              platform={platform}
              events={data.trendEvents}
              canGenerate={canGenerate}
            />
            <div className="grid gap-5 border-t border-border pt-6 lg:grid-cols-2">
              <div className="flex flex-col gap-3">
                <h3 className="font-display text-sm font-medium text-primary">
                  Trending on {studio.label}
                </h3>
                <div className="flex flex-col gap-2">
                  {data.trends.map((trend) => (
                    <div
                      key={trend.topic}
                      className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2.5"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-secondary">
                        {trend.topic}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted">
                        {trend.category}
                      </span>
                      <span className="shrink-0 font-mono text-xs tabular text-primary">
                        {formatCompact(trend.volume)}
                      </span>
                      <span
                        className={`shrink-0 font-mono text-xs tabular ${
                          trend.change >= 0 ? "text-success" : "text-danger"
                        }`}
                      >
                        {trend.change >= 0 ? "+" : ""}
                        {trend.change}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <h3 className="font-display text-sm font-medium text-primary">
                  Tracked competitors
                </h3>
                {data.competitors.length === 0 ? (
                  <EmptyState
                    icon={Users}
                    title="No competitors tracked yet"
                    description={`Add ${studio.label} handles to watch what they're publishing.`}
                  />
                ) : (
                  <div className="flex flex-col gap-2">
                    {data.competitors.map((c) => (
                      <div
                        key={c.id}
                        className="flex flex-col gap-1 rounded-md border border-border bg-surface px-3 py-2.5"
                      >
                        <span className="font-mono text-xs text-primary">
                          {c.handle}
                        </span>
                        {c.notes && (
                          <span className="text-xs text-muted">{c.notes}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* --------------------------------------------------------- analytics */}
        <TabsContent value="analytics">
          <div className="flex flex-col gap-5">
            <StrategyPanel
              platform={platform}
              briefing={data.briefing.narrative}
              basedOnDataThrough={data.briefing.basedOnDataThrough}
              confidence={data.briefing.confidence}
              canGenerate={canGenerate}
            />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile
                label="Followers"
                value={data.totals.followers}
                delta={data.totals.deltas.followers}
              />
              <StatTile
                label="Reach"
                value={data.totals.reach}
                delta={data.totals.deltas.reach}
              />
              <StatTile
                label="Engagement"
                value={data.totals.engagement}
                delta={data.totals.deltas.engagement}
              />
              <StatTile
                label="Impressions"
                value={data.totals.impressions}
                delta={data.totals.deltas.impressions}
              />
            </div>

            {data.series && data.series.points.length > 0 ? (
              <div className="rounded-lg border border-border bg-surface p-5">
                <h3 className="mb-4 font-display text-sm font-medium text-primary">
                  Follower growth &mdash; last 30 days
                </h3>
                <SingleSeriesChart series={data.series} metric="followers" />
              </div>
            ) : (
              <EmptyState
                icon={LineChart}
                title="No analytics yet"
                description="Connect an account or run the seed to populate history."
              />
            )}

            <div className="rounded-lg border border-border bg-surface p-5">
              <h3 className="mb-1 font-display text-sm font-medium text-primary">
                Best posting times
              </h3>
              <p className="mb-4 text-xs text-muted">
                Derived from engagement on the days you actually published — not
                a generic recommendation.
              </p>
              {data.bestTimes.length === 0 ? (
                <p className="text-sm text-muted">
                  Publish a few posts and this fills in.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {data.bestTimes.slice(0, 8).map((slot) => (
                    <div
                      key={`${slot.day}-${slot.hour}`}
                      className="flex flex-col gap-0.5 rounded-md border border-border bg-surface-raised px-3 py-2"
                    >
                      <span className="font-mono text-xs text-primary">
                        {DAYS[slot.day]} {String(slot.hour).padStart(2, "0")}:00{" "}
                        <span className="text-muted">
                          {zoneAbbreviation(data.bestTimesZone)}
                        </span>
                      </span>
                      <span className="font-mono text-[10px] tabular text-muted">
                        {formatCompact(slot.score)} eng · {slot.posts} post
                        {slot.posts === 1 ? "" : "s"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* --------------------------------------------------------- templates */}
        <TabsContent value="templates">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {data.templates.map((template) => (
              <div
                key={template.id}
                className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
              >
                <div className="flex flex-col gap-1">
                  <h3 className="font-display text-sm font-medium text-primary">
                    {template.name}
                  </h3>
                  <p className="text-xs text-muted">{template.description}</p>
                </div>
                <pre className="flex-1 overflow-x-auto whitespace-pre-wrap rounded-sm border border-border bg-surface-raised p-3 font-mono text-[11px] leading-relaxed text-secondary">
                  {template.body}
                </pre>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setDraft(template.body);
                    toast.success(
                      "Loaded into the composer — open the Create tab",
                    );
                  }}
                >
                  Use template
                </Button>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ------------------------------------------------------------------ idea list

function IdeaList({
  platform,
  ideas,
  canWrite,
}: {
  platform: Platform;
  ideas: { id: string; content: string; source: string | null }[];
  canWrite: boolean;
}) {
  const [value, setValue] = useState("");
  const [items, setItems] = useState(ideas);
  const [pending, startTransition] = useTransition();

  function add() {
    const content = value.trim();
    if (!content) return;

    startTransition(async () => {
      const result = await createIdeaAction({ platform, content });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setItems((prev) => [
        { id: result.data.id, content, source: "manual" },
        ...prev,
      ]);
      setValue("");
      toast.success("Idea saved");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {canWrite && (
        <div className="flex gap-2">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
            placeholder="Capture an idea before it evaporates…"
          />
          <Button onClick={add} disabled={pending}>
            <Plus />
            Add
          </Button>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          icon={Lightbulb}
          title="No ideas saved yet"
          description="Anything you or the assistant come up with lands here."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((idea) => (
            <li
              key={idea.id}
              className="group flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2.5"
            >
              <span className="min-w-0 flex-1 text-sm text-secondary">
                {idea.content}
              </span>
              {idea.source && (
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted">
                  {idea.source}
                </span>
              )}
              <Button
                size="icon"
                variant="ghost"
                aria-label="Delete idea"
                className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                onClick={() => {
                  setItems((prev) => prev.filter((i) => i.id !== idea.id));
                  startTransition(async () => {
                    const result = await deleteIdeaAction(idea.id);
                    if (!result.ok) toast.error(result.error);
                  });
                }}
              >
                <Trash2 className="h-3.5 w-3.5 text-muted" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
