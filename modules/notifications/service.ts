import type { Session } from "@/lib/auth/session";
import { db } from "@/lib/db";

export async function listNotifications(session: Session, take = 20) {
  return db.notification.findMany({
    where: { orgId: session.orgId, userId: session.userId },
    orderBy: [{ read: "asc" }, { createdAt: "desc" }],
    take,
  });
}

export async function countUnread(session: Session) {
  return db.notification.count({
    where: { orgId: session.orgId, userId: session.userId, read: false },
  });
}

export async function markRead(session: Session, id: string) {
  // updateMany rather than update: it scopes by orgId in the same statement,
  // so a foreign id simply matches nothing instead of throwing.
  await db.notification.updateMany({
    where: { id, orgId: session.orgId, userId: session.userId },
    data: { read: true },
  });
}

export async function markAllRead(session: Session) {
  await db.notification.updateMany({
    where: { orgId: session.orgId, userId: session.userId, read: false },
    data: { read: true },
  });
}

export async function notify(
  session: Session,
  input: { userId: string; type: string; body: string; link?: string }
) {
  return db.notification.create({
    data: {
      orgId: session.orgId,
      userId: input.userId,
      type: input.type,
      body: input.body,
      link: input.link ?? null,
    },
  });
}
