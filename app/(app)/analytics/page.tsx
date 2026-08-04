import type { Metadata } from "next";

import { PagePlaceholder } from "@/components/shell/page-placeholder";

export const metadata: Metadata = { title: "Analytics · SocialOS" };

export default function AnalyticsPage() {
  return (
    <PagePlaceholder
      eyebrow="Workspace"
      title="Analytics"
      description="Cross-platform performance. Every chart reads from AnalyticsSnapshot — the seed already holds 60–90 days per account."
      phase="Phase 7"
      features={[
        "Follower growth",
        "Reach and impressions",
        "Engagement rate",
        "Clicks and conversions",
        "Audience insights",
        "Best posting times",
        "Competitor comparison",
        "Growth trends",
        "AI recommendations",
      ]}
    />
  );
}
