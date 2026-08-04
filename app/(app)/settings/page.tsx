import type { Metadata } from "next";

import { PagePlaceholder } from "@/components/shell/page-placeholder";

export const metadata: Metadata = { title: "Settings · SocialOS" };

export default function SettingsPage() {
  return (
    <PagePlaceholder
      eyebrow="Organization"
      title="Settings"
      description="Organization profile, connected accounts and the brand voice that shapes every AI generation."
      phase="Phase 6"
      features={[
        "Organization profile",
        "Connected accounts",
        "Brand voice",
        "Notification preferences",
        "Appearance",
        "Danger zone",
      ]}
    />
  );
}
