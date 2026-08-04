import type { Metadata } from "next";

import { PagePlaceholder } from "@/components/shell/page-placeholder";

export const metadata: Metadata = { title: "AI Assistant · SocialOS" };

export default function AssistantPage() {
  return (
    <PagePlaceholder
      eyebrow="Workspace"
      title="AI Assistant"
      description="The full-page view of the assistant that lives in the side panel. It calls the same service layer the forms do — there is no separate mock path."
      phase="Phase 4"
      features={[
        "Chat against /api/ai/chat",
        "Brand voice applied to every reply",
        "Tool call: createPost",
        "Tool call: scheduleContent",
        "Tool call: repurposeContent",
        "Repurpose into every Studio",
        "Generation history",
      ]}
    />
  );
}
