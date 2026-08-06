"use server";

import { revalidatePath } from "next/cache";

import { assertCan } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";
import { rebuildBrandProfile } from "@/modules/brandbrain/service";
import { memoryStats, recall, reindexOrg } from "@/modules/memory/service";
import { toActionResult, type ActionResult } from "./result";

/**
 * Brand Brain and Growth Memory actions (OS-ARCHITECTURE.md §11 stage 4).
 *
 * Both rebuilds run inline rather than through the queue. They take seconds on
 * an org's own corpus, and someone who just pressed "relearn" wants to see the
 * result, not a job id. The nightly cron uses the queue, where nobody is
 * waiting.
 *
 * Gated on `brandVoice.edit`: the profile is the same thing as the voice — one
 * stated, one measured — so anyone who may change one may rebuild the other.
 */

export async function rebuildBrandProfileAction(): Promise<
  ActionResult<{ basedOnPosts: number; pillars: string[]; chunks: number }>
> {
  return toActionResult(async () => {
    const session = await requireSession();
    assertCan(session.role, "brandVoice.edit");

    // Both together: they read the same corpus, and a profile that has learned
    // from posts the index hasn't seen is a confusing half-state to explain.
    const [profile, indexed] = await Promise.all([
      rebuildBrandProfile(session.orgId),
      reindexOrg(session.orgId),
    ]);

    revalidatePath("/settings");
    return {
      basedOnPosts: profile.basedOnPosts,
      pillars: profile.contentPillars,
      chunks: indexed.chunks,
    };
  });
}

export async function recallAction(input: {
  query: string;
}): Promise<
  ActionResult<{ text: string; sourceType: string; score: number | null }[]>
> {
  return toActionResult(async () => {
    const session = await requireSession();
    const hits = await recall(session, input.query, { take: 10 });
    return hits.map((hit) => ({
      text: hit.text.slice(0, 400),
      sourceType: hit.sourceType,
      score: hit.score,
    }));
  });
}

export async function memoryStatsAction(): Promise<
  ActionResult<Record<string, number>>
> {
  return toActionResult(async () => {
    const session = await requireSession();
    return memoryStats(session.orgId);
  });
}
