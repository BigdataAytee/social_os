"use client";

import { useState, useTransition } from "react";
import type { Platform } from "@prisma/client";
import { Loader2, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { generateAction } from "@/app/actions/ai";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { GenerationType } from "@/lib/validators/ai";
import { CHARACTER_LIMITS } from "@/lib/validators/platform-data";
import { cn } from "@/lib/utils";

/**
 * The shared AI surface (ARCHITECTURE.md §8) — built once, reused by all five
 * Studios. Each Studio passes the feature list it supports; a "feature" is a
 * `type` string plus a label, not a separate component or endpoint (§9).
 */

export type GenerateFeature = {
  type: GenerationType;
  label: string;
  placeholder: string;
};

export function AIGenerateBox({
  studio,
  features,
  onUse,
  modelConfigured,
}: {
  studio: Platform;
  features: GenerateFeature[];
  /** Hand the result to the composer. */
  onUse: (text: string) => void;
  modelConfigured: boolean;
}) {
  const [type, setType] = useState<GenerationType>(features[0].type);
  const [input, setInput] = useState("");
  const [output, setOutput] = useState<string | null>(null);
  const [source, setSource] = useState<"anthropic" | "local" | null>(null);
  const [pending, startTransition] = useTransition();

  const feature = features.find((f) => f.type === type) ?? features[0];

  // Multi-part results (threads, five hooks, six titles) are meant to exceed a
  // single post's limit, so only flag the formats that aren't.
  const singlePost = !MULTI_PART.has(type);
  const limit = CHARACTER_LIMITS[studio];
  const overLimit = singlePost && output !== null && output.length > limit;

  function generate() {
    if (!input.trim()) {
      toast.error("Give the assistant something to work with");
      return;
    }
    startTransition(async () => {
      const result = await generateAction({ studio, type, input });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setOutput(result.data.output);
      setSource(result.data.source);
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-accent" />
        <h3 className="font-display text-sm font-medium text-primary">
          Generate
        </h3>
        {!modelConfigured && (
          <span className="ml-auto rounded-sm border border-warning/30 bg-warning/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-warning">
            No API key
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="feature">Feature</Label>
        <Select value={type} onValueChange={(v) => setType(v as GenerationType)}>
          <SelectTrigger id="feature">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {features.map((f) => (
              <SelectItem key={f.type} value={f.type}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="ai-input">What&rsquo;s it about?</Label>
        <Textarea
          id="ai-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={feature.placeholder}
          rows={3}
        />
      </div>

      <Button onClick={generate} disabled={pending} className="self-start">
        {pending ? <Loader2 className="animate-spin" /> : <Wand2 />}
        {pending ? "Writing…" : `Generate ${feature.label.toLowerCase()}`}
      </Button>

      {output !== null && (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-surface-raised p-4 animate-fade-in">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
              Result
            </span>
            {singlePost && (
              <span
                className={cn(
                  "font-mono text-[10px] tabular",
                  overLimit ? "text-danger" : "text-muted"
                )}
              >
                {output.length}/{limit}
              </span>
            )}
            <span
              className={cn(
                "rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider",
                source === "anthropic"
                  ? "border-accent/30 bg-accent/10 text-accent"
                  : "border-border bg-surface text-muted"
              )}
            >
              {source === "anthropic" ? "Claude" : "Local draft"}
            </span>
          </div>

          <p className="whitespace-pre-wrap text-sm leading-relaxed text-secondary">
            {output}
          </p>

          <div className="flex gap-2">
            <Button size="sm" onClick={() => onUse(output)}>
              Use this
            </Button>
            <Button size="sm" variant="ghost" onClick={generate} disabled={pending}>
              Regenerate
            </Button>
          </div>

          {overLimit && (
            <p className="text-xs text-danger">
              This is {output.length - limit} characters over the {studio}{" "}
              limit. Trim it in the composer before saving.
            </p>
          )}

          {source === "local" && (
            <p className="text-xs text-muted">
              Written by the offline fallback, not a model — set{" "}
              <code className="font-mono text-[11px] text-secondary">
                ANTHROPIC_API_KEY
              </code>{" "}
              to generate with Claude.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Kept in step with MULTI_PART_TYPES in the orchestrator. */
const MULTI_PART = new Set<GenerationType>([
  "thread",
  "hook",
  "idea",
  "title",
  "thumbnail",
  "script",
  "repurpose",
  "chat",
]);
