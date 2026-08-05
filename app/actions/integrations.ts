"use server";

import { revalidatePath } from "next/cache";
import type { Platform } from "@prisma/client";

import { requireSession } from "@/lib/auth/session";
import { studioForPlatform } from "@/lib/studios";
import * as ai from "@/modules/ai/orchestrator";
import { createIdea } from "@/modules/ideas/service";
import type { AccountInsights } from "@/modules/insights/service";
import { disconnectAccount } from "@/modules/integrations/oauth/service";
import { syncAccount, syncOrg } from "@/modules/integrations/sync";
import { toActionResult, type ActionResult } from "./result";

/**
 * Connected-account actions.
 *
 * The connect *start* is a route handler rather than an action because it has to
 * redirect the browser onto the platform's own domain and set the PKCE and CSRF
 * cookies on that same response — see app/api/oauth/[platform]/start.
 * Everything after the account exists is an ordinary action.
 */

function studioPath(platform: Platform) {
  return `/studio/${studioForPlatform(platform).slug}`;
}

export async function syncAccountAction(input: {
  accountId: string;
  platform: Platform;
}): Promise<ActionResult<{ posts: number; snapshots: number }>> {
  return toActionResult(async () => {
    const session = await requireSession();
    const result = await syncAccount(session, input.accountId);
    revalidatePath(studioPath(input.platform));
    revalidatePath("/analytics");
    return { posts: result.posts, snapshots: result.snapshots };
  });
}

export async function syncAllAction(input: {
  platform?: Platform;
}): Promise<ActionResult<{ synced: number; failed: string[] }>> {
  return toActionResult(async () => {
    const session = await requireSession();
    const result = await syncOrg(session, input.platform);
    revalidatePath("/analytics");
    revalidatePath("/dashboard");
    if (input.platform) revalidatePath(studioPath(input.platform));
    return {
      synced: result.synced.length,
      failed: result.failed.map((f) => `${f.handle}: ${f.error}`),
    };
  });
}

export async function disconnectAccountAction(input: {
  accountId: string;
  platform: Platform;
}): Promise<ActionResult<{ handle: string }>> {
  return toActionResult(async () => {
    const session = await requireSession();
    const account = await disconnectAccount(session, input.accountId);
    revalidatePath(studioPath(input.platform));
    revalidatePath("/analytics");
    return { handle: account.handle };
  });
}

export type AccountIdeasPayload = {
  ideas: string[];
  insights: AccountInsights;
  source: "anthropic" | "local";
};

export async function generateAccountIdeasAction(input: {
  platform: Platform;
  days?: number;
  count?: number;
  context?: string;
}): Promise<ActionResult<AccountIdeasPayload>> {
  return toActionResult(async () => {
    const session = await requireSession();
    const result = await ai.generateIdeasFromAccount(session, {
      studio: input.platform,
      days: input.days,
      count: input.count,
      context: input.context,
    });
    return {
      ideas: result.ideas,
      insights: result.insights,
      source: result.source,
    };
  });
}

/**
 * Keep a generated idea. Goes through the ordinary idea service so a saved
 * suggestion is indistinguishable from a hand-typed one everywhere else —
 * the Ideas list, the assistant's listIdeas tool, the composer.
 */
export async function saveGeneratedIdeaAction(input: {
  platform: Platform;
  content: string;
}): Promise<ActionResult<{ id: string }>> {
  return toActionResult(async () => {
    const session = await requireSession();
    const idea = await createIdea(session, {
      platform: input.platform,
      content: input.content,
      source: "ai-insights",
    });
    revalidatePath(studioPath(input.platform));
    return { id: idea.id };
  });
}
