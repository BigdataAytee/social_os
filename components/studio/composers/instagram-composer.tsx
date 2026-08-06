"use client";

import { useState } from "react";
import { Platform } from "@prisma/client";
import { ArrowLeft, ArrowRight, Plus, X as XIcon } from "lucide-react";

import { ComposerShell } from "./shell";
import { TikTokComposer } from "./tiktok-composer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/**
 * Instagram composer: a slide-deck grid for carousels, with Reels delegating to
 * the TikTok script shape (Platform-Native-Studios.md §1).
 *
 * The cover hook is its own field, above the deck, because it does different
 * work from every other slide — it decides whether anyone swipes at all, and
 * burying it as "slide 1" in a list treats it like a peer of the rest.
 */

type Slide = { headline: string; body: string; template: string };

const TEMPLATES = ["list-item", "stat", "quote", "step", "close"] as const;

const DEFAULT_SLIDES: Slide[] = [
  { headline: "", body: "", template: "list-item" },
  { headline: "", body: "", template: "list-item" },
  { headline: "", body: "", template: "close" },
];

export function InstagramComposer({
  seed,
  campaigns,
  canSchedule,
  onConsumed,
}: {
  seed: string;
  campaigns: { id: string; name: string }[];
  canSchedule: boolean;
  onConsumed: () => void;
}) {
  const [format, setFormat] = useState<"carousel" | "reel">("carousel");
  const [coverHook, setCoverHook] = useState("");
  const [slides, setSlides] = useState<Slide[]>(DEFAULT_SLIDES);
  const [seedApplied, setSeedApplied] = useState("");

  // Reels are a different native shape, not a variant of the deck — §1 says
  // they reuse TikTok's script wholesale, so that's what renders.
  if (format === "reel") {
    return (
      <div className="flex flex-col gap-3">
        <FormatSwitch format={format} onChange={setFormat} />
        <TikTokComposer
          seed={seed}
          campaigns={campaigns}
          canSchedule={canSchedule}
          onConsumed={onConsumed}
          platform={Platform.INSTAGRAM}
          title="Reel"
          kind="reel"
        />
      </div>
    );
  }

  if (seed && seed !== seedApplied) {
    setSeedApplied(seed);
    const lines = seed
      .split("\n")
      .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "").trim())
      .filter(Boolean);
    if (lines.length > 0) {
      setCoverHook(lines[0]!);
      const rest = lines.slice(1);
      setSlides(
        rest.length > 0
          ? rest.map((line, index) => ({
              headline: line.slice(0, 60),
              body: line.length > 60 ? line : "",
              template: index === rest.length - 1 ? "close" : "list-item",
            }))
          : DEFAULT_SLIDES
      );
    }
  }

  function updateSlide(index: number, patch: Partial<Slide>) {
    setSlides((current) =>
      current.map((slide, i) => (i === index ? { ...slide, ...patch } : slide))
    );
  }
  function move(index: number, delta: number) {
    setSlides((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <FormatSwitch format={format} onChange={setFormat} />
      <ComposerShell
        platform={Platform.INSTAGRAM}
        campaigns={campaigns}
        canSchedule={canSchedule}
        title="Carousel"
        onSaved={() => {
          setCoverHook("");
          setSlides(DEFAULT_SLIDES);
          onConsumed();
        }}
        build={() => {
          if (!coverHook.trim()) {
            return "The cover hook decides whether anyone swipes — write it";
          }
          const filled = slides.filter(
            (slide) => slide.headline.trim() || slide.body.trim()
          );
          if (filled.length === 0) return "Add at least one slide";
          return {
            body: [
              coverHook.trim(),
              ...filled.map(
                (slide, index) =>
                  `${index + 1}. ${slide.headline.trim()}${slide.body.trim() ? ` — ${slide.body.trim()}` : ""}`
              ),
            ].join("\n"),
            platformData: {
              kind: "carousel",
              coverHook: coverHook.trim(),
              slides: filled.map((slide) => ({
                headline: slide.headline.trim(),
                body: slide.body.trim(),
                template: slide.template,
              })),
              hashtags: [],
            },
          };
        }}
      >
        <div className="flex flex-col gap-2 rounded-md border border-accent/40 bg-accent/5 p-3">
          <Label htmlFor="cover-hook">Cover slide</Label>
          <Textarea
            id="cover-hook"
            value={coverHook}
            onChange={(event) => setCoverHook(event.target.value)}
            rows={2}
            placeholder="One line. If this doesn't earn a swipe, nothing behind it gets seen."
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
            Deck — one point per slide
          </span>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {slides.map((slide, index) => (
              <div
                key={index}
                // 4:5 — the shape a carousel slide actually occupies.
                className="flex aspect-[4/5] flex-col gap-1.5 rounded-md border border-border bg-surface-raised p-2.5"
              >
                <div className="flex items-center gap-0.5">
                  <span className="font-mono text-[10px] text-muted">
                    {index + 1}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Move earlier"
                    className="ml-auto h-6 w-6"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowLeft />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Move later"
                    className="h-6 w-6"
                    disabled={index === slides.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowRight />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Remove slide"
                    className="h-6 w-6"
                    onClick={() =>
                      setSlides((c) => c.filter((_, i) => i !== index))
                    }
                  >
                    <XIcon />
                  </Button>
                </div>
                <Input
                  value={slide.headline}
                  onChange={(event) =>
                    updateSlide(index, { headline: event.target.value })
                  }
                  placeholder="Headline"
                  className="h-7 text-xs"
                />
                <Textarea
                  value={slide.body}
                  onChange={(event) =>
                    updateSlide(index, { body: event.target.value })
                  }
                  rows={4}
                  placeholder="One point."
                  className="min-h-0 flex-1 resize-none text-xs"
                />
                <Select
                  value={slide.template}
                  onValueChange={(value) => updateSlide(index, { template: value })}
                >
                  <SelectTrigger className="h-7 text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TEMPLATES.map((template) => (
                      <SelectItem key={template} value={template}>
                        {template}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="self-start"
            onClick={() =>
              setSlides((current) => [
                ...current,
                { headline: "", body: "", template: "list-item" },
              ])
            }
          >
            <Plus />
            Add slide
          </Button>
          <p className="text-[11px] text-muted">
            Close on something save-worthy — saves are what Instagram rewards.
          </p>
        </div>
      </ComposerShell>
    </div>
  );
}

function FormatSwitch({
  format,
  onChange,
}: {
  format: "carousel" | "reel";
  onChange: (value: "carousel" | "reel") => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
        Format
      </span>
      {(["carousel", "reel"] as const).map((option) => (
        <Button
          key={option}
          size="sm"
          variant={format === option ? "default" : "ghost"}
          onClick={() => onChange(option)}
        >
          {option === "carousel" ? "Carousel" : "Reel"}
        </Button>
      ))}
    </div>
  );
}
