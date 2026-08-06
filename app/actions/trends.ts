"use server";

import { revalidatePath } from "next/cache";
import type { Platform } from "@prisma/client";

import { requireSession } from "@/lib/auth/session";
import {
  acceptTrendDraft,
  detectTrends,
  respondToTrend,
  type TrendDraft,
} from "@/modules/trends/pipeline";
import { toActionResult, type ActionResult } from "./result";

export async function detectTrendsAction(input: {
  platform: Platform;
}): Promise<ActionResult<{ id: string; topic: string; summary: string; velocity: string; depth: string }[]>> {
  return toActionResult(async () => {
    const session = await requireSession();
    const events = await detectTrends(session, input.platform);
    revalidatePath(`/studio/${input.platform.toLowerCase()}`);
    return events.map((event) => ({
      id: event.id,
      topic: event.topic,
      summary: event.summary,
      velocity: event.velocity,
      depth: event.depth,
    }));
  });
}

export async function respondToTrendAction(input: {
  trendEventId: string;
}): Promise<ActionResult<{ topic: string; drafts: TrendDraft[] }>> {
  return toActionResult(async () => {
    const session = await requireSession();
    const result = await respondToTrend(session, input.trendEventId);
    return { topic: result.trend.topic, drafts: result.drafts };
  });
}

export async function acceptTrendDraftAction(input: {
  responseId: string;
  platform: Platform;
  body: string;
  platformData: Record<string, unknown>;
}): Promise<ActionResult<{ postId: string }>> {
  return toActionResult(async () => {
    const session = await requireSession();
    const post = await acceptTrendDraft(session, input);
    revalidatePath(`/studio/${input.platform.toLowerCase()}`);
    revalidatePath("/calendar");
    return { postId: post.id };
  });
}
