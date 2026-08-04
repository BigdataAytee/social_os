import type { Metadata } from "next";

import { PageHeader } from "@/components/shell/page-placeholder";
import { TeamBoard } from "@/components/workspace/team-board";
import { Badge } from "@/components/ui/badge";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";
import { listActivity } from "@/modules/activity/service";
import { listMembers, listTasks } from "@/modules/team/service";

export const metadata: Metadata = { title: "Team · SocialOS" };

export default async function TeamPage() {
  const session = await requireSession();
  const [members, tasks, activity] = await Promise.all([
    listMembers(session),
    listTasks(session),
    listActivity(session, 15),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-8 animate-fade-in">
      <PageHeader
        eyebrow="Organization"
        title="Team"
        description="Members, roles and the shared work queue. Role permissions are enforced in the service layer, not just hidden in the UI."
        action={<Badge variant="accent">{members.length} members</Badge>}
      />

      <TeamBoard
        canManage={can(session.role, "member.manage")}
        members={members.map((m) => ({
          membershipId: m.id,
          userId: m.userId,
          name: m.user.name ?? m.user.email,
          email: m.user.email,
          role: m.role,
        }))}
        tasks={tasks.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          assigneeName: t.assignee?.name ?? t.assignee?.email ?? null,
          dueDate: t.dueDate?.toISOString() ?? null,
        }))}
        activity={activity.map((a) => ({
          id: a.id,
          action: a.action,
          userName: a.user.name ?? a.user.email,
          createdAt: a.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
