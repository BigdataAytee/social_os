import type { Metadata } from "next";

import { PageHeader } from "@/components/shell/page-placeholder";
import { AssetLibrary } from "@/components/workspace/asset-library";
import { Badge } from "@/components/ui/badge";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";
import { listAssets, listFolders, listTags } from "@/modules/assets/service";

export const metadata: Metadata = { title: "Asset Library · SocialOS" };

export default async function AssetsPage() {
  const session = await requireSession();
  const [assets, folders, tags] = await Promise.all([
    listAssets(session),
    listFolders(session),
    listTags(session),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-8 animate-fade-in">
      <PageHeader
        eyebrow="Workspace"
        title="Asset Library"
        description="Shared media for every Studio — uploaded once, reachable from any composer."
        action={<Badge variant="accent">{assets.length} assets</Badge>}
      />

      <AssetLibrary
        canUpload={can(session.role, "asset.upload")}
        tags={tags}
        folders={folders.map((f) => ({
          id: f.id,
          name: f.name,
          count: f._count.assets,
        }))}
        assets={assets.map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type,
          url: a.url,
          tags: a.tags,
          folderId: a.folderId,
          folderName: a.folder?.name ?? null,
        }))}
      />
    </div>
  );
}
