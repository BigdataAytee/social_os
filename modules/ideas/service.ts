import type { Platform } from "@prisma/client";
import { z } from "zod";

import { assertCan } from "@/lib/auth/permissions";
import type { Session } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ideaSchema } from "@/lib/validators/misc";
import { logActivity } from "@/modules/activity/service";

export async function listIdeas(
  session: Session,
  filters: { platform?: Platform; take?: number } = {}
) {
  return db.idea.findMany({
    where: {
      orgId: session.orgId,
      ...(filters.platform ? { platform: filters.platform } : {}),
    },
    orderBy: { createdAt: "desc" },
    ...(filters.take ? { take: filters.take } : {}),
  });
}

export async function createIdea(
  session: Session,
  input: z.input<typeof ideaSchema>
) {
  assertCan(session.role, "idea.write");
  const data = ideaSchema.parse(input);

  const idea = await db.idea.create({
    data: { orgId: session.orgId, ...data },
  });
  await logActivity(session, "idea.created", "idea", idea.id, {
    platform: idea.platform,
  });
  return idea;
}

export async function deleteIdea(session: Session, id: string) {
  assertCan(session.role, "idea.write");
  const result = await db.idea.deleteMany({
    where: { id, orgId: session.orgId },
  });
  if (result.count === 0) throw new Error("Idea not found");
}
