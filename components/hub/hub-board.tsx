"use client";

import { useState, useTransition } from "react";
import type { XStoryKind } from "@prisma/client";
import {
  BadgeCheck,
  Bookmark,
  BookmarkCheck,
  ExternalLink,
  Flame,
  Loader2,
  Plus,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import {
  generateFromStoryAction,
  ingestAction,
  loadMoreAction,
  setSavedAction,
  type HubAction,
} from "@/app/actions/xhub";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * The hub feed (X-HUB.md).
 *
 * A card is an original post and the reply that beat it — the shape the brief's
 * screenshots use, because it is the shape the format has: you read the setup,
 * then the punchline, and the ranking is an argument for why this pair was
 * worth your attention rather than the next one.
 *
 * The scoring is on the card on purpose. A hub that ranks silently is a hub you
 * either trust completely or not at all; showing what it scored on lets someone
 * disagree with it, which is the only way it earns trust.
 */

export type StoryPostView = {
  id: string;
  externalId: string;
  authorHandle: string;
  authorName: string | null;
  authorAvatarUrl: string | null;
  authorVerified: boolean;
  text: string;
  permalink: string | null;
  mediaType: string;
  mediaUrls: string[];
  likes: number;
  replies: number;
  reposts: number;
  views: number;
  publishedAt: string;
  humour: number | null;
  roast: number | null;
  virality: number | null;
  engagement: number | null;
};

export type StoryCardData = {
  id: string;
  kind: XStoryKind;
  title: string;
  summary: string | null;
  coverUrl: string | null;
  score: number;
  scoring: Record<string, unknown>;
  /** Module-specific payload — hashtags, poll, timeline, angles. */
  details: Record<string, unknown>;
  topics: string[];
  saved: boolean;
  source: string;
  createdAt: string;
  original: StoryPostView | null;
  replies: StoryPostView[];
};

type Cursor = { score: number; id: string } | null;

const ACTIONS: { key: HubAction; label: string }[] = [
  { key: "caption", label: "Caption" },
  { key: "thread", label: "Thread" },
  { key: "reel", label: "Reel" },
  { key: "meme", label: "Meme" },
  { key: "carousel", label: "Carousel" },
  { key: "news", label: "News" },
];

export function HubBoard({
  initial,
  nextCursor,
  canAct,
  canGenerate,
  modelConfigured,
  hideIngest = false,
}: {
  initial: StoryCardData[];
  nextCursor: Cursor;
  canAct: boolean;
  canGenerate: boolean;
  modelConfigured: boolean;
  /** Set on tabs that render an existing list — one paste box per page. */
  hideIngest?: boolean;
}) {
  const [stories, setStories] = useState(initial);
  const [cursor, setCursor] = useState<Cursor>(nextCursor);
  const [links, setLinks] = useState("");
  const [adding, startAdd] = useTransition();
  const [loading, startLoad] = useTransition();

  function add() {
    const value = links.trim();
    if (!value) return;
    startAdd(async () => {
      const result = await ingestAction({ links: value });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setLinks("");
      toast.success(
        `${result.data.stories} ${result.data.stories === 1 ? "story" : "stories"} from ${result.data.posts} posts`
      );
      // Named rather than counted: "3 skipped" tells nobody which link was
      // wrong, and the usual cause is a deleted or protected post.
      for (const skipped of result.data.skipped.slice(0, 3)) {
        toast.warning(`Couldn't read ${skipped}`);
      }
      window.location.reload();
    });
  }

  function loadMore() {
    startLoad(async () => {
      const result = await loadMoreAction({ cursor });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setStories((current) => [
        ...current,
        ...(result.data.stories as unknown as StoryCardData[]),
      ]);
      setCursor(result.data.nextCursor);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {canAct && !hideIngest && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
            Add posts
          </span>
          <Textarea
            value={links}
            onChange={(event) => setLinks(event.target.value)}
            rows={2}
            placeholder="Paste X links, one per line — the replies come with them"
            className="font-mono text-xs"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={add} disabled={adding || !links.trim()}>
              {adding ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Plus className="h-4 w-4" aria-hidden />
              )}
              Add
            </Button>
            <p className="text-xs text-muted">
              Reads public posts through X&rsquo;s embed endpoint — no API key,
              no connected account needed.
            </p>
          </div>
        </div>
      )}

      {!modelConfigured && stories.length > 0 && (
        <p className="rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-primary">
          Ranking on engagement alone — humour and roast need{" "}
          <code className="font-mono">ANTHROPIC_API_KEY</code>. The order below
          is what travelled, not what was funniest.
        </p>
      )}

      {stories.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-12 text-center">
          <Flame className="h-6 w-6 text-muted" aria-hidden />
          <p className="text-sm text-primary">Nothing here yet.</p>
          <p className="max-w-md text-xs text-muted">
            Paste a few X links above. SocialOS pulls the post and its replies,
            scores them, and ranks the ones worth reacting to.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {stories.map((story) => (
            <StoryCard
              key={story.id}
              story={story}
              canAct={canAct}
              canGenerate={canGenerate}
            />
          ))}
        </div>
      )}

      {cursor && (
        <Button variant="secondary" onClick={loadMore} disabled={loading} className="self-center">
          {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Load more
        </Button>
      )}
    </div>
  );
}

function StoryCard({
  story,
  canAct,
  canGenerate,
}: {
  story: StoryCardData;
  canAct: boolean;
  canGenerate: boolean;
}) {
  const [saved, setSaved] = useState(story.saved);
  const [output, setOutput] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const best = story.replies[0] ?? null;

  function toggleSave() {
    start(async () => {
      const result = await setSavedAction({ storyId: story.id, saved: !saved });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSaved(result.data.saved);
    });
  }

  function run(action: HubAction) {
    start(async () => {
      const result = await generateFromStoryAction({
        storyId: story.id,
        action,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setOutput(result.data.output);
      toast.success(
        result.data.postId
          ? "Draft created — find it in the X Studio"
          : result.data.source === "local"
            ? "Local draft — set ANTHROPIC_API_KEY for Claude"
            : "Generated"
      );
    });
  }

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant={story.score >= 70 ? "danger" : "accent"}>
            {story.score}
          </Badge>
          <ScoreBreakdown scoring={story.scoring} reply={best} />
          {/*
            The post ids, copyable. The News and Gist builders take ids, and
            without this the only way to get one is the database — which makes
            a shipped feature depend on a tool the user doesn't have.
          */}
          <button
            type="button"
            onClick={() => {
              const ids = [story.original?.id, ...story.replies.map((r) => r.id)]
                .filter(Boolean)
                .join(" ");
              void navigator.clipboard?.writeText(ids);
              toast.success("Post ids copied — paste them into News or Gists");
            }}
            className="font-mono text-[10px] uppercase tracking-wider text-muted transition-colors hover:text-accent"
          >
            copy ids
          </button>
        </div>
        {canAct && (
          <button
            type="button"
            onClick={toggleSave}
            disabled={pending}
            aria-label={saved ? "Remove from saved" : "Save"}
            className="text-muted transition-colors hover:text-accent"
          >
            {saved ? (
              <BookmarkCheck className="h-4 w-4 text-accent" aria-hidden />
            ) : (
              <Bookmark className="h-4 w-4" aria-hidden />
            )}
          </button>
        )}
      </div>

      {story.summary && (
        <p className="whitespace-pre-wrap text-sm text-secondary">{story.summary}</p>
      )}

      <StoryDetails story={story} />

      {story.original && <PostView post={story.original} />}

      {best && (
        <div className="border-l-2 border-accent/40 pl-3">
          <PostView post={best} reply />
        </div>
      )}

      {story.replies.length > 1 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted transition-colors hover:text-secondary">
            {story.replies.length - 1} more{" "}
            {story.replies.length === 2 ? "reply" : "replies"}
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            {story.replies.slice(1).map((reply) => (
              <div key={reply.id} className="border-l border-border pl-3">
                <PostView post={reply} reply />
              </div>
            ))}
          </div>
        </details>
      )}

      {canGenerate && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
          <Sparkles className="h-3.5 w-3.5 text-muted" aria-hidden />
          {ACTIONS.map((action) => (
            <button
              key={action.key}
              type="button"
              disabled={pending}
              onClick={() => run(action.key)}
              className="rounded-full border border-border px-2.5 py-0.5 text-xs text-secondary transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-50"
            >
              {action.label}
            </button>
          ))}
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" aria-hidden />}
        </div>
      )}

      {output && (
        <div className="rounded-md border border-border bg-canvas p-3">
          <p className="whitespace-pre-wrap text-sm text-primary">{output}</p>
          <p className="mt-2 text-[11px] text-muted">
            Read it before you post it. This quotes someone else&rsquo;s words —
            credit them.
          </p>
        </div>
      )}
    </article>
  );
}

/**
 * The module-specific payload — a gist's hashtags and poll, a news timeline,
 * a trend's angles.
 *
 * One component rather than three cards because the difference between these
 * story kinds is what they carry, not how they behave: all four save, rank and
 * generate identically.
 */
function StoryDetails({ story }: { story: StoryCardData }) {
  const details = story.details ?? {};
  const hashtags = Array.isArray(details.hashtags) ? (details.hashtags as string[]) : [];
  const angles = Array.isArray(details.angles) ? (details.angles as string[]) : [];
  const timeline = Array.isArray(details.timeline)
    ? (details.timeline as { at: string; handle: string; text: string }[])
    : [];
  const poll = typeof details.poll === "string" ? details.poll : null;
  const prompt = typeof details.prompt === "string" ? details.prompt : null;

  if (
    hashtags.length === 0 &&
    angles.length === 0 &&
    timeline.length === 0 &&
    !poll &&
    !prompt
  ) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-canvas p-3">
      {hashtags.length > 0 && (
        <p className="font-mono text-xs text-accent">{hashtags.join(" ")}</p>
      )}
      {poll && (
        <p className="text-xs text-primary">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
            Poll{" "}
          </span>
          {poll}
        </p>
      )}
      {prompt && (
        <p className="text-xs text-primary">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
            Ask{" "}
          </span>
          {prompt}
        </p>
      )}
      {angles.length > 0 && (
        <ul className="flex flex-col gap-1">
          {angles.map((angle) => (
            <li key={angle} className="text-xs text-secondary">
              · {angle}
            </li>
          ))}
        </ul>
      )}
      {timeline.length > 0 && (
        <ol className="flex flex-col gap-1.5 border-l border-border pl-3">
          {timeline.map((entry) => (
            <li key={`${entry.at}-${entry.handle}`} className="text-xs">
              <span className="font-mono text-[10px] text-muted">
                {new Date(entry.at).toLocaleString()} · {entry.handle}
              </span>
              <p className="text-secondary">{entry.text}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function PostView({ post, reply = false }: { post: StoryPostView; reply?: boolean }) {
  return (
    <div className="flex gap-3">
      {post.authorAvatarUrl ? (
        // Remote avatars from X's CDN. next/image would need every host
        // allowlisted and buys nothing for a 32px circle.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={post.authorAvatarUrl}
          alt=""
          className="h-8 w-8 shrink-0 rounded-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="h-8 w-8 shrink-0 rounded-full bg-surface-raised" />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {post.authorName && (
            <span className="text-sm font-medium text-primary">{post.authorName}</span>
          )}
          {post.authorVerified && (
            <BadgeCheck className="h-3.5 w-3.5 text-accent" aria-label="verified" />
          )}
          <span className="font-mono text-xs text-muted">{post.authorHandle}</span>
          {post.permalink && (
            <a
              href={post.permalink}
              target="_blank"
              rel="noreferrer noopener"
              className="text-muted transition-colors hover:text-accent"
              aria-label="Open on X"
            >
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          )}
        </div>

        <p
          className={cn(
            "mt-0.5 whitespace-pre-wrap text-sm",
            reply ? "text-primary" : "text-secondary"
          )}
        >
          {post.text}
        </p>

        {post.mediaUrls.length > 0 && post.mediaType !== "video" && (
          <div className="mt-2 flex gap-2 overflow-x-auto">
            {post.mediaUrls.slice(0, 4).map((url) => (
              // Remote media from X's CDN, same reasoning as the avatar above.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={url}
                src={url}
                alt=""
                loading="lazy"
                className="h-32 w-auto rounded-md border border-border object-cover"
              />
            ))}
          </div>
        )}

        <div className="mt-1 flex flex-wrap gap-3 font-mono text-[10px] text-muted">
          <span>{compact(post.likes)} likes</span>
          <span>{compact(post.reposts)} reposts</span>
          <span>{compact(post.replies)} replies</span>
          {post.views > 0 && <span>{compact(post.views)} views</span>}
        </div>
      </div>
    </div>
  );
}

/**
 * Why this ranked where it did.
 *
 * Shown rather than hidden because "engagement-only" and "full" are genuinely
 * different claims — one says this travelled, the other says it was funny — and
 * conflating them is how a ranking loses its meaning.
 */
function ScoreBreakdown({
  scoring,
  reply,
}: {
  scoring: Record<string, unknown>;
  reply: StoryPostView | null;
}) {
  const basis = scoring.basis === "full" ? "full" : "engagement-only";
  if (!reply) return null;

  return (
    <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
      {basis === "full" && reply.humour !== null ? (
        <>
          humour {reply.humour} · roast {reply.roast} · viral {reply.virality}
        </>
      ) : (
        <>viral {reply.virality} · engagement {reply.engagement} · no wit score</>
      )}
    </span>
  );
}

function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}
