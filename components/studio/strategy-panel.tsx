"use client";

import { useState, useTransition } from "react";
import type { Platform } from "@prisma/client";
import { Compass, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { recomputeStrategyAction } from "@/app/actions/strategy";
import { Button } from "@/components/ui/button";

/**
 * The Studio's Growth Briefing panel (Growth-Strategist-Engine.md §6).
 *
 * "Based on data through <date>" is not decoration: §2 requires every
 * recommendation to carry the timestamp of the freshest data it used, so the UI
 * never implies real-time omniscience about an account synced last Tuesday.
 */
export function StrategyPanel({
  platform,
  briefing,
  basedOnDataThrough,
  confidence,
  canGenerate,
}: {
  platform: Platform;
  briefing: string | null;
  basedOnDataThrough: string | null;
  confidence: string | null;
  canGenerate: boolean;
}) {
  const [text, setText] = useState(briefing);
  const [pending, startTransition] = useTransition();

  function recompute() {
    startTransition(async () => {
      const result = await recomputeStrategyAction({ platform });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setText(result.data.briefing);
      toast.success("Briefing refreshed");
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Compass className="h-4 w-4 text-secondary" />
        <h3 className="font-display text-sm font-medium text-primary">
          Growth briefing
        </h3>
        {confidence && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
            {confidence} confidence
          </span>
        )}
        <Button
          size="sm"
          variant="secondary"
          className="ml-auto"
          disabled={!canGenerate || pending}
          onClick={recompute}
        >
          {pending ? <Loader2 className="animate-spin" /> : <Compass />}
          {text ? "Refresh" : "Generate"}
        </Button>
      </div>

      {text ? (
        <>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-secondary">
            {text}
          </p>
          {basedOnDataThrough && (
            <p className="font-mono text-[10px] text-muted">
              Based on data through{" "}
              {new Date(basedOnDataThrough).toLocaleDateString()}
            </p>
          )}
        </>
      ) : (
        <p className="text-xs text-muted">
          A weekly plan drawn from this account&rsquo;s own best times and
          content-type performance, plus whatever is trending. Falls back to
          general best practice — and says so — until there&rsquo;s enough
          history to be specific.
        </p>
      )}
    </div>
  );
}
