import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The one empty state in the product (Phase 8: "no dead ends").
 * Every list renders this rather than nothing when it has no rows.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-12 text-center",
        className
      )}
    >
      {Icon && (
        <span className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface-raised">
          <Icon className="h-4 w-4 text-muted" />
        </span>
      )}
      <div className="flex flex-col gap-1">
        <p className="font-display text-sm font-medium text-primary">{title}</p>
        {description && (
          <p className="max-w-sm text-balance text-sm text-muted">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
