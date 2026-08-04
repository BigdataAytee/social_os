import { assertCan } from "@/lib/auth/permissions";
import type { Session } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { campaignSchema } from "@/lib/validators/misc";
import { logActivity } from "@/modules/activity/service";
import { z } from "zod";

export async function listCampaigns(session: Session) {
  return db.campaign.findMany({
    where: { orgId: session.orgId },
    include: { _count: { select: { posts: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function createCampaign(
  session: Session,
  input: z.input<typeof campaignSchema>
) {
  assertCan(session.role, "campaign.manage");
  const data = campaignSchema.parse(input);

  const campaign = await db.campaign.create({
    data: { orgId: session.orgId, ...data },
  });
  await logActivity(session, "campaign.created", "campaign", campaign.id, {
    name: campaign.name,
  });
  return campaign;
}

export async function deleteCampaign(session: Session, id: string) {
  assertCan(session.role, "campaign.manage");
  const existing = await db.campaign.findFirst({
    where: { id, orgId: session.orgId },
  });
  if (!existing) throw new Error("Campaign not found");

  // Posts survive their campaign — detach rather than cascade-delete content.
  await db.post.updateMany({
    where: { campaignId: existing.id },
    data: { campaignId: null },
  });
  await db.campaign.delete({ where: { id: existing.id } });
  await logActivity(session, "campaign.deleted", "campaign", id, {});
}
