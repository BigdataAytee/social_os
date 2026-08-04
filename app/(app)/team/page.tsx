import type { Metadata } from "next";

import { PagePlaceholder } from "@/components/shell/page-placeholder";

export const metadata: Metadata = { title: "Team · SocialOS" };

export default function TeamPage() {
  return (
    <PagePlaceholder
      eyebrow="Organization"
      title="Team"
      description="Members, roles and the shared work queue. Role permissions are defined in ARCHITECTURE.md §5 and enforced in the service layer."
      phase="Phase 6"
      features={[
        "Member list",
        "Invite flow",
        "Role assignment",
        "Task assignment",
        "Approval queue",
        "Comments",
        "Activity log",
      ]}
    />
  );
}
