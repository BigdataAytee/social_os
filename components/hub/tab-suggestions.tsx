"use client";

import { useState, useTransition } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";

import {
  dismissSuggestionAction,
  refreshSuggestionsAction,
  applySuggestionAction,
} from "@/app/actions/xhub";
import { Button } from "@/components/ui/button";

/**
 * Three things to post, at the top of every tab.
 *
 * The answer to "not me only adding post". Each card is a proposal with an
 * accept button that writes the draft — the hub finishing a thought rather than
 * handing over a blank box.
 *
 * `why` is rendered at full size next to the title, not tucked under it. The
 * three grounding levels — your corpus, your measured voice, or a cold start —
 * mean genuinely different things, and a card that looks equally confident in
 * all three teaches people to trust none of them.
 */

export type TabSuggestionRow = {
  id: string;
  title: string;
  body: string;
  why: string;
  cta: string;
};

export function TabSuggestions({
  suggestions,
  canGenerate,
}: {
  suggestions: TabSuggestionRow[];
  canGenerate: boolean;
}) {
  const [rows, setRows] = useState(suggestions);
  const [output, setOutput] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const [refreshing, startRefresh] = useTransition();

  function apply(row: TabSuggestionRow) {
    start(async () => {
      const result = await applySuggestionAction({
        id: row.id,
        title: row.title,
        body: row.body,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setOutput((current) => ({ ...current, [row.id]: result.data.output }));
      toast.success("Draft created — it's in the X Studio queue");
    });
  }

  function dismiss(id: string) {
    // Removed locally first: the row is gone from the user's point of view the
    // moment they press it, and waiting on a round trip to hide something they
    // rejected reads as the button not working.
    setRows((current) => current.filter((row) => row.id !== id));
    start(async () => {
      const result = await dismissSuggestionAction({ id });
      if (!result.ok) toast.error(result.error);
    });
  }

  function refresh() {
    startRefresh(async () => {
      const result = await refreshSuggestionsAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${result.data.suggestions} new suggestions`);
      window.location.reload();
    });
  }

  if (rows.length === 0) {
    return canGenerate ? (
      <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-dashed border-border p-4">
        <p className="text-xs text-muted">
          No suggestions on this tab yet.
        </p>
        <Button variant="secondary" onClick={refresh} disabled={refreshing}>
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="h-4 w-4" aria-hidden />
          )}
          Suggest something
        </Button>
      </div>
    ) : null;
  }

  return (
    <section className="mb-5 flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden />
          <h3 className="font-display text-sm font-medium text-primary">
            Suggested for you
          </h3>
        </div>
        {canGenerate && (
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="font-mono text-[10px] uppercase tracking-wider text-muted transition-colors hover:text-accent"
          >
            {refreshing ? "thinking…" : "new ideas"}
          </button>
        )}
      </div>

      {/* The grounding, said once for the batch rather than on every card. */}
      {rows[0]?.why && (
        <p className="text-xs text-muted">{rows[0].why}</p>
      )}

      <div className="grid gap-2 md:grid-cols-3">
        {rows.map((row) => (
          <article
            key={row.id}
            className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3"
          >
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 text-sm font-medium text-primary">
                {row.title}
              </p>
              <button
                type="button"
                onClick={() => dismiss(row.id)}
                aria-label="Dismiss"
                className="shrink-0 text-muted transition-colors hover:text-danger"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>

            <p className="flex-1 text-xs leading-snug text-secondary">
              {row.body}
            </p>

            {output[row.id] ? (
              <div className="rounded-md border border-accent/30 bg-accent/5 p-2">
                <p className="whitespace-pre-wrap text-xs text-primary">
                  {output[row.id]}
                </p>
                <p className="mt-1 text-[10px] text-muted">
                  Saved as a draft. Edit it before it goes out.
                </p>
              </div>
            ) : (
              canGenerate && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => apply(row)}
                  className="self-start"
                >
                  {pending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {row.cta}
                </Button>
              )
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
