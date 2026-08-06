"use client";

import { useState, useTransition, type ReactNode } from "react";
import { PostStatus, type Platform } from "@prisma/client";
import { CalendarClock, FileText, Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { createPostAction } from "@/app/actions/posts";
import { PredictionBadge } from "@/components/studio/prediction-badge";
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

/**
 * Everything the five native composers share: the campaign picker, the schedule
 * control, the save/schedule actions, and the engagement-prediction badge
 * (Growth-Strategist-Engine.md §6 — "the chosen given suggestion moment").
 *
 * Each Studio supplies its own editor above this and, critically, its own
 * `platformData` — the native shape is the point, and a shared shell that
 * flattened it back to body text would defeat the whole exercise. `body` is
 * still written because the queue, calendar and search all read it; it's the
 * plain-text rendering of the native shape, not a second source of truth.
 */

export type ComposerSubmission = {
  body: string;
  platformData: Record<string, unknown>;
};

export function ComposerShell({
  platform,
  campaigns,
  canSchedule,
  title,
  children,
  build,
  onSaved,
}: {
  platform: Platform;
  campaigns: { id: string; name: string }[];
  canSchedule: boolean;
  title: string;
  /** The Studio's own editor. */
  children: ReactNode;
  /** Returns the post to save, or an error string explaining what's missing. */
  build: () => ComposerSubmission | string;
  onSaved: () => void;
}) {
  const [scheduledAt, setScheduledAt] = useState("");
  const [campaignId, setCampaignId] = useState<string>("none");
  const [pending, startTransition] = useTransition();

  // Held so the prediction badge can score the draft as it stands, without
  // every keystroke in the editor re-running a prediction.
  const preview = build();
  const draft = typeof preview === "string" ? null : preview;

  function save(status: PostStatus) {
    const built = build();
    if (typeof built === "string") {
      toast.error(built);
      return;
    }
    if (status !== PostStatus.DRAFT && !scheduledAt) {
      toast.error("Pick a date and time to schedule");
      return;
    }

    startTransition(async () => {
      const result = await createPostAction({
        platform,
        body: built.body,
        status,
        platformData: built.platformData,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        campaignId: campaignId === "none" ? null : campaignId,
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      // The service may downgrade SCHEDULED → NEEDS_APPROVAL for an editor.
      // Say what actually happened rather than what was asked for.
      toast.success(
        result.data.status === PostStatus.NEEDS_APPROVAL &&
          status !== PostStatus.NEEDS_APPROVAL
          ? "Saved and sent for approval"
          : result.data.status === PostStatus.DRAFT
            ? "Saved as draft"
            : "Scheduled"
      );

      setScheduledAt("");
      onSaved();
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-secondary" />
        <h3 className="font-display text-sm font-medium text-primary">{title}</h3>
      </div>

      {children}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="schedule-at">Schedule for</Label>
          <Input
            id="schedule-at"
            type="datetime-local"
            value={scheduledAt}
            onChange={(event) => setScheduledAt(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="campaign">Campaign</Label>
          <Select value={campaignId} onValueChange={setCampaignId}>
            <SelectTrigger id="campaign">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No campaign</SelectItem>
              {campaigns.map((campaign) => (
                <SelectItem key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Before you confirm, not after — feedback on this specific draft. */}
      <PredictionBadge
        platform={platform}
        body={draft?.body ?? ""}
        platformData={draft?.platformData ?? {}}
        scheduledAt={scheduledAt || null}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => save(PostStatus.DRAFT)}
        >
          {pending ? <Loader2 className="animate-spin" /> : <FileText />}
          Save draft
        </Button>
        <Button
          disabled={pending}
          onClick={() =>
            save(canSchedule ? PostStatus.SCHEDULED : PostStatus.NEEDS_APPROVAL)
          }
        >
          {canSchedule ? <CalendarClock /> : <Send />}
          {canSchedule ? "Schedule" : "Submit for approval"}
        </Button>
      </div>
    </div>
  );
}
