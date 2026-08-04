import { cn } from "@/lib/utils";

/**
 * SocialOS mark — five bars for five Studios, each in its own accent, the
 * active one implied by the gold underline. Deliberately not a sparkle (§7).
 */
export function Logo({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span
        aria-hidden
        className="flex h-6 items-end gap-[3px] rounded-sm"
        title="SocialOS"
      >
        <i className="block h-3 w-[3px] rounded-full bg-studio-x" />
        <i className="block h-5 w-[3px] rounded-full bg-studio-tiktok" />
        <i className="block h-4 w-[3px] rounded-full bg-studio-instagram" />
        <i className="block h-6 w-[3px] rounded-full bg-studio-facebook" />
        <i className="block h-3.5 w-[3px] rounded-full bg-studio-youtube" />
      </span>
      {!compact && (
        <span className="font-display text-[15px] font-semibold tracking-tight text-primary">
          Social<span className="text-accent">OS</span>
        </span>
      )}
    </div>
  );
}
