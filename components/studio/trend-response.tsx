"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Platform } from "@prisma/client";
import { Check, Loader2, Radar, Zap } from "lucide-react";
import { toast } from "sonner";

import {
  acceptTrendDraftAction,
  detectTrendsAction,
  respondToTrendAction,
} from "@/app/actions/trends";
import { PlatformDot } from "@/components/content/platform-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { TrendDraft } from "@/modules/trends/pipeline";

/**
 * The five-draft Trend Response review screen (Platform-Native-Studios.md §2.4).
 *
 * Reuses the assistant's repurpose review pattern rather than inventing a second
 * one: generate, show everything, accept individually, nothing saved until you
 * say so. That's the guarantee — the pipeline auto-drafts, it never
 * auto-publishes.
 */

export type TrendEventRow = {
  id: string;
  topic: string;
  summary: string;
  velocity: string;
  depth: string;
  responses: number;
};

export function TrendResponsePanel({
  platform,
  events,
  canGenerate,
}: {
  platform: Platform;
  events: TrendEventRow[];
  canGenerate: boolean;
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<TrendDraft[] | null>(null);
  const [topic, setTopic] = useState("");
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  function detect() {
    startTransition(async () => {
      const result = await detectTrendsAction({ platform });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${result.data.length} trends tracked`);
      router.refresh();
    });
  }

  function respond(event: TrendEventRow) {
    startTransition(async () => {
      const result = await respondToTrendAction({ trendEventId: event.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setDrafts(result.data.drafts);
      setTopic(result.data.topic);
      setEdited({});
      setAccepted(new Set());
    });
  }

  function accept(draft: TrendDraft) {
    startTransition(async () => {
      const result = await acceptTrendDraftAction({
        responseId: draft.responseId,
        platform: draft.platform,
        body: edited[draft.responseId] ?? draft.body,
        platformData: draft.platformData,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setAccepted((current) => new Set(current).add(draft.responseId));
      toast.success(`Saved a ${draft.platform} draft`);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-col">
          <h3 className="font-display text-sm font-medium text-primary">
            Trend response
          </h3>
          <p className="text-xs text-muted">
            One trend, drafted five ways — each in that platform&rsquo;s own
            native shape. Nothing is saved until you accept it.
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          className="ml-auto"
          disabled={!canGenerate || pending}
          onClick={detect}
        >
          {pending ? <Loader2 className="animate-spin" /> : <Radar />}
          Track trends
        </Button>
      </div>

      {events.length === 0 ? (
        <p className="rounded-md border border-border bg-surface px-3 py-2.5 text-xs text-muted">
          No trends tracked yet. Press Track trends to pull the current feed.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {events.map((event) => (
            <div
              key={event.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-3 py-2.5"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-primary">
                  {event.topic}
                </span>
                <span className="block truncate text-[11px] text-muted">
                  {event.summary}
                </span>
              </span>
              <Badge variant={event.velocity === "breaking" ? "danger" : "accent"}>
                {event.velocity}
              </Badge>
              <Badge>{event.depth}</Badge>
              <Button
                size="sm"
                disabled={!canGenerate || pending}
                onClick={() => respond(event)}
              >
                <Zap />
                Draft all five
              </Button>
            </div>
          ))}
        </div>
      )}

      {drafts && (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <h4 className="font-mono text-[10px] uppercase tracking-wider text-muted">
            Five drafts for &ldquo;{topic}&rdquo; — review before saving
          </h4>
          {drafts.map((draft) => {
            const isAccepted = accepted.has(draft.responseId);
            return (
              <div
                key={draft.responseId}
                className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3"
              >
                <div className="flex items-center gap-2">
                  <PlatformDot platform={draft.platform} />
                  <span className="text-sm text-primary">{draft.platform}</span>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
                    {String(draft.platformData.kind ?? "")}
                  </span>
                  {draft.source === "local" && (
                    <span className="rounded-sm border border-warning/30 bg-warning/10 px-1.5 font-mono text-[10px] uppercase tracking-wider text-warning">
                      Local draft
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant={isAccepted ? "ghost" : "default"}
                    className="ml-auto"
                    disabled={pending || isAccepted}
                    onClick={() => accept(draft)}
                  >
                    <Check />
                    {isAccepted ? "Saved" : "Save as draft"}
                  </Button>
                </div>
                <Textarea
                  value={edited[draft.responseId] ?? draft.body}
                  onChange={(event) =>
                    setEdited((current) => ({
                      ...current,
                      [draft.responseId]: event.target.value,
                    }))
                  }
                  rows={6}
                  disabled={isAccepted}
                  className="text-xs"
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
