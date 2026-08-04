"use client";

import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";

import { getStudio } from "@/lib/studios";

/**
 * Re-themes the shell to the active Studio's accent (ARCHITECTURE.md §7).
 *
 * Sets `--studio-accent` on the shell container, so every `bg-studio`,
 * `text-studio` and `border-studio` inside follows the route without a single
 * component taking a color prop. Outside a Studio it falls back to the
 * SocialOS gold defined in tokens.css.
 */
export function StudioTheme({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  const slug = pathname.startsWith("/studio/") ? pathname.split("/")[2] : null;
  const studio = slug ? getStudio(slug) : undefined;

  const style = studio
    ? ({ "--studio-accent": `var(${studio.accentVar})` } as CSSProperties)
    : undefined;

  return (
    <div className={className} style={style} data-studio={studio?.slug}>
      {children}
    </div>
  );
}
