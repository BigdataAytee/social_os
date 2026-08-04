"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, ChevronsUpDown } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { STUDIOS, getStudio } from "@/lib/studios";
import { cn } from "@/lib/utils";

/**
 * The signature element (ARCHITECTURE.md §7).
 *
 * Sits at the top of the sidebar and always states which surface you're on.
 * Picking a Studio re-themes the shell's accent — the layout sets
 * `--studio-accent` from the active route, so every `text-studio` / `bg-studio`
 * in the chrome follows along without anyone passing a color prop.
 */
export function StudioSwitcher() {
  const pathname = usePathname();
  const activeSlug = pathname.startsWith("/studio/")
    ? pathname.split("/")[2]
    : null;
  const active = activeSlug ? getStudio(activeSlug) : undefined;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "group flex w-full items-center gap-3 rounded-md border border-border bg-surface-raised px-3 py-2.5 text-left",
            "transition-colors duration-fast ease-standard hover:border-border-strong"
          )}
        >
          <span
            aria-hidden
            className={cn(
              "h-7 w-1 shrink-0 rounded-full transition-colors duration-base",
              active ? "bg-studio" : "bg-accent"
            )}
          />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[10px] uppercase tracking-wider text-muted">
              {active ? "Studio" : "Workspace"}
            </span>
            <span className="truncate font-display text-sm font-medium text-primary">
              {active ? active.label : "All Studios"}
            </span>
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted transition-colors group-hover:text-secondary" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-[15rem]">
        <DropdownMenuLabel>Switch Studio</DropdownMenuLabel>
        {STUDIOS.map((studio) => {
          const isActive = studio.slug === activeSlug;
          return (
            <DropdownMenuItem key={studio.slug} asChild>
              <Link href={`/studio/${studio.slug}`} className="cursor-pointer">
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: `rgb(var(${studio.accentVar}))` }}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-primary">{studio.label}</span>
                  <span className="truncate text-[11px] text-muted">
                    {studio.tagline}
                  </span>
                </span>
                {isActive && <Check className="h-3.5 w-3.5 text-accent" />}
              </Link>
            </DropdownMenuItem>
          );
        })}

        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/dashboard" className="cursor-pointer">
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-full bg-accent"
            />
            <span className="flex-1">All Studios</span>
            {!activeSlug && <Check className="h-3.5 w-3.5 text-accent" />}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
