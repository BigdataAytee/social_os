import type { Platform, PostStatus } from "@prisma/client";

import { studioForPlatform } from "@/lib/studios";
import { cn } from "@/lib/utils";

/** The accent dot is how a Studio identifies itself everywhere (§7). */
export function PlatformDot({
  platform,
  className,
}: {
  platform: Platform;
  className?: string;
}) {
  const studio = studioForPlatform(platform);
  return (
    <span
      aria-hidden
      className={cn("h-2 w-2 shrink-0 rounded-full", className)}
      style={{ backgroundColor: `rgb(var(${studio.accentVar}))` }}
    />
  );
}

export function PlatformLabel({
  platform,
  className,
}: {
  platform: Platform;
  className?: string;
}) {
  const studio = studioForPlatform(platform);
  return (
    <span className={cn("flex items-center gap-1.5 text-xs text-secondary", className)}>
      <PlatformDot platform={platform} />
      {studio.label}
    </span>
  );
}

const STATUS_STYLES: Record<PostStatus, string> = {
  DRAFT: "border-border bg-surface-raised text-secondary",
  NEEDS_APPROVAL: "border-warning/30 bg-warning/10 text-warning",
  SCHEDULED: "border-accent/30 bg-accent/10 text-accent",
  QUEUED: "border-accent/30 bg-accent/10 text-accent",
  PUBLISHED: "border-success/30 bg-success/10 text-success",
  FAILED: "border-danger/30 bg-danger/10 text-danger",
};

const STATUS_LABELS: Record<PostStatus, string> = {
  DRAFT: "Draft",
  NEEDS_APPROVAL: "Needs approval",
  SCHEDULED: "Scheduled",
  QUEUED: "Queued",
  PUBLISHED: "Published",
  FAILED: "Failed",
};

export function StatusBadge({
  status,
  className,
}: {
  status: PostStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider",
        STATUS_STYLES[status],
        className
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export { STATUS_LABELS };
