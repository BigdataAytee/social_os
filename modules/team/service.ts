import { z } from "zod";

import { assertCan } from "@/lib/auth/permissions";
import type { Session } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { commentSchema, memberRoleSchema, taskSchema } from "@/lib/validators/misc";
import { logActivity } from "@/modules/activity/service";
import { notify } from "@/modules/notifications/service";

export async function listMembers(session: Session) {
  return db.membership.findMany({
    where: { orgId: session.orgId },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function setMemberRole(
  session: Session,
  input: z.input<typeof memberRoleSchema>
) {
  assertCan(session.role, "member.manage");
  const data = memberRoleSchema.parse(input);

  const membership = await db.membership.findFirst({
    where: { id: data.membershipId, orgId: session.orgId },
  });
  if (!membership) throw new Error("Member not found");

  // The last owner can't be demoted — that would orphan the organization.
  if (membership.role === "OWNER" && data.role !== "OWNER") {
    const owners = await db.membership.count({
      where: { orgId: session.orgId, role: "OWNER" },
    });
    if (owners <= 1) throw new Error("An organization needs at least one owner");
  }

  const updated = await db.membership.update({
    where: { id: membership.id },
    data: { role: data.role },
  });

  await logActivity(session, "member.roleChanged", "user", membership.userId, {
    role: data.role,
  });

  return updated;
}

export async function listTasks(session: Session) {
  return db.task.findMany({
    where: { orgId: session.orgId },
    include: { assignee: true },
    orderBy: [{ status: "asc" }, { dueDate: "asc" }],
  });
}

export async function createTask(
  session: Session,
  input: z.input<typeof taskSchema>
) {
  const data = taskSchema.parse(input);

  const task = await db.task.create({
    data: { orgId: session.orgId, ...data },
    include: { assignee: true },
  });

  if (task.assigneeId && task.assigneeId !== session.userId) {
    await notify(session, {
      userId: task.assigneeId,
      type: "task-assigned",
      body: `You were assigned "${task.title}".`,
      link: "/team",
    });
  }

  await logActivity(session, "task.created", "task", task.id, {
    title: task.title,
  });
  return task;
}

export async function setTaskStatus(
  session: Session,
  input: { id: string; status: "TODO" | "IN_PROGRESS" | "DONE" }
) {
  const result = await db.task.updateMany({
    where: { id: input.id, orgId: session.orgId },
    data: { status: input.status },
  });
  if (result.count === 0) throw new Error("Task not found");
  await logActivity(session, "task.statusChanged", "task", input.id, {
    status: input.status,
  });
}

export async function addComment(
  session: Session,
  input: z.input<typeof commentSchema>
) {
  assertCan(session.role, "comment.write");
  const data = commentSchema.parse(input);

  const post = await db.post.findFirst({
    where: { id: data.postId, orgId: session.orgId },
  });
  if (!post) throw new Error("Post not found");

  const comment = await db.comment.create({
    data: {
      orgId: session.orgId,
      userId: session.userId,
      postId: post.id,
      body: data.body,
    },
    include: { user: true },
  });

  if (post.authorId !== session.userId) {
    await notify(session, {
      userId: post.authorId,
      type: "mention",
      body: `${session.name ?? session.email} commented on your post.`,
      link: "/calendar",
    });
  }

  return comment;
}
