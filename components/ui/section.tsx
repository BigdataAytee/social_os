import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";

/** Consistent titled block used across the dashboard and workspace screens. */
export function Section({
  title,
  description,
  href,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  href?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="font-display text-sm font-medium text-primary">
            {title}
          </h2>
          {description && (
            <p className="truncate text-xs text-muted">{description}</p>
          )}
        </div>
        {action ??
          (href && (
            <Link
              href={href}
              className="flex shrink-0 items-center gap-1 text-xs text-secondary transition-colors hover:text-accent"
            >
              View all
              <ArrowRight className="h-3 w-3" />
            </Link>
          ))}
      </div>
      {children}
    </section>
  );
}
