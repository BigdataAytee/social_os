"use client";

import { useEffect, useState, useTransition } from "react";
import type { Platform } from "@prisma/client";
import { Gauge, Loader2 } from "lucide-react";

import { predictEngagementAction } from "@/app/actions/strategy";
import { bandLabel, type Prediction } from "@/modules/strategy/predict";
import { cn } from "@/lib/utils";

/**
 * The inline engagement-prediction badge (Growth-Strategist-Engine.md §3, §6).
 *
 * A band and its reasoning, never a percentage. The account's history is a few
 * dozen posts — enough to support "this looks above average, and here's why",
 * nowhere near enough to support "7.4%". Quoting a number we can't stand behind
 * is the fastest way to make the whole feature untrustworthy.
 *
 * Debounced and manual-free: it scores the draft as it stands, but only after
 * typing settles, so a prediction isn't recomputed on every keystroke.
 */

const TONE: Record<string, string> = {
  "above-average": "border-success/40 bg-success/5 text-success",
  typical: "border-border bg-surface-raised text-secondary",
  "below-average": "border-warning/40 bg-warning/5 text-warning",
  "not-enough-data": "border-border bg-surface-raised text-muted",
};

export function PredictionBadge({
  platform,
  body,
  platformData,
  scheduledAt,
}: {
  platform: Platform;
  body: string;
  platformData: Record<string, unknown>;
  scheduledAt: string | null;
}) {
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [pending, startTransition] = useTransition();

  const signature = `${body}|${JSON.stringify(platformData)}|${scheduledAt ?? ""}`;

  useEffect(() => {
    if (body.trim().length < 20) {
      setPrediction(null);
      return;
    }
    const timer = setTimeout(() => {
      startTransition(async () => {
        const result = await predictEngagementAction({
          platform,
          body,
          platformData,
          scheduledAt,
        });
        // A prediction failing must never block composing — the badge just
        // stays quiet rather than throwing a toast at someone mid-sentence.
        if (result.ok) setPrediction(result.data);
      });
    }, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, platform]);

  if (!prediction && !pending) return null;

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-md border px-3 py-2.5",
        prediction ? TONE[prediction.band] : "border-border bg-surface-raised"
      )}
    >
      <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider">
        {pending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Gauge className="h-3 w-3" />
        )}
        {prediction ? bandLabel(prediction.band) : "Scoring this draft…"}
        {prediction && (
          <span className="text-muted">· {prediction.confidence} confidence</span>
        )}
      </span>

      {prediction && (
        <>
          <ul className="flex flex-col gap-0.5 text-xs text-secondary">
            {prediction.reasoning.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {prediction.suggestions.length > 0 && (
            <ul className="flex list-disc flex-col gap-0.5 pl-4 text-[11px] text-muted">
              {prediction.suggestions.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
