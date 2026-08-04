import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { cn, formatCompact } from "@/lib/utils";

/**
 * The metric primitive. Numbers are mono and tabular everywhere (§7's pairing
 * rule), so columns of these don't jitter as values change.
 */
export function StatTile({
  label,
  value,
  delta,
  suffix,
  className,
}: {
  label: string;
  value: number;
  /** Percent change vs the preceding window. Omit when there's nothing to compare. */
  delta?: number;
  suffix?: string;
  className?: string;
}) {
  const direction = delta === undefined ? null : delta > 0.5 ? "up" : delta < -0.5 ? "down" : "flat";
  const Icon =
    direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : Minus;

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-4",
        className
      )}
    >
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted">
        {label}
      </p>
      <p className="font-mono text-2xl tabular text-primary">
        {formatCompact(value)}
        {suffix && <span className="text-base text-secondary">{suffix}</span>}
      </p>
      {direction && (
        <p
          className={cn(
            "flex items-center gap-1 font-mono text-[11px] tabular",
            direction === "up" && "text-success",
            direction === "down" && "text-danger",
            direction === "flat" && "text-muted"
          )}
        >
          <Icon className="h-3 w-3" />
          {Math.abs(delta!).toFixed(1)}%
          <span className="text-muted">vs previous</span>
        </p>
      )}
    </div>
  );
}
