"use client";

import { useState, useTransition } from "react";
import { Platform } from "@prisma/client";
import { AlertTriangle, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  addCompetitorAction,
  removeCompetitorAction,
  syncCompetitorsAction,
} from "@/app/actions/listening";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Section } from "@/components/ui/section";
import { studioForPlatform } from "@/lib/studios";

/**
 * Competitor tracking and the comparison it exists for
 * (OS-ARCHITECTURE.md §11 stage 6).
 *
 * Every number is stated against the org's own, and the sample sizes are on
 * screen. A benchmark computed from four posts is a coin flip dressed as
 * insight, so when either side is thin the comparison is withheld and the
 * counts are shown instead.
 */

type CompetitorRow = {
  id: string;
  platform: Platform;
  handle: string;
  displayName: string | null;
  posts: number;
  cadence: number;
  engagementRate: number;
  lastSyncAt: string | null;
  lastSyncError: string | null;
};

type Benchmark = {
  platform: Platform;
  ours: number;
  theirs: number;
  ourCadence: number;
  theirCadence: number;
  theirBestFormat: { kind: string; lift: number } | null;
  ourSample: number;
  theirSample: number;
  thin: boolean;
};

type Gap = { term: string; theirPosts: number; theirRate: number };

export function CompetitorPanel({
  competitors,
  gaps,
  benchmark,
  canManage,
}: {
  competitors: CompetitorRow[];
  gaps: Gap[];
  benchmark: Benchmark;
  canManage: boolean;
}) {
  const [handle, setHandle] = useState("");
  const [platform, setPlatform] = useState<Platform>(Platform.X);
  const [pending, start] = useTransition();

  function add(event: React.FormEvent) {
    event.preventDefault();
    const value = handle.trim();
    if (!value) return;
    start(async () => {
      const result = await addCompetitorAction({ platform, handle: value });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setHandle("");
      if (result.data.note) toast.warning(result.data.note);
      else toast.success(`Tracking @${value} — ${result.data.posts} posts pulled`);
    });
  }

  function syncAll() {
    start(async () => {
      const result = await syncCompetitorsAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `${result.data.posts} posts, ${result.data.matched} monitor matches`
      );
      for (const note of result.data.notes) toast.warning(note);
    });
  }

  return (
    <Section
      title="Competitors"
      description="Who you're tracking, how they perform against you, and what they cover that you don't"
      action={
        canManage && competitors.length > 0 ? (
          <Button variant="ghost" onClick={syncAll} disabled={pending}>
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-4 w-4" aria-hidden />
            )}
            Sync all
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
        {canManage && (
          <form onSubmit={add} className="flex flex-wrap gap-2">
            <select
              value={platform}
              onChange={(event) => setPlatform(event.target.value as Platform)}
              aria-label="Platform"
              className="rounded-md border border-border bg-surface px-3 text-sm text-primary"
            >
              {Object.values(Platform).map((value) => (
                <option key={value} value={value}>
                  {studioForPlatform(value).label}
                </option>
              ))}
            </select>
            <Input
              value={handle}
              onChange={(event) => setHandle(event.target.value)}
              placeholder="their handle"
              aria-label="Competitor handle"
              className="min-w-[10rem] flex-1"
            />
            <Button type="submit" disabled={pending || !handle.trim()}>
              <Plus className="h-4 w-4" aria-hidden />
              Track
            </Button>
          </form>
        )}

        {competitors.length === 0 ? (
          <p className="text-sm text-muted">
            Nobody tracked yet. Add a rival&rsquo;s handle to compare posting
            cadence, formats and engagement against your own.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {competitors.map((competitor) => (
              <li
                key={competitor.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-canvas p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-primary">
                    @{competitor.handle}
                    <span className="ml-2 font-normal text-muted">
                      {studioForPlatform(competitor.platform).label}
                    </span>
                  </p>
                  {competitor.lastSyncError ? (
                    <p className="mt-0.5 flex items-start gap-1 text-xs text-warning">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                      {competitor.lastSyncError}
                    </p>
                  ) : (
                    <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted">
                      {competitor.posts} posts · {competitor.cadence.toFixed(1)}/week
                      · {competitor.engagementRate.toFixed(1)}% engagement
                    </p>
                  )}
                </div>
                {canManage && (
                  <button
                    type="button"
                    aria-label={`Stop tracking ${competitor.handle}`}
                    onClick={() =>
                      start(async () => {
                        const result = await removeCompetitorAction({
                          id: competitor.id,
                        });
                        if (!result.ok) toast.error(result.error);
                      })
                    }
                    className="text-muted transition-colors hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {competitors.length > 0 && (
          <div className="border-t border-border pt-4">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted">
              You vs them on {studioForPlatform(benchmark.platform).label}
            </p>
            {benchmark.thin ? (
              <p className="mt-1.5 text-sm text-muted">
                Not enough to compare yet — {benchmark.ourSample} posts of yours,{" "}
                {benchmark.theirSample} of theirs. Five each is the floor.
              </p>
            ) : (
              <dl className="mt-2 grid gap-3 sm:grid-cols-3">
                <Stat
                  label="Engagement rate"
                  value={`${benchmark.ours.toFixed(1)}% vs ${benchmark.theirs.toFixed(1)}%`}
                  tone={benchmark.ours >= benchmark.theirs ? "good" : "bad"}
                />
                <Stat
                  label="Posts per week"
                  value={`${benchmark.ourCadence.toFixed(1)} vs ${benchmark.theirCadence.toFixed(1)}`}
                />
                <Stat
                  label="Their best format"
                  value={
                    benchmark.theirBestFormat
                      ? `${benchmark.theirBestFormat.kind} +${Math.round(
                          benchmark.theirBestFormat.lift
                        )}%`
                      : "No clear winner"
                  }
                />
              </dl>
            )}
          </div>
        )}

        {gaps.length > 0 && (
          <div className="border-t border-border pt-4">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted">
              Subjects they cover and you don&rsquo;t
            </p>
            <p className="mt-1 text-xs text-muted">
              Only subjects that outperformed their own average — a topic they
              post about to no response isn&rsquo;t an opportunity.
            </p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {gaps.map((gap) => (
                <li
                  key={gap.term}
                  className="rounded-full border border-border px-2.5 py-0.5 text-xs text-primary"
                  title={`${gap.theirPosts} posts, ${gap.theirRate.toFixed(1)}% engagement`}
                >
                  {gap.term}
                  <span className="ml-1.5 text-muted">
                    {gap.theirRate.toFixed(1)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad";
}) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-wider text-muted">
        {label}
      </dt>
      <dd
        className={
          tone === "good"
            ? "mt-0.5 text-sm text-success"
            : tone === "bad"
              ? "mt-0.5 text-sm text-warning"
              : "mt-0.5 text-sm text-primary"
        }
      >
        {value}
      </dd>
    </div>
  );
}
