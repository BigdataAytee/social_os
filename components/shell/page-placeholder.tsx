import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  eyebrow,
  accent,
  action,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  /** Renders the title's leading rule in the active Studio accent. */
  accent?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
      <div className="flex min-w-0 gap-4">
        <span
          aria-hidden
          className={cn(
            "mt-1 w-0.5 shrink-0 rounded-full",
            accent ? "bg-studio" : "bg-accent"
          )}
        />
        <div className="flex min-w-0 flex-col gap-1.5">
          {eyebrow && (
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted">
              {eyebrow}
            </p>
          )}
          <h1 className="font-display text-2xl font-semibold tracking-tight text-primary">
            {title}
          </h1>
          {description && (
            <p className="max-w-2xl text-balance text-sm text-secondary">
              {description}
            </p>
          )}
        </div>
      </div>
      {action}
    </div>
  );
}

/**
 * Shared placeholder for routes that exist but aren't built yet.
 *
 * Phase 0's job is to make every destination real and navigable; this states
 * plainly what will live here and which phase owns it, so the app reads as
 * unfinished-but-intentional rather than broken.
 */
export function PagePlaceholder({
  title,
  description,
  eyebrow,
  phase,
  features,
  accent,
}: {
  title: string;
  description: string;
  eyebrow?: string;
  phase: string;
  features: string[];
  accent?: boolean;
}) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-8 animate-fade-in">
      <PageHeader
        title={title}
        description={description}
        eyebrow={eyebrow}
        accent={accent}
        action={<Badge variant={accent ? "studio" : "accent"}>{phase}</Badge>}
      />

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-[10px] uppercase tracking-wider text-muted">
          Planned for this screen
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <li
              key={feature}
              className="flex items-center gap-2.5 rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-secondary"
            >
              <span
                aria-hidden
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  accent ? "bg-studio" : "bg-accent"
                )}
              />
              <span className="truncate">{feature}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-xs text-muted">
        Route is live and wired into the shell. {phase} fills it in — see
        PROGRESS.md.
      </p>
    </div>
  );
}
