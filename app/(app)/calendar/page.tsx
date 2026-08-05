import type { Metadata } from "next";

import { CalendarBoard } from "@/components/calendar/calendar-board";
import { PageHeader } from "@/components/shell/page-placeholder";
import { Badge } from "@/components/ui/badge";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";
import { listPosts } from "@/modules/posts/service";

export const metadata: Metadata = { title: "Calendar · SocialOS" };

/** One calendar across all five platforms (Phase 5). */
export default async function CalendarPage() {
  const session = await requireSession();
  const posts = await listPosts(session);
  const canEdit = can(session.role, "post.edit");

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-8 animate-fade-in">
      <PageHeader
        eyebrow="Workspace"
        title="Content Calendar"
        description={`Drafts, approvals, scheduled posts and published work — every platform in one grid.${canEdit ? " Drag a post to move it." : ""}`}
        action={<Badge variant="accent">{posts.length} posts</Badge>}
      />

      <CalendarBoard
        posts={posts.map((p) => ({
          id: p.id,
          platform: p.platform,
          status: p.status,
          body: p.body,
          scheduledAt: p.scheduledAt?.toISOString() ?? null,
          campaignName: p.campaign?.name ?? null,
        }))}
        canEdit={canEdit}
      />
    </div>
  );
}
