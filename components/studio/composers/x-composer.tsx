"use client";

import { useState } from "react";
import { Platform } from "@prisma/client";
import { ArrowDown, ArrowUp, Plus, Quote, X as XIcon } from "lucide-react";

import { ComposerShell } from "./shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CHARACTER_LIMITS } from "@/lib/validators/platform-data";
import { cn } from "@/lib/utils";

/**
 * X composer: a stack of tweet cards, not one textarea
 * (Platform-Native-Studios.md §1).
 *
 * The per-card counter is the point. One textarea with a 280 limit can't
 * represent a thread at all, and a 280 limit across a whole thread is wrong in
 * the other direction — each tweet is its own unit and has to be judged as one.
 */

const LIMIT = CHARACTER_LIMITS[Platform.X];

export function XComposer({
  seed,
  campaigns,
  canSchedule,
  onConsumed,
}: {
  /** Text handed over from the AI generate box. */
  seed: string;
  campaigns: { id: string; name: string }[];
  canSchedule: boolean;
  onConsumed: () => void;
}) {
  const [tweets, setTweets] = useState<string[]>([""]);
  const [quoteOf, setQuoteOf] = useState("");
  const [seedApplied, setSeedApplied] = useState("");

  // A generated draft arrives as text; a blank line is how models separate
  // thread posts, so splitting on it lands each one in its own card.
  if (seed && seed !== seedApplied) {
    setSeedApplied(seed);
    const parts = seed
      .split(/\n\s*\n/)
      .map((part) => part.replace(/^\s*\d+[.)/]\s*/, "").trim())
      .filter(Boolean);
    setTweets(parts.length > 0 ? parts : [seed]);
  }

  const isThread = tweets.length > 1;

  function update(index: number, value: string) {
    setTweets((current) => current.map((t, i) => (i === index ? value : t)));
  }
  function move(index: number, delta: number) {
    setTweets((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  return (
    <ComposerShell
      platform={Platform.X}
      campaigns={campaigns}
      canSchedule={canSchedule}
      title={isThread ? "Thread" : "Post"}
      onSaved={() => {
        setTweets([""]);
        setQuoteOf("");
        onConsumed();
      }}
      build={() => {
        const filled = tweets.map((t) => t.trim()).filter(Boolean);
        if (filled.length === 0) return "Write something first";
        const over = filled.findIndex((t) => t.length > LIMIT);
        if (over >= 0) {
          return `Tweet ${over + 1} is ${filled[over]!.length - LIMIT} characters over`;
        }
        return {
          // Numbered when it's a thread, because that's how it publishes and
          // how it should read in the queue and on the calendar.
          body: filled
            .map((t, i) => (filled.length > 1 ? `${i + 1}/ ${t}` : t))
            .join("\n\n"),
          platformData: {
            kind: filled.length > 1 ? "thread" : "tweet",
            tweets: filled,
            quoteOf: quoteOf.trim() || null,
            mediaCard: { type: "none", assetId: null },
            characters: filled.reduce((sum, t) => sum + t.length, 0),
          },
        };
      }}
    >
      <div className="flex flex-col gap-2">
        {tweets.map((tweet, index) => {
          const over = tweet.length > LIMIT;
          return (
            <div
              key={index}
              className={cn(
                "flex flex-col gap-1.5 rounded-md border bg-surface-raised p-3",
                over ? "border-danger" : "border-border"
              )}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
                  {isThread ? `Tweet ${index + 1}` : "Tweet"}
                </span>
                <span
                  className={cn(
                    "ml-auto font-mono text-[11px] tabular",
                    over
                      ? "text-danger"
                      : tweet.length > LIMIT * 0.9
                        ? "text-warning"
                        : "text-muted"
                  )}
                >
                  {tweet.length}/{LIMIT}
                </span>
                {isThread && (
                  <>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Move up"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Move down"
                      disabled={index === tweets.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Remove"
                      onClick={() =>
                        setTweets((c) => c.filter((_, i) => i !== index))
                      }
                    >
                      <XIcon />
                    </Button>
                  </>
                )}
              </div>
              <Textarea
                value={tweet}
                onChange={(event) => update(index, event.target.value)}
                rows={index === 0 ? 4 : 3}
                placeholder={
                  index === 0
                    ? "The hook. It has to stop the scroll — no throat-clearing."
                    : "One idea per tweet."
                }
              />
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setTweets((current) => [...current, ""])}
        >
          <Plus />
          Add tweet
        </Button>
        {isThread && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
            Hook → payoff → close
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="quote-of" className="flex items-center gap-1.5">
          <Quote className="h-3 w-3" />
          Quote-post target
        </Label>
        <Input
          id="quote-of"
          value={quoteOf}
          onChange={(event) => setQuoteOf(event.target.value)}
          placeholder="https://x.com/… — adds your take on top of something already moving"
        />
      </div>
    </ComposerShell>
  );
}
