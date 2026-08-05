"use client";

import { useState, useTransition } from "react";
import type { Platform } from "@prisma/client";
import {
  ArrowUpRight,
  Clock,
  Hash,
  Loader2,
  Plus,
  Ruler,
  Shapes,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import {
  generateAccountIdeasAction,
  saveGeneratedIdeaAction,
} from "@/app/actions/integrations";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { AccountInsights } from "@/modules/insights/service";

/**
 * "Analyze my account" — the patterns behind the ideas, and the ideas.
 *
 * The patterns are shown, not just fed to the model, because the person has to
 * be able to disagree with them. An idea whose rationale is invisible is
 * indistinguishable from a guess, and this feature's whole claim is that it
 * isn't guessing.
 */

export function InsightsPanel({
  platform,
  connected,
  canGenerate,
  canWriteIdeas,
}: {
  platform: Platform;
  connected: boolean;
  canGenerate: boolean;
  canWriteIdeas: boolean;
}) {
  const [result, setResult] = useState<{
    ideas: string[];
    insights: AccountInsights;
    source: string;
  } | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  function analyze() {
    startTransition(async () => {
      const response = await generateAccountIdeasAction({ platform });
      if (!response.ok) {
        toast.error(response.error);
        return;
      }
      setResult(response.data);
      setSaved(new Set());

      if (response.data.insights.sampleSize === 0) {
        toast.message("Nothing to analyse yet — sync the account first.");
      } else if (response.data.insights.thin) {
        toast.message(
          `Only ${response.data.insights.sampleSize} posts pulled — too few for a reliable pattern.`
        );
      }
    });
  }

  function save(idea: string) {
    startTransition(async () => {
      const response = await saveGeneratedIdeaAction({
        platform,
        content: idea,
      });
      if (!response.ok) {
        toast.error(response.error);
        return;
      }
      setSaved((prev) => new Set(prev).add(idea));
      toast.success("Saved to ideas");
    });
  }

  if (!connected) {
    return (
      <EmptyState
        icon={Sparkles}
        title="Connect this account to analyse it"
        description="Once connected, SocialOS pulls your recent posts and their engagement, works out which formats, times and topics actually perform, and writes ideas from that rather than from a blank page."
      />
    );
  }

  const insights = result?.insights;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-col">
          <h3 className="font-display text-sm font-medium text-primary">
            Ideas from your own performance
          </h3>
          <p className="text-xs text-muted">
            Analyses the last 90 days of pulled posts, then writes ideas grounded
            in what worked.
          </p>
        </div>
        <Button
          size="sm"
          className="ml-auto"
          disabled={!canGenerate || pending}
          onClick={analyze}
        >
          {pending ? <Loader2 className="animate-spin" /> : <Sparkles />}
          Analyze my account
        </Button>
      </div>

      {!canGenerate && (
        <p className="text-xs text-muted">
          Your role is read-only, so the assistant can&rsquo;t run this analysis.
        </p>
      )}

      {insights && insights.sampleSize === 0 && (
        <EmptyState
          icon={Sparkles}
          title="No posts pulled yet"
          description="Press Sync on the account above to fetch recent posts and their engagement, then analyse again."
        />
      )}

      {insights && insights.sampleSize > 0 && (
        <>
          <div className="flex flex-wrap gap-2 text-xs text-muted">
            <span>
              {insights.sampleSize} posts · last {insights.windowDays} days
            </span>
            <span>
              avg engagement {insights.averageEngagementRate.toFixed(2)}%
            </span>
            {insights.followerGrowth && (
              <span>
                followers {insights.followerGrowth.percent >= 0 ? "+" : ""}
                {insights.followerGrowth.percent.toFixed(1)}%
              </span>
            )}
            {result?.source === "local" && (
              <span className="rounded-sm border border-warning/30 bg-warning/10 px-1.5 font-mono text-[10px] uppercase tracking-wider text-warning">
                Local draft
              </span>
            )}
          </div>

          {insights.thin ? (
            <p className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-secondary">
              Too few posts to draw a pattern from. SocialOS needs at least a
              handful in each bucket before it will claim a format or a time
              beats another — the numbers below would be noise.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <PatternCard
                icon={Shapes}
                title="Formats"
                rows={insights.formats.map((f) => ({
                  label: f.mediaType,
                  value: `${f.averageEngagementRate.toFixed(2)}%`,
                  note: `${f.liftVsAverage >= 0 ? "+" : ""}${f.liftVsAverage.toFixed(0)}% · ${f.posts} posts`,
                }))}
              />
              <PatternCard
                icon={Clock}
                title="Best slots (UTC)"
                rows={insights.timing.map((t) => ({
                  label: `${t.dayName} ${String(t.hour).padStart(2, "0")}:00`,
                  value: `${t.averageEngagementRate.toFixed(2)}%`,
                  note: `${t.posts} posts`,
                }))}
              />
              <PatternCard
                icon={Ruler}
                title="Length"
                rows={insights.lengths.map((l) => ({
                  label: l.label,
                  value: `${l.averageEngagementRate.toFixed(2)}%`,
                  note: `${l.posts} posts`,
                }))}
              />
              <PatternCard
                icon={Hash}
                title="Topics that outperform"
                rows={insights.topics.map((t) => ({
                  label: t.term,
                  value: `${t.averageEngagementRate.toFixed(2)}%`,
                  note: `${t.liftVsAverage >= 0 ? "+" : ""}${t.liftVsAverage.toFixed(0)}% · ${t.posts} posts`,
                }))}
              />
            </div>
          )}

          {insights.topPosts.length > 0 && (
            <div className="flex flex-col gap-2">
              <h4 className="font-mono text-[10px] uppercase tracking-wider text-muted">
                Top posts
              </h4>
              {insights.topPosts.map((post) => (
                <div
                  key={post.externalId}
                  className="flex flex-col gap-1 rounded-md border border-border bg-surface px-3 py-2.5"
                >
                  <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted">
                    {post.mediaType}
                    <span className="text-accent">
                      {post.engagementRate.toFixed(2)}%
                    </span>
                    <span>
                      {post.likes.toLocaleString()} likes ·{" "}
                      {post.comments.toLocaleString()} comments
                    </span>
                    {post.permalink && (
                      <a
                        href={post.permalink}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-auto flex items-center gap-0.5 text-secondary hover:text-primary"
                      >
                        Open <ArrowUpRight className="h-3 w-3" />
                      </a>
                    )}
                  </span>
                  <p className="line-clamp-2 text-xs text-secondary">
                    {post.text}
                  </p>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {result && result.ideas.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="font-mono text-[10px] uppercase tracking-wider text-muted">
            Generated ideas
          </h4>
          {result.ideas.map((idea) => (
            <div
              key={idea}
              className="flex items-start gap-3 rounded-md border border-border bg-surface px-3 py-2.5"
            >
              <p className="min-w-0 flex-1 text-sm text-secondary">{idea}</p>
              <Button
                size="sm"
                variant="ghost"
                disabled={!canWriteIdeas || pending || saved.has(idea)}
                onClick={() => save(idea)}
              >
                <Plus />
                {saved.has(idea) ? "Saved" : "Save"}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PatternCard({
  icon: Icon,
  title,
  rows,
}: {
  icon: typeof Clock;
  title: string;
  rows: { label: string; value: string; note: string }[];
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface px-3 py-2.5">
      <h4 className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted">
        <Icon className="h-3 w-3" />
        {title}
      </h4>
      {rows.length === 0 ? (
        // Named rather than left blank: an empty card reads as a bug, and the
        // reason is meaningful — this bucket never reached the minimum sample.
        <p className="text-xs text-muted">Not enough posts to say.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((row) => (
            <li
              key={row.label}
              className="flex items-baseline gap-2 text-xs"
            >
              <span className="min-w-0 flex-1 truncate text-secondary">
                {row.label}
              </span>
              <span className="font-mono tabular text-primary">{row.value}</span>
              <span className="font-mono text-[10px] text-muted">{row.note}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
