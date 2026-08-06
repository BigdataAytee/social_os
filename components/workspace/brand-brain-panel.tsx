"use client";

import { useState, useTransition } from "react";
import { Brain, Loader2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

import { rebuildBrandProfileAction, recallAction } from "@/app/actions/brain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Section } from "@/components/ui/section";
import type { BrandProfileShape } from "@/modules/brandbrain/service";

/**
 * Brand Brain (OS-ARCHITECTURE.md §11 stage 4).
 *
 * The point of showing this at all is that a measured profile is a *claim about
 * the user's own writing*, and a claim they can't inspect is one they can't
 * disagree with. Every number here is stated with the sample size it came from.
 *
 * When the profile is too thin the panel says so plainly instead of showing
 * zeros — zeros read as "your posts have no personality" rather than "we
 * haven't seen enough yet".
 */

const MIN_POSTS = 10;

type Recollection = {
  text: string;
  sourceType: string;
  score: number | null;
};

export function BrandBrainPanel({
  profile,
  memory,
  canEdit,
}: {
  profile: BrandProfileShape | null;
  memory: Record<string, number>;
  canEdit: boolean;
}) {
  const [pending, start] = useTransition();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Recollection[] | null>(null);
  const [searching, startSearch] = useTransition();

  const indexed = Object.values(memory).reduce((sum, n) => sum + n, 0);
  const learned = (profile?.basedOnPosts ?? 0) >= MIN_POSTS;

  function rebuild() {
    start(async () => {
      const result = await rebuildBrandProfileAction();
      toast[result.ok ? "success" : "error"](
        result.ok
          ? `Learned from ${result.data.basedOnPosts} posts, indexed ${result.data.chunks} chunks`
          : result.error
      );
    });
  }

  function search(event: React.FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    startSearch(async () => {
      const result = await recallAction({ query });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setHits(result.data);
    });
  }

  return (
    <Section
      title="Brand brain"
      description="What this account demonstrably sounds like, measured from its own posts — not what you told us above"
    >
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-primary">
            <Brain className="h-4 w-4 text-muted" aria-hidden />
            {learned ? (
              <span>
                Learned from{" "}
                <strong className="font-medium">{profile!.basedOnPosts}</strong>{" "}
                posts · {indexed} chunks searchable
              </span>
            ) : (
              <span className="text-muted">
                {profile?.basedOnPosts
                  ? `Only ${profile.basedOnPosts} posts so far — needs ${MIN_POSTS} before the numbers mean anything.`
                  : "Nothing learned yet. Connect an account and sync, or publish a few posts."}
              </span>
            )}
          </div>
          {canEdit && (
            <Button variant="secondary" onClick={rebuild} disabled={pending}>
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="h-4 w-4" aria-hidden />
              )}
              Relearn
            </Button>
          )}
        </div>

        {learned && profile && (
          <dl className="grid gap-4 sm:grid-cols-2">
            <Stat
              label="Typical post"
              value={`${Math.round(profile.sentenceStats.avgChars)} chars · ${Math.round(
                profile.sentenceStats.avgWords
              )} words per sentence`}
            />
            <Stat
              label="Emoji"
              value={
                profile.emojiRate < 0.2
                  ? "Effectively none"
                  : `${profile.emojiRate.toFixed(1)} per post`
              }
            />
            <Stat
              label="Questions"
              value={`${Math.round(profile.sentenceStats.questionRate * 100)}% of posts ask one`}
            />
            <Stat
              label="Formats that outperform"
              value={
                profile.winningFormats.length > 0
                  ? profile.winningFormats
                      .map((f) => `${f.kind} +${Math.round(f.lift)}%`)
                      .join(", ")
                  : "No format beats the rest by enough to call it"
              }
            />
            {profile.contentPillars.length > 0 && (
              <div className="sm:col-span-2">
                <Term>Pillars</Term>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {profile.contentPillars.map((pillar) => (
                    <span
                      key={pillar}
                      className="rounded-full border border-border px-2.5 py-0.5 text-xs text-primary"
                    >
                      {pillar}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {profile.vocabulary.length > 0 && (
              <div className="sm:col-span-2">
                <Term>Words you reach for</Term>
                <p className="mt-1.5 text-sm text-primary">
                  {profile.vocabulary
                    .slice(0, 14)
                    .map((v) => v.term)
                    .join(" · ")}
                </p>
              </div>
            )}
            {profile.hookPatterns.length > 0 && (
              <div className="sm:col-span-2">
                <Term>Openings that worked</Term>
                <ul className="mt-1.5 flex flex-col gap-1.5">
                  {profile.hookPatterns.slice(0, 4).map((hook) => (
                    <li
                      key={hook}
                      className="border-l-2 border-border pl-3 text-sm text-primary"
                    >
                      {hook}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </dl>
        )}

        <div className="border-t border-border pt-4">
          <Term>Search your history</Term>
          <form onSubmit={search} className="mt-2 flex gap-2">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="What have we said about pricing?"
              aria-label="Search your published history"
            />
            <Button type="submit" variant="secondary" disabled={searching}>
              {searching ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Search className="h-4 w-4" aria-hidden />
              )}
              Search
            </Button>
          </form>

          {hits !== null && (
            <div className="mt-3 flex flex-col gap-2">
              {hits.length === 0 ? (
                <p className="text-sm text-muted">
                  Nothing matched. The index covers published posts, synced
                  posts, generations and ideas.
                </p>
              ) : (
                hits.map((hit, index) => (
                  <div
                    key={`${hit.sourceType}-${index}`}
                    className="rounded-md border border-border bg-canvas p-3"
                  >
                    <div className="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted">
                      <span>{hit.sourceType}</span>
                      {hit.score !== null && hit.score > 0 && (
                        <span>{hit.score.toFixed(1)}% engagement</span>
                      )}
                    </div>
                    <p className="text-sm text-primary">{hit.text}</p>
                  </div>
                ))
              )}
            </div>
          )}
          <p className="mt-2 text-xs text-muted">
            This is the same retrieval the AI runs before every generation — what
            you see here is what it sees.
          </p>
        </div>
      </div>
    </Section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Term>{label}</Term>
      <dd className="mt-1 text-sm text-primary">{value}</dd>
    </div>
  );
}

function Term({ children }: { children: React.ReactNode }) {
  return (
    <dt className="font-mono text-[10px] uppercase tracking-wider text-muted">
      {children}
    </dt>
  );
}
