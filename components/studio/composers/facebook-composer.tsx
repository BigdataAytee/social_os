"use client";

import { useState } from "react";
import { Platform } from "@prisma/client";
import { MessageCircleQuestion } from "lucide-react";

import { ComposerShell } from "./shell";
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
 * Facebook composer: longer-form editor with the discussion prompt as a
 * first-class field (Platform-Native-Studios.md §1).
 *
 * Separating the prompt from the body is the whole point. The algorithm rewards
 * comments specifically, and a question tacked onto the end of a paragraph gets
 * skimmed past — giving it its own field makes writing one the default rather
 * than something you remember to do.
 */

const AUDIENCES = [
  { value: "public", label: "Page — public" },
  { value: "group", label: "Group" },
  { value: "event", label: "Event" },
];

export function FacebookComposer({
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
  const [body, setBody] = useState("");
  const [discussionPrompt, setDiscussionPrompt] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [audience, setAudience] = useState("public");
  const [seedApplied, setSeedApplied] = useState("");

  if (seed && seed !== seedApplied) {
    setSeedApplied(seed);
    // A generated post usually ends on its question. Lifting a trailing
    // question into its own field is what the native shape wants, and leaving
    // it in the body would duplicate it.
    const trimmed = seed.trim();
    const lastLine = trimmed.split("\n").filter(Boolean).pop() ?? "";
    if (lastLine.trim().endsWith("?") && trimmed.split("\n").length > 1) {
      setBody(trimmed.slice(0, trimmed.lastIndexOf(lastLine)).trim());
      setDiscussionPrompt(lastLine.trim());
    } else {
      setBody(trimmed);
    }
  }

  return (
    <ComposerShell
      platform={Platform.FACEBOOK}
      campaigns={campaigns}
      canSchedule={canSchedule}
      title="Post"
      onSaved={() => {
        setBody("");
        setDiscussionPrompt("");
        setLinkUrl("");
        setLinkTitle("");
        onConsumed();
      }}
      build={() => {
        if (!body.trim()) return "Write something first";
        return {
          // The prompt goes last in the rendered body because that's where it
          // publishes, but it's stored separately so analysis can tell whether
          // posts that carried one actually did better.
          body: [body.trim(), discussionPrompt.trim()]
            .filter(Boolean)
            .join("\n\n"),
          platformData: {
            kind: audience === "public" ? "post" : audience,
            body: body.trim(),
            linkCard: {
              url: linkUrl.trim() || null,
              title: linkTitle.trim() || null,
            },
            discussionPrompt: discussionPrompt.trim(),
            audience,
          },
        };
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="fb-body">Post</Label>
        <Textarea
          id="fb-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={9}
          placeholder="Room to be conversational. Context and explanation beat broadcast here — shares and comments matter more than likes."
        />
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-accent/40 bg-accent/5 p-3">
        <Label htmlFor="discussion" className="flex items-center gap-1.5">
          <MessageCircleQuestion className="h-3.5 w-3.5" />
          Discussion prompt
        </Label>
        <Input
          id="discussion"
          value={discussionPrompt}
          onChange={(event) => setDiscussionPrompt(event.target.value)}
          placeholder="An explicit question. Passive statements underperform here."
        />
        <p className="text-[11px] text-muted">
          Its own field on purpose — the algorithm rewards comments, and a
          question buried at the end of the body gets skimmed past.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="fb-audience">Target</Label>
          <Select value={audience} onValueChange={setAudience}>
            <SelectTrigger id="fb-audience">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AUDIENCES.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="fb-link">Link card</Label>
          <Input
            id="fb-link"
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            placeholder="https://…"
          />
        </div>
      </div>

      {linkUrl.trim() && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="fb-link-title">Link title</Label>
          <Input
            id="fb-link-title"
            value={linkTitle}
            onChange={(event) => setLinkTitle(event.target.value)}
            placeholder="How the card reads in the feed"
          />
        </div>
      )}
    </ComposerShell>
  );
}
