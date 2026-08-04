import type { Metadata } from "next";

import { PagePlaceholder } from "@/components/shell/page-placeholder";

export const metadata: Metadata = { title: "Calendar · SocialOS" };

export default function CalendarPage() {
  return (
    <PagePlaceholder
      eyebrow="Workspace"
      title="Content Calendar"
      description="One calendar across all five platforms — drafts, scheduled, published and campaign spans in the same grid."
      phase="Phase 5"
      features={[
        "Unified month / week view",
        "Drafts, scheduled, published",
        "Campaign spans",
        "Drag-and-drop rescheduling",
        "Platform filters",
        "Status filters",
        "Approvals view",
      ]}
    />
  );
}
