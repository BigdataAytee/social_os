"use client";

import { useState, useTransition } from "react";
import { PostStatus, type Platform } from "@prisma/client";
import { CalendarClock, FileText, Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { createPostAction } from "@/app/actions/posts";
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
import { CHARACTER_LIMITS } from "@/lib/validators/platform-data";
import { cn } from "@/lib/utils";

/**
 * The composer (§8). Writes through createPostAction → the post service, so an
 * EDITOR's "schedule" lands in NEEDS_APPROVAL exactly as it would from any
 * other surface — the UI doesn't reimplement the rule, it just reports it.
 */
export function Composer({
  platform,
  value,
  onChange,
  campaigns,
  canSchedule,
}: {
  platform: Platform;
  value: string;
  onChange: (value: string) => void;
  campaigns: { id: string; name: string }[];
  canSchedule: boolean;
}) {
  const [scheduledAt, setScheduledAt] = useState("");
  const [campaignId, setCampaignId] = useState<string>("none");
  const [pending, startTransition] = useTransition();

  const limit = CHARACTER_LIMITS[platform];
  const remaining = limit - value.length;
  const over = remaining < 0;

  function save(status: PostStatus) {
    if (!value.trim()) {
      toast.error("Write something first");
      return;
    }
    if (over) {
      toast.error(`That's ${Math.abs(remaining)} characters over the limit`);
      return;
    }
    if (status !== PostStatus.DRAFT && !scheduledAt) {
      toast.error("Pick a date and time to schedule");
      return;
    }

    startTransition(async () => {
      const result = await createPostAction({
        platform,
        body: value,
        status,
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

      onChange("");
      setScheduledAt("");
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-secondary" />
        <h3 className="font-display text-sm font-medium text-primary">
          Composer
        </h3>
        <span
          className={cn(
            "ml-auto font-mono text-[11px] tabular",
            over ? "text-danger" : remaining < limit * 0.1 ? "text-warning" : "text-muted"
          )}
        >
          {value.length}/{limit}
        </span>
      </div>

      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={7}
        placeholder="Write the post, or generate one above and hit Use this."
        className={cn(over && "border-danger")}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="schedule-at">Schedule for</Label>
          <Input
            id="schedule-at"
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
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
              {campaigns.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

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
