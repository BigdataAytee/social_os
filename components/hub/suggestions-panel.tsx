"use client";

import Link from "next/link";
import { useTransition } from "react";
import {
  ArrowRight,
  Globe,
  Loader2,
  MessageSquare,
  RefreshCw,
  Repeat,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";

import { discoverAction, harvestAction } from "@/app/actions/xhub";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * What to do next (modules/xhub/suggestions.ts).
 *
 * This is the answer to "the hub waits instead of suggesting". It sits above
 * the feed because it is the thing worth reading first — the feed is material,
 * this is a decision.
 *
 * Every row shows its reason at the same size as its instruction. A suggestion
 * you can't check is one you either obey or ignore, and both are worse than one
 * you can disagree with.
 */

export type SuggestionRow = {
  kind: "reply" | "topic" | "format" | "gap" | "reshare" | "cadence";
  title: string;
  why: string;
  urgency: number;
  href: string;
  prompt?: string;
};

const ICON = {
  reply: MessageSquare,
  topic: TrendingUp,
  format: Sparkles,
  gap: Target,
  reshare: Repeat,
  cadence: Sparkles,
} as const;

export function SuggestionsPanel({
  suggestions,
  canHarvest,
}: {
  suggestions: SuggestionRow[];
  canHarvest: boolean;
}) {
  const [pending, start] = useTransition();
  const [finding, startFind] = useTransition();

  function find() {
    startFind(async () => {
      const result = await discoverAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const data = result.data;
      if (data.note) {
        toast.warning(data.note);
        return;
      }
      toast.success(
        `${data.items} items from ${data.sources.join(", ") || "feeds"} — ${data.stories} stories`
      );
      window.location.reload();
    });
  }

  function pull() {
    start(async () => {
      const result = await harvestAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const data = result.data;
      if (data.note) {
        toast.warning(data.note);
        return;
      }
      toast.success(
        `${data.own} of your posts, ${data.mentions} mentions, ${data.rivals} competitor posts — ${data.stories} stories`
      );
      window.location.reload();
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-accent/25 bg-accent/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-sm font-medium text-primary">
            What to do next
          </h2>
          <p className="text-xs text-muted">
            Read from what&rsquo;s being written right now, your own posts, your
            mentions, and the competitors you track — not from a prompt.
          </p>
        </div>
        {canHarvest && (
          <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={find} disabled={finding}>
            {finding ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Globe className="h-4 w-4" aria-hidden />
            )}
            Find what&rsquo;s happening
          </Button>
          <Button variant="secondary" onClick={pull} disabled={pending}>
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-4 w-4" aria-hidden />
            )}
            Pull from X
          </Button>
          </div>
        )}
      </div>

      {suggestions.length === 0 ? (
        <p className="text-sm text-muted">
          Nothing to suggest yet. Connect X and sync, or press{" "}
          <strong className="font-medium text-primary">Pull from X</strong> —
          suggestions come from what you&rsquo;ve published, who replied, and
          what your competitors are doing.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {suggestions.map((suggestion, index) => {
            const Icon = ICON[suggestion.kind];
            return (
              <li key={`${suggestion.kind}-${index}`}>
                <Link
                  href={
                    suggestion.prompt
                      ? `${suggestion.href}?prompt=${encodeURIComponent(suggestion.prompt)}`
                      : suggestion.href
                  }
                  className="group flex items-start gap-3 rounded-md border border-border bg-surface p-3 transition-colors hover:border-accent/40"
                >
                  <Icon
                    className={cn(
                      "mt-0.5 h-4 w-4 shrink-0",
                      suggestion.urgency >= 70 ? "text-danger" : "text-accent"
                    )}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-primary">{suggestion.title}</p>
                    {/* Same size as the instruction, deliberately. */}
                    <p className="text-xs text-secondary">{suggestion.why}</p>
                  </div>
                  <ArrowRight
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted transition-colors group-hover:text-accent"
                    aria-hidden
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
