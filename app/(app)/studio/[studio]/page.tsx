import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { PagePlaceholder } from "@/components/shell/page-placeholder";
import { getStudio } from "@/lib/studios";

type Params = { params: { studio: string } };

export function generateMetadata({ params }: Params): Metadata {
  const studio = getStudio(params.studio);
  return { title: studio ? `${studio.label} Studio · SocialOS` : "Studio · SocialOS" };
}

/**
 * Every Studio renders through this one route (ARCHITECTURE.md §6).
 *
 * Phase 2 builds X properly and extracts `StudioShell`; Phase 3 has the other
 * four consume it unchanged. Keeping them on a single registry-driven route from
 * Phase 0 is what makes that possible without four rewrites.
 */
export default function StudioPage({ params }: Params) {
  const studio = getStudio(params.studio);
  if (!studio) notFound();

  return (
    <PagePlaceholder
      accent
      eyebrow="Studio"
      title={`${studio.label} Studio`}
      description={studio.tagline}
      phase={studio.slug === "x" ? "Phase 2" : "Phase 3"}
      features={studio.features}
    />
  );
}
