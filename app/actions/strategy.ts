"use server";

import { revalidatePath } from "next/cache";
import type { Platform } from "@prisma/client";

import { requireSession } from "@/lib/auth/session";
import { generateWeeklyBriefing, topRecommendations } from "@/modules/strategy/briefing";
import { recomputePlatform } from "@/modules/strategy/engine";
import { predictEngagement, type Prediction } from "@/modules/strategy/predict";
import { toActionResult, type ActionResult } from "./result";

/**
 * Growth Strategist actions (Growth-Strategist-Engine.md §5).
 *
 * Prediction is on-demand and unstored — it's cheap, and a draft changes
 * between predictions so a saved copy would go stale. Recompute is the opposite:
 * expensive enough to run on a schedule and store.
 */

export async function predictEngagementAction(input: {
  platform: Platform;
  body: string;
  platformData: Record<string, unknown>;
  scheduledAt: string | null;
}): Promise<ActionResult<Prediction>> {
  return toActionResult(async () => {
    const session = await requireSession();
    return predictEngagement(session, input);
  });
}

export async function recomputeStrategyAction(input: {
  platform: Platform;
}): Promise<ActionResult<{ briefing: string; source: string }>> {
  return toActionResult(async () => {
    const session = await requireSession();
    await recomputePlatform(session.orgId, input.platform);
    const briefing = await generateWeeklyBriefing(session, input.platform);
    revalidatePath(`/studio/${input.platform.toLowerCase()}`);
    revalidatePath("/dashboard");
    return { briefing: briefing.narrative, source: briefing.source };
  });
}

export async function topRecommendationsAction(): Promise<
  ActionResult<Awaited<ReturnType<typeof topRecommendations>>>
> {
  return toActionResult(async () => {
    const session = await requireSession();
    return topRecommendations(session);
  });
}
