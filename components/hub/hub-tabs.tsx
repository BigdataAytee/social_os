"use client";

import { useState, useTransition } from "react";
import {
  BadgeCheck,
  ExternalLink,
  Flame,
  Loader2,
  Newspaper,
  PlayCircle,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import {
  buildStoryAction,
  buildTrendAction,
} from "@/app/actions/xhub";
import { HubBoard, type StoryCardData } from "@/components/hub/hub-board";
import {
  TabSuggestions,
  type TabSuggestionRow,
} from "@/components/hub/tab-suggestions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/**
 * The eight modules (X-HUB.md §4).
 *
 * One corpus, eight lenses. Savage Replies, News, Gists and Trends are all
 * `XStory` rows and reuse one card; Videos and Creators are views over the raw
 * posts; Saved is a filter; Analytics is counts. That symmetry is the reason
 * adding a post improves every tab at once rather than only the one you were
 * looking at.
 */

export type VideoRow = {
  id: string;
  externalId: string;
  authorHandle: string;
  authorName: string | null;
  text: string;
  permalink: string | null;
  mediaUrls: string[];
  likes: number;
  reposts: number;
  replies: number;
  interactions: number;
  publishedAt: string;
};

export type CreatorRow = {
  handle: string;
  name: string | null;
  avatarUrl: string | null;
  verified: boolean;
  posts: number;
  likes: number;
  reposts: number;
  average: number;
};

export type TrendRow = { topic: string; posts: number; reach: number };

export type HubStats = {
  posts: number;
  stories: number;
  videos: number;
  creators: number;
  byKind: Record<string, number>;
  interactions: number;
};

export function HubTabs({
  savage,
  savageCursor,
  news,
  gists,
  trendStories,
  saved,
  trends,
  videos,
  creators,
  stats,
  tabSuggestions,
  canAct,
  canGenerate,
  modelConfigured,
}: {
  savage: StoryCardData[];
  savageCursor: { score: number; id: string } | null;
  news: StoryCardData[];
  gists: StoryCardData[];
  trendStories: StoryCardData[];
  saved: StoryCardData[];
  trends: TrendRow[];
  videos: VideoRow[];
  creators: CreatorRow[];
  stats: HubStats;
  /** Three proposals per tab, keyed by XStoryKind. */
  tabSuggestions: Record<string, TabSuggestionRow[]>;
  canAct: boolean;
  canGenerate: boolean;
  modelConfigured: boolean;
}) {
  return (
    <Tabs defaultValue="savage">
      <TabsList className="flex-wrap">
        <TabsTrigger value="savage">😂 Savage {count(savage)}</TabsTrigger>
        <TabsTrigger value="news">📰 News {count(news)}</TabsTrigger>
        <TabsTrigger value="gists">🧵 Gists {count(gists)}</TabsTrigger>
        <TabsTrigger value="trends">🔥 Trends {count(trendStories)}</TabsTrigger>
        <TabsTrigger value="videos">🎥 Videos {count(videos)}</TabsTrigger>
        <TabsTrigger value="creators">📸 Creators {count(creators)}</TabsTrigger>
        <TabsTrigger value="saved">⭐ Saved {count(saved)}</TabsTrigger>
        <TabsTrigger value="analytics">📈 Analytics</TabsTrigger>
      </TabsList>

      <TabsContent value="savage">
        <TabSuggestions
          suggestions={tabSuggestions.SAVAGE ?? []}
          canGenerate={canGenerate}
        />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <HubBoard
            initial={savage}
            nextCursor={savageCursor}
            canAct={canAct}
            canGenerate={canGenerate}
            modelConfigured={modelConfigured}
          />
          <HubRail trends={trends} news={news} videos={videos} />
        </div>
      </TabsContent>

      <TabsContent value="news">
        <TabSuggestions
          suggestions={tabSuggestions.NEWS ?? []}
          canGenerate={canGenerate}
        />
        <StoryBuilder kind="news" canGenerate={canGenerate} />
        <StoryList
          stories={news}
          empty="No news items yet. Pick posts on the Savage tab and build one."
          canAct={canAct}
          canGenerate={canGenerate}
        />
      </TabsContent>

      <TabsContent value="gists">
        <TabSuggestions
          suggestions={tabSuggestions.GIST ?? []}
          canGenerate={canGenerate}
        />
        <StoryBuilder kind="gist" canGenerate={canGenerate} />
        <StoryList
          stories={gists}
          empty="No gists yet."
          canAct={canAct}
          canGenerate={canGenerate}
        />
      </TabsContent>

      <TabsContent value="trends">
        <TabSuggestions
          suggestions={tabSuggestions.TREND ?? []}
          canGenerate={canGenerate}
        />
        <TrendsPanel
          trends={trends}
          stories={trendStories}
          canGenerate={canGenerate}
          canAct={canAct}
        />
      </TabsContent>

      <TabsContent value="videos">
        <TabSuggestions
          suggestions={tabSuggestions.VIDEO ?? []}
          canGenerate={canGenerate}
        />
        <VideosPanel videos={videos} />
      </TabsContent>

      <TabsContent value="creators">
        <CreatorsPanel creators={creators} />
      </TabsContent>

      <TabsContent value="saved">
        <StoryList
          stories={saved}
          empty="Nothing saved. The bookmark on any card puts it here."
          canAct={canAct}
          canGenerate={canGenerate}
        />
      </TabsContent>

      <TabsContent value="analytics">
        <AnalyticsPanel stats={stats} />
      </TabsContent>
    </Tabs>
  );
}

/**
 * The right rail: what's trending, the latest news item, the top video.
 *
 * A digest of the other tabs, beside the one you're on. The mockup put these
 * here for a reason worth keeping — the tabs are where you work, and the rail is
 * where you notice something you weren't looking for.
 *
 * Every card links to the tab that owns it rather than duplicating its
 * behaviour, so there is one place each thing can be acted on.
 */
function HubRail({
  trends,
  news,
  videos,
}: {
  trends: TrendRow[];
  news: StoryCardData[];
  videos: VideoRow[];
}) {
  const topNews = news[0];
  const topVideo = videos[0];

  return (
    <aside className="flex flex-col gap-3">
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="mb-2 flex items-center gap-1.5">
          <TrendingUp className="h-3.5 w-3.5 text-accent" aria-hidden />
          <h3 className="font-display text-sm font-medium text-primary">
            Trending in your hub
          </h3>
        </div>
        {trends.length === 0 ? (
          <p className="text-xs text-muted">
            Add posts and subjects start repeating.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {trends.slice(0, 4).map((trend) => (
              <li key={trend.topic} className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-sm text-primary">
                  {trend.topic}
                </span>
                <span className="font-mono text-[10px] text-muted">
                  {compact(trend.reach)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {topNews && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="mb-2 flex items-center gap-1.5">
            <Newspaper className="h-3.5 w-3.5 text-accent" aria-hidden />
            <h3 className="font-display text-sm font-medium text-primary">
              Top news
            </h3>
          </div>
          {topNews.coverUrl && (
            // Remote media from X's CDN, same reasoning as the story card.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={topNews.coverUrl}
              alt=""
              loading="lazy"
              className="mb-2 h-28 w-full rounded-md border border-border object-cover"
            />
          )}
          <p className="text-sm text-primary">{topNews.title}</p>
          {topNews.summary && (
            <p className="mt-1 line-clamp-3 text-xs text-secondary">
              {topNews.summary}
            </p>
          )}
        </div>
      )}

      {topVideo && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="mb-2 flex items-center gap-1.5">
            <PlayCircle className="h-3.5 w-3.5 text-accent" aria-hidden />
            <h3 className="font-display text-sm font-medium text-primary">
              Viral video
            </h3>
          </div>
          {topVideo.mediaUrls[0] && (
            <video
              src={topVideo.mediaUrls[0]}
              controls
              preload="none"
              className="mb-2 w-full rounded-md border border-border"
            />
          )}
          <p className="line-clamp-2 text-sm text-primary">{topVideo.text}</p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted">
            {topVideo.authorHandle} · {compact(topVideo.interactions)}
          </p>
        </div>
      )}
    </aside>
  );
}

function count(list: unknown[]): string {
  return list.length > 0 ? String(list.length) : "";
}

/**
 * Build a story from posts the person picks.
 *
 * Selection is deliberately manual. "These three posts are about the same
 * thing" is a judgement a person makes better and faster than a clustering
 * pass, and an automatic one that gets it wrong produces a news item
 * confidently merging two unrelated events.
 */
function StoryBuilder({
  kind,
  canGenerate,
}: {
  kind: "news" | "gist";
  canGenerate: boolean;
}) {
  const [ids, setIds] = useState("");
  const [pending, start] = useTransition();

  if (!canGenerate) return null;

  function build() {
    const postIds = ids
      .split(/[\s,]+/)
      .map((id) => id.trim())
      .filter(Boolean);
    if (postIds.length === 0) return;

    start(async () => {
      const result = await buildStoryAction({ kind, postIds });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setIds("");
      toast.success(result.data ? `Built: ${result.data.title}` : "Nothing to build");
      window.location.reload();
    });
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-4">
      <input
        value={ids}
        onChange={(event) => setIds(event.target.value)}
        placeholder="Post ids, space separated — copy them from a card"
        className="min-w-[16rem] flex-1 rounded-md border border-border bg-canvas px-3 py-2 font-mono text-xs text-primary"
      />
      <Button onClick={build} disabled={pending || !ids.trim()}>
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Newspaper className="h-4 w-4" aria-hidden />
        )}
        Build {kind}
      </Button>
    </div>
  );
}

function StoryList({
  stories,
  empty,
  canAct,
  canGenerate,
}: {
  stories: StoryCardData[];
  empty: string;
  canAct: boolean;
  canGenerate: boolean;
}) {
  if (stories.length === 0) return <EmptyState title={empty} />;

  return (
    <HubBoard
      initial={stories}
      nextCursor={null}
      canAct={canAct}
      canGenerate={canGenerate}
      modelConfigured
      hideIngest
    />
  );
}

function TrendsPanel({
  trends,
  stories,
  canGenerate,
  canAct,
}: {
  trends: TrendRow[];
  stories: StoryCardData[];
  canGenerate: boolean;
  canAct: boolean;
}) {
  const [pending, start] = useTransition();
  const [active, setActive] = useState<string | null>(null);

  function explain(topic: string) {
    setActive(topic);
    start(async () => {
      const result = await buildTrendAction({ topic });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Explained "${topic}"`);
      window.location.reload();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted">
          Recurring in what you&rsquo;ve collected
        </p>
        <p className="mt-1 text-xs text-muted">
          Ranked by reach, not by how often a word appears — a topic in twenty
          posts nobody saw isn&rsquo;t trending.
        </p>
        {trends.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            Add more posts and subjects will start repeating.
          </p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {trends.map((trend) => (
              <li key={trend.topic}>
                <button
                  type="button"
                  disabled={!canGenerate || pending}
                  onClick={() => explain(trend.topic)}
                  title={`${trend.posts} posts · ${trend.reach.toLocaleString()} interactions`}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-secondary transition-colors",
                    canGenerate && "hover:border-accent/40 hover:text-accent",
                    pending && active === trend.topic && "opacity-50"
                  )}
                >
                  <TrendingUp className="h-3 w-3" aria-hidden />
                  {trend.topic}
                  <span className="text-muted">{compact(trend.reach)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <StoryList
        stories={stories}
        empty="Pick a topic above to have it explained."
        canAct={canAct}
        canGenerate={canGenerate}
      />
    </div>
  );
}

function VideosPanel({ videos }: { videos: VideoRow[] }) {
  if (videos.length === 0) {
    return (
      <EmptyState title="No videos yet. Add posts with video and they land here." />
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {videos.map((video) => (
        <article
          key={video.id}
          className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
        >
          <div className="flex items-center gap-2">
            <PlayCircle className="h-4 w-4 text-accent" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">
              {video.authorHandle}
            </span>
            <Badge variant="accent">{compact(video.interactions)}</Badge>
          </div>
          <p className="line-clamp-3 text-sm text-primary">{video.text}</p>
          {video.mediaUrls[0] && (
            <video
              src={video.mediaUrls[0]}
              controls
              preload="none"
              className="w-full rounded-md border border-border"
            />
          )}
          <div className="flex gap-3 font-mono text-[10px] text-muted">
            <span>{compact(video.likes)} likes</span>
            <span>{compact(video.reposts)} reposts</span>
            {video.permalink && (
              <a
                href={video.permalink}
                target="_blank"
                rel="noreferrer noopener"
                className="ml-auto transition-colors hover:text-accent"
              >
                Open <ExternalLink className="inline h-3 w-3" aria-hidden />
              </a>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

function CreatorsPanel({ creators }: { creators: CreatorRow[] }) {
  if (creators.length === 0) {
    return <EmptyState title="No creators yet — they appear as you add posts." />;
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted">
        Ranked by average interactions per post, not by total — total just
        rewards whoever you happened to collect most of.
      </p>
      {creators.map((creator) => (
        <div
          key={creator.handle}
          className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3"
        >
          {creator.avatarUrl ? (
            // Remote avatars from X's CDN, same reasoning as the story card.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={creator.avatarUrl}
              alt=""
              loading="lazy"
              className="h-9 w-9 rounded-full object-cover"
            />
          ) : (
            <Users className="h-9 w-9 rounded-full bg-surface-raised p-2 text-muted" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm text-primary">
                {creator.name ?? creator.handle}
              </span>
              {creator.verified && (
                <BadgeCheck className="h-3.5 w-3.5 text-accent" aria-label="verified" />
              )}
            </div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted">
              {creator.handle} · {creator.posts} posts
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-primary">{compact(creator.average)}</p>
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted">
              avg / post
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function AnalyticsPanel({ stats }: { stats: HubStats }) {
  const tiles = [
    { label: "Posts collected", value: stats.posts, icon: Flame },
    { label: "Stories built", value: stats.stories, icon: Sparkles },
    { label: "Creators seen", value: stats.creators, icon: Users },
    { label: "Videos", value: stats.videos, icon: PlayCircle },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-4">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className="rounded-lg border border-border bg-surface p-4"
          >
            <tile.icon className="h-4 w-4 text-muted" aria-hidden />
            <p className="mt-2 font-display text-xl text-primary">
              {compact(tile.value)}
            </p>
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted">
              {tile.label}
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted">
          Total interactions across the corpus
        </p>
        <p className="mt-1 font-display text-2xl text-primary">
          {stats.interactions.toLocaleString()}
        </p>
        <p className="mt-2 text-xs text-muted">
          Likes, reposts and replies on every post collected. This measures what
          you gathered, not what you published — your own performance is in
          Analytics.
        </p>
      </div>

      {Object.keys(stats.byKind).length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted">
            Stories by kind
          </p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(stats.byKind).map(([kind, n]) => (
              <Badge key={kind}>
                {kind.toLowerCase()} {n}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}
