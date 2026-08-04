import type { Prisma } from "@prisma/client";

import type { Session } from "@/lib/auth/session";
import { db } from "@/lib/db";

/**
 * Activity log (ARCHITECTURE.md §4). Called from every other service on write —
 * this is the audit trail the Team screen and the dashboard feed read from.
 */
export async function logActivity(
  session: Session,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown> = {}
) {
  return db.activityLog.create({
    data: {
      orgId: session.orgId,
      userId: session.userId,
      action,
      entityType,
      entityId,
      metadata: metadata as Prisma.InputJsonValue,
    },
  });
}

export async function listActivity(session: Session, take = 20) {
  return db.activityLog.findMany({
    where: { orgId: session.orgId },
    include: { user: true },
    orderBy: { createdAt: "desc" },
    take,
  });
}
