import type { Metadata } from "next";

import { PagePlaceholder } from "@/components/shell/page-placeholder";

export const metadata: Metadata = { title: "Asset Library · SocialOS" };

export default function AssetsPage() {
  return (
    <PagePlaceholder
      eyebrow="Workspace"
      title="Asset Library"
      description="Shared media for every Studio — uploaded once, reachable from any composer."
      phase="Phase 6"
      features={[
        "Upload to Supabase Storage",
        "Folders",
        "Tags",
        "Search",
        "Grid and list views",
        "Attach to a post",
      ]}
    />
  );
}
