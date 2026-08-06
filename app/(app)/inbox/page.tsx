import type { Metadata } from "next";
import { ConversationStatus } from "@prisma/client";

import { InboxBoard } from "@/components/inbox/inbox-board";
import { PageHeader } from "@/components/shell/page-placeholder";
import { Badge } from "@/components/ui/badge";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { inboxCounts, listConversations } from "@/modules/inbox/service";

export const metadata: Metadata = { title: "Inbox · SocialOS" };
export const dynamic = "force-dynamic";

/**
 * The unified engagement inbox (OS-ARCHITECTURE.md §11 stage 5).
 *
 * Open threads only by default. A queue that shows everything ever received is
 * an archive, and the point of this screen is the shorter list of things
 * nobody has dealt with yet.
 */
export default async function InboxPage() {
  const session = await requireSession();

  const [conversations, counts, members] = await Promise.all([
    listConversations(session, { status: ConversationStatus.OPEN }),
    inboxCounts(session),
    db.membership.findMany({
      where: { orgId: session.orgId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8 animate-fade-in">
      <PageHeader
        eyebrow="Workspace"
        title="Inbox"
        description="Comments, mentions and messages from every connected account, ordered by what needs answering — not by what arrived last."
        action={
          <div className="flex items-center gap-2">
            {counts.high > 0 && (
              <Badge variant="danger">{counts.high} high priority</Badge>
            )}
            <Badge variant="accent">{counts.open} open</Badge>
          </div>
        }
      />

      <InboxBoard
        conversations={conversations.map((conversation) => ({
          ...conversation,
          lastMessageAt: conversation.lastMessageAt.toISOString(),
        }))}
        counts={counts}
        members={members.map((membership) => ({
          id: membership.user.id,
          name: membership.user.name,
          email: membership.user.email,
        }))}
        currentUserId={session.userId}
        canReply={can(session.role, "inbox.reply")}
        canManage={can(session.role, "inbox.manage")}
      />
    </div>
  );
}
