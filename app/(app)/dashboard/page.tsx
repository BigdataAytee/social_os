import type { Metadata } from "next";

import { PagePlaceholder } from "@/components/shell/page-placeholder";

export const metadata: Metadata = { title: "Dashboard · SocialOS" };

export default function DashboardPage() {
  return (
    <PagePlaceholder
      eyebrow="Workspace"
      title="Dashboard"
      description="The cross-platform view: what's going out, what just happened, and what needs you. Wired to real seeded data in Phase 1."
      phase="Phase 1"
      features={[
        "Scheduled posts",
        "Campaigns",
        "Performance overview",
        "AI recommendations",
        "Trending topics",
        "Notifications",
        "Tasks",
        "Connected accounts",
        "Publishing queue",
        "Quick actions",
        "Activity feed",
      ]}
    />
  );
}
