"use client";

import { useState } from "react";
import { Platform } from "@prisma/client";
import { ImageIcon, Plus, X as XIcon } from "lucide-react";

import { ComposerShell } from "./shell";
import { TikTokComposer } from "./tiktok-composer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * YouTube composer: a title/thumbnail workshop, then chapters
 * (Platform-Native-Studios.md §1).
 *
 * The pairing is the design. Title and thumbnail are conceived as one unit and
 * iterated together, so they are laid out side by side as numbered concepts —
 * generating a list of titles and a separate list of thumbnails would produce
 * pairs nobody actually chose.
 */

type Concept = { title: string; thumbnail: string };

const DEFAULT_CONCEPTS: Concept[] = [
  { title: "", thumbnail: "" },
  { title: "", thumbnail: "" },
];

export function YouTubeComposer({
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
  const [format, setFormat] = useState<"long-form" | "short">("long-form");
  const [concepts, setConcepts] = useState<Concept[]>(DEFAULT_CONCEPTS);
  const [script, setScript] = useState("");
  const [chapters, setChapters] = useState<{ time: string; label: string }[]>([
    { time: "0:00", label: "Intro" },
  ]);
  const [keywords, setKeywords] = useState("");
  const [seedApplied, setSeedApplied] = useState("");

  // Shorts behave like TikTok, keyword-tagged for YouTube search (§1).
  if (format === "short") {
    return (
      <div className="flex flex-col gap-3">
        <FormatSwitch format={format} onChange={setFormat} />
        <TikTokComposer
          seed={seed}
          campaigns={campaigns}
          canSchedule={canSchedule}
          onConsumed={onConsumed}
          platform={Platform.YOUTUBE}
          title="Short"
          kind="short"
        />
      </div>
    );
  }

  if (seed && seed !== seedApplied) {
    setSeedApplied(seed);
    setScript(seed.trim());
  }

  function updateConcept(index: number, patch: Partial<Concept>) {
    setConcepts((current) =>
      current.map((concept, i) => (i === index ? { ...concept, ...patch } : concept))
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <FormatSwitch format={format} onChange={setFormat} />
      <ComposerShell
        platform={Platform.YOUTUBE}
        campaigns={campaigns}
        canSchedule={canSchedule}
        title="Video"
        onSaved={() => {
          setConcepts(DEFAULT_CONCEPTS);
          setScript("");
          setChapters([{ time: "0:00", label: "Intro" }]);
          onConsumed();
        }}
        build={() => {
          const paired = concepts.filter((concept) => concept.title.trim());
          if (paired.length === 0) return "Write at least one title concept";
          if (!script.trim()) return "Write the script or description";
          return {
            body: [script.trim()].join("\n"),
            platformData: {
              kind: "long-form",
              titleOptions: paired.map((concept) => concept.title.trim()),
              thumbnailConcepts: paired.map((concept) =>
                concept.thumbnail.trim()
              ),
              chapters: chapters
                .filter((chapter) => chapter.label.trim())
                .map((chapter) => ({
                  time: chapter.time.trim(),
                  label: chapter.label.trim(),
                })),
              keywords: keywords
                .split(",")
                .map((keyword) => keyword.trim())
                .filter(Boolean),
            },
          };
        }}
      >
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
            Title + thumbnail — paired concepts
          </span>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {concepts.map((concept, index) => (
              <div
                key={index}
                className="flex flex-col gap-2 rounded-md border border-border bg-surface-raised p-3"
              >
                <div className="flex items-center gap-1">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
                    Concept {index + 1}
                  </span>
                  {concepts.length > 1 && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Remove concept"
                      className="ml-auto h-6 w-6"
                      onClick={() =>
                        setConcepts((c) => c.filter((_, i) => i !== index))
                      }
                    >
                      <XIcon />
                    </Button>
                  )}
                </div>
                {/* 16:9 — thumbnails are judged at this shape, next to the title
                    they ship with, never in isolation. */}
                <div className="flex aspect-video items-center justify-center rounded-sm border border-border bg-canvas p-2 text-center">
                  <span className="line-clamp-3 text-[10px] leading-tight text-secondary">
                    {concept.thumbnail || (
                      <span className="flex flex-col items-center gap-1 text-muted">
                        <ImageIcon className="h-4 w-4" aria-hidden />
                        thumbnail concept
                      </span>
                    )}
                  </span>
                </div>
                <Input
                  value={concept.title}
                  onChange={(event) =>
                    updateConcept(index, { title: event.target.value })
                  }
                  placeholder="Title"
                  className="h-7 text-xs"
                />
                <Textarea
                  value={concept.thumbnail}
                  onChange={(event) =>
                    updateConcept(index, { thumbnail: event.target.value })
                  }
                  rows={2}
                  placeholder="Subject, composition, words on screen — concrete enough for a designer."
                  className="text-xs"
                />
              </div>
            ))}
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="self-start"
            onClick={() =>
              setConcepts((current) => [...current, { title: "", thumbnail: "" }])
            }
          >
            <Plus />
            Add concept
          </Button>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="yt-script">Script / description</Label>
          <Textarea
            id="yt-script"
            value={script}
            onChange={(event) => setScript(event.target.value)}
            rows={8}
            placeholder="Cold open that earns the next 30 seconds, then the promise, then the body."
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
            Chapters
          </span>
          {chapters.map((chapter, index) => (
            <div key={index} className="flex gap-2">
              <Input
                value={chapter.time}
                onChange={(event) =>
                  setChapters((current) =>
                    current.map((c, i) =>
                      i === index ? { ...c, time: event.target.value } : c
                    )
                  )
                }
                className="w-20 font-mono text-xs"
                aria-label={`Chapter ${index + 1} time`}
              />
              <Input
                value={chapter.label}
                onChange={(event) =>
                  setChapters((current) =>
                    current.map((c, i) =>
                      i === index ? { ...c, label: event.target.value } : c
                    )
                  )
                }
                placeholder="Chapter label"
                className="flex-1 text-xs"
              />
              <Button
                size="icon"
                variant="ghost"
                aria-label="Remove chapter"
                onClick={() =>
                  setChapters((c) => c.filter((_, i) => i !== index))
                }
              >
                <XIcon />
              </Button>
            </div>
          ))}
          <Button
            size="sm"
            variant="secondary"
            className="self-start"
            onClick={() =>
              setChapters((current) => [...current, { time: "0:00", label: "" }])
            }
          >
            <Plus />
            Add chapter
          </Button>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="yt-keywords">Search keywords</Label>
          <Input
            id="yt-keywords"
            value={keywords}
            onChange={(event) => setKeywords(event.target.value)}
            placeholder="Comma separated — YouTube is search-and-browse driven"
          />
        </div>
      </ComposerShell>
    </div>
  );
}

function FormatSwitch({
  format,
  onChange,
}: {
  format: "long-form" | "short";
  onChange: (value: "long-form" | "short") => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
        Format
      </span>
      {(["long-form", "short"] as const).map((option) => (
        <Button
          key={option}
          size="sm"
          variant={format === option ? "default" : "ghost"}
          onClick={() => onChange(option)}
        >
          {option === "long-form" ? "Long-form" : "Short"}
        </Button>
      ))}
    </div>
  );
}
