"use client";

import { useState, useTransition } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { saveBrandVoiceAction } from "@/app/actions/workspace";
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
 * Brand voice (Phase 6).
 *
 * This form is the whole mechanism: the orchestrator reads these fields into
 * the system prompt on every generation (§9), so changing the tone here and
 * regenerating the same prompt produces noticeably different output with no
 * code change anywhere.
 */

export type BrandVoiceValues = {
  tone: string;
  audience: string;
  emojiUsage: "none" | "light" | "heavy";
  ctaStyle: string;
  readingLevel: string;
  avoidWords: string[];
};

export function BrandVoiceForm({
  initial,
  canEdit,
}: {
  initial: BrandVoiceValues | null;
  canEdit: boolean;
}) {
  const [values, setValues] = useState<BrandVoiceValues>(
    initial ?? {
      tone: "",
      audience: "",
      emojiUsage: "light",
      ctaStyle: "",
      readingLevel: "",
      avoidWords: [],
    }
  );
  const [avoidInput, setAvoidInput] = useState(
    (initial?.avoidWords ?? []).join(", ")
  );
  const [pending, startTransition] = useTransition();

  function set<K extends keyof BrandVoiceValues>(
    key: K,
    value: BrandVoiceValues[K]
  ) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function save() {
    startTransition(async () => {
      const result = await saveBrandVoiceAction({
        ...values,
        avoidWords: avoidInput
          .split(",")
          .map((w) => w.trim())
          .filter(Boolean),
      });
      if (!result.ok) toast.error(result.error);
      else toast.success("Brand voice saved — regenerate to hear the difference");
    });
  }

  return (
    <div className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-sm font-medium text-primary">
          Brand voice
        </h2>
        <p className="text-xs text-muted">
          Applied to every AI generation across all five Studios.
        </p>
      </div>

      <fieldset disabled={!canEdit || pending} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Label htmlFor="tone">Tone</Label>
          <Textarea
            id="tone"
            rows={2}
            value={values.tone}
            onChange={(e) => set("tone", e.target.value)}
            placeholder="Direct and warm. Opinionated without being combative."
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="audience">Audience</Label>
          <Textarea
            id="audience"
            rows={2}
            value={values.audience}
            onChange={(e) => set("audience", e.target.value)}
            placeholder="Who you're writing for, and what they already know."
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="emoji">Emoji usage</Label>
            <Select
              value={values.emojiUsage}
              onValueChange={(v) =>
                set("emojiUsage", v as BrandVoiceValues["emojiUsage"])
              }
            >
              <SelectTrigger id="emoji">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="heavy">Heavy</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="reading-level">Reading level</Label>
            <Input
              id="reading-level"
              value={values.readingLevel}
              onChange={(e) => set("readingLevel", e.target.value)}
              placeholder="Grade 8 — short sentences, concrete nouns"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="cta">Call-to-action style</Label>
          <Textarea
            id="cta"
            rows={2}
            value={values.ctaStyle}
            onChange={(e) => set("ctaStyle", e.target.value)}
            placeholder="Soft and specific. Ask a real question or point at one next step."
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="avoid">Words to avoid</Label>
          <Input
            id="avoid"
            value={avoidInput}
            onChange={(e) => setAvoidInput(e.target.value)}
            placeholder="leverage, synergy, game-changer"
          />
          <p className="text-xs text-muted">
            Comma separated. These are passed to the model as a hard rule.
          </p>
        </div>
      </fieldset>

      {canEdit ? (
        <Button onClick={save} disabled={pending} className="self-start">
          {pending ? <Loader2 className="animate-spin" /> : <Save />}
          Save brand voice
        </Button>
      ) : (
        <p className="text-xs text-muted">
          Your role can view the brand voice but not change it.
        </p>
      )}
    </div>
  );
}
