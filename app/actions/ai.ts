"use server";

import { revalidatePath } from "next/cache";
import type { Platform } from "@prisma/client";

import { requireSession } from "@/lib/auth/session";
import type { GenerationType } from "@/lib/validators/ai";
import * as ai from "@/modules/ai/orchestrator";
import { toActionResult, type ActionResult } from "./result";

export async function generateAction(input: {
  studio: Platform;
  type: GenerationType;
  input: string;
  context?: string;
}): Promise<ActionResult<{ output: string; source: "anthropic" | "local" }>> {
  return toActionResult(async () => {
    const session = await requireSession();
    const result = await ai.generate(session, input);
    revalidatePath(`/studio/${input.studio.toLowerCase()}`);
    return { output: result.output, source: result.source };
  });
}

export async function chatAction(input: {
  messages: { role: "user" | "assistant"; content: string }[];
  studio: Platform | null;
}): Promise<
  ActionResult<{
    text: string;
    effects: { name: string; summary: string; postIds: string[] }[];
    source: "anthropic" | "local";
  }>
> {
  return toActionResult(async () => {
    const session = await requireSession();
    const result = await ai.chat(session, input);
    revalidatePath("/dashboard");
    revalidatePath("/calendar");
    return result;
  });
}

export async function repurposeAction(input: {
  input: string;
  platforms: Platform[];
}): Promise<
  ActionResult<
    { platform: Platform; postId: string; body: string; source: string }[]
  >
> {
  return toActionResult(async () => {
    const session = await requireSession();
    const results = await ai.repurpose(session, input);
    revalidatePath("/calendar");
    revalidatePath("/dashboard");
    return results.map((r) => ({
      platform: r.platform,
      postId: r.post.id,
      body: r.post.body,
      source: r.source,
    }));
  });
}
