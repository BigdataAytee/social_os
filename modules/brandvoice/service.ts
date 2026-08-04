import { z } from "zod";

import { assertCan } from "@/lib/auth/permissions";
import type { Session } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { brandVoiceSchema } from "@/lib/validators/misc";
import { logActivity } from "@/modules/activity/service";

export async function getBrandVoice(session: Session) {
  return db.brandVoice.findUnique({ where: { orgId: session.orgId } });
}

export async function upsertBrandVoice(
  session: Session,
  input: z.input<typeof brandVoiceSchema>
) {
  assertCan(session.role, "brandVoice.edit");
  const data = brandVoiceSchema.parse(input);

  const voice = await db.brandVoice.upsert({
    where: { orgId: session.orgId },
    update: data,
    create: { orgId: session.orgId, ...data, terminology: {} },
  });

  await logActivity(session, "brandVoice.updated", "brandVoice", session.orgId, {
    tone: voice.tone.slice(0, 80),
  });

  return voice;
}
