"use client";

import Link from "next/link";
import { ArrowRight, Flame, TrendingUp } from "lucide-react";

import { HubBoard, type StoryCardData } from "@/components/hub/hub-board";
import { Badge } from "@/components/ui/badge";

/**
 * The X Hub, inside the X Studio.
 *
 * The hub has a full page at `/hub` with all eight modules. This is the part
 * that belongs *here*: what happened, and what is worth reacting to, at the
 * moment you are sitting in the Studio deciding what to write. Leaving to look
 * and coming back to write is exactly the trip the hub exists to remove, and
 * putting it only on its own page would have reintroduced it.
 *
 * Not a copy — the same `HubBoard` the full page renders, with ingest included
 * so a link can be pasted without leaving. Anything that would duplicate the
 * eight-tab surface links out instead.
 */

export type StudioHubData = {
  stories: StoryCardData[];
  trends: { topic: string; posts: number; reach: number }[];
  canAct: boolean;
  canGenerate: boolean;
  modelConfigured: boolean;
};

export function StudioHubPanel({ hub }: { hub: StudioHubData }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-accent" aria-hidden />
          <h3 className="font-display text-sm font-medium text-primary">
            Worth reacting to
          </h3>
        </div>
        <Link
          href="/hub"
          className="flex items-center gap-1 text-xs text-secondary transition-colors hover:text-accent"
        >
          News, gists, videos and creators
          <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      </div>

      {hub.trends.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <TrendingUp className="h-3.5 w-3.5 text-muted" aria-hidden />
          {hub.trends.slice(0, 6).map((trend) => (
            <Badge key={trend.topic}>{trend.topic}</Badge>
          ))}
          <Link
            href="/hub"
            className="text-[11px] text-muted transition-colors hover:text-accent"
          >
            explain these →
          </Link>
        </div>
      )}

      <HubBoard
        initial={hub.stories}
        nextCursor={null}
        canAct={hub.canAct}
        canGenerate={hub.canGenerate}
        modelConfigured={hub.modelConfigured}
      />
    </div>
  );
}
