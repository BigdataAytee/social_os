"use client";

import { useState } from "react";
import { Platform } from "@prisma/client";
import { ArrowDown, ArrowUp, Music, Plus, X as XIcon } from "lucide-react";

import { ComposerShell } from "./shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * TikTok composer: a vertical 9:16 storyboard timeline, one card per beat
 * (Platform-Native-Studios.md §1).
 *
 * On-screen text is a field, not an afterthought — it's a core element of the
 * format, and a composer that only captured spoken action would produce scripts
 * missing half of what the viewer actually sees. The hook is separated from the
 * beats because it has three seconds to earn the rest.
 */

export type Beat = { t: string; action: string; onScreenText: string };

const DEFAULT_BEATS: Beat[] = [
  { t: "0-3s", action: "", onScreenText: "" },
  { t: "3-12s", action: "", onScreenText: "" },
  { t: "12-25s", action: "", onScreenText: "" },
];

export function TikTokComposer({
  seed,
  campaigns,
  canSchedule,
  onConsumed,
  platform = Platform.TIKTOK,
  title = "Script",
  kind = "script",
}: {
  seed: string;
  campaigns: { id: string; name: string }[];
  canSchedule: boolean;
  onConsumed: () => void;
  /** Instagram Reels and YouTube Shorts reuse this shape (§1). */
  platform?: Platform;
  title?: string;
  kind?: string;
}) {
  const [hookLine, setHookLine] = useState("");
  const [beats, setBeats] = useState<Beat[]>(DEFAULT_BEATS);
  const [soundId, setSoundId] = useState("");
  const [duration, setDuration] = useState(30);
  const [seedApplied, setSeedApplied] = useState("");

  if (seed && seed !== seedApplied) {
    setSeedApplied(seed);
    // Generated scripts arrive as lines; the first is the hook and the rest
    // become beats, which is the structure the prompt scaffold asks for.
    const lines = seed
      .split("\n")
      .map((line) => line.replace(/^\s*(?:HOOK|BEAT \d+|CTA)[:\-]\s*/i, "").trim())
      .filter(Boolean);
    if (lines.length > 0) {
      setHookLine(lines[0]!);
      setBeats(
        lines.slice(1).length > 0
          ? lines.slice(1).map((action, index) => ({
              t: DEFAULT_BEATS[index]?.t ?? `${index * 8}s+`,
              action,
              onScreenText: "",
            }))
          : DEFAULT_BEATS
      );
    }
  }

  function updateBeat(index: number, patch: Partial<Beat>) {
    setBeats((current) =>
      current.map((beat, i) => (i === index ? { ...beat, ...patch } : beat))
    );
  }
  function move(index: number, delta: number) {
    setBeats((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  return (
    <ComposerShell
      platform={platform}
      campaigns={campaigns}
      canSchedule={canSchedule}
      title={title}
      onSaved={() => {
        setHookLine("");
        setBeats(DEFAULT_BEATS);
        setSoundId("");
        onConsumed();
      }}
      build={() => {
        if (!hookLine.trim()) return "The hook is what earns the next 3 seconds — write it";
        const filled = beats.filter((beat) => beat.action.trim());
        if (filled.length === 0) return "Add at least one beat";
        return {
          body: [
            `HOOK: ${hookLine.trim()}`,
            ...filled.map(
              (beat) =>
                `${beat.t}: ${beat.action.trim()}${beat.onScreenText.trim() ? ` — on screen: "${beat.onScreenText.trim()}"` : ""}`
            ),
          ].join("\n"),
          platformData: {
            kind,
            hookLine: hookLine.trim(),
            beats: filled.map((beat) => ({
              t: beat.t,
              action: beat.action.trim(),
              onScreenText: beat.onScreenText.trim(),
            })),
            soundId: soundId.trim() || null,
            durationTargetSec: duration,
            hashtags: [],
          },
        };
      }}
    >
      <div className="flex flex-col gap-2 rounded-md border border-accent/40 bg-accent/5 p-3">
        <Label htmlFor="hook">Hook — 0 to 3 seconds</Label>
        <Textarea
          id="hook"
          value={hookLine}
          onChange={(event) => setHookLine(event.target.value)}
          rows={2}
          placeholder="The first three seconds carry the whole post. No logo intro, no warm-up."
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
          Storyboard
        </span>
        {beats.map((beat, index) => (
          <div
            key={index}
            className="flex gap-3 rounded-md border border-border bg-surface-raised p-3"
          >
            {/* 9:16 proxy — the frame the viewer actually sees. */}
            <div className="flex w-16 shrink-0 flex-col items-center gap-1">
              <div className="flex h-24 w-14 items-center justify-center rounded-sm border border-border bg-canvas p-1 text-center">
                <span className="line-clamp-4 text-[9px] leading-tight text-secondary">
                  {beat.onScreenText || "on-screen text"}
                </span>
              </div>
              <Input
                value={beat.t}
                onChange={(event) => updateBeat(index, { t: event.target.value })}
                className="h-6 px-1 text-center font-mono text-[10px]"
                aria-label={`Beat ${index + 1} timing`}
              />
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex items-center gap-1">
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
                  Beat {index + 1}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Move up"
                  className="ml-auto"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Move down"
                  disabled={index === beats.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove beat"
                  onClick={() => setBeats((c) => c.filter((_, i) => i !== index))}
                >
                  <XIcon />
                </Button>
              </div>
              <Textarea
                value={beat.action}
                onChange={(event) =>
                  updateBeat(index, { action: event.target.value })
                }
                rows={2}
                placeholder="What happens on camera. One idea."
              />
              <Input
                value={beat.onScreenText}
                onChange={(event) =>
                  updateBeat(index, { onScreenText: event.target.value })
                }
                placeholder="On-screen text"
                className="text-xs"
              />
            </div>
          </div>
        ))}
        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          onClick={() =>
            setBeats((current) => [
              ...current,
              { t: `${current.length * 8}s+`, action: "", onScreenText: "" },
            ])
          }
        >
          <Plus />
          Add beat
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="sound" className="flex items-center gap-1.5">
            <Music className="h-3 w-3" />
            Trending sound
          </Label>
          <Input
            id="sound"
            value={soundId}
            onChange={(event) => setSoundId(event.target.value)}
            placeholder="Match by pace and mood, not just popularity"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="duration">Target length (seconds)</Label>
          <Input
            id="duration"
            type="number"
            min={5}
            max={600}
            value={duration}
            onChange={(event) => setDuration(Number(event.target.value) || 30)}
          />
        </div>
      </div>
    </ComposerShell>
  );
}
