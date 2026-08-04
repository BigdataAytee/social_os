"use server";

import { revalidatePath } from "next/cache";
import type { Platform, PostStatus } from "@prisma/client";

import { requireSession } from "@/lib/auth/session";
import * as posts from "@/modules/posts/service";
import { toActionResult, type ActionResult } from "./result";

/**
 * Server actions are the transport; every one of them delegates to the service
 * layer (ARCHITECTURE.md §6). No Prisma calls live in this file.
 */

export async function createPostAction(input: {
  platform: Platform;
  body: string;
  status?: PostStatus;
  scheduledAt?: string | null;
  campaignId?: string | null;
  platformData?: Record<string, unknown>;
}): Promise<ActionResult<{ id: string; status: PostStatus }>> {
  return toActionResult(async () => {
    const session = await requireSession();
    const post = await posts.createPost(session, {
      platform: input.platform,
      body: input.body,
      status: input.status,
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      campaignId: input.campaignId ?? null,
      platformData: input.platformData ?? {},
    });
    revalidatePath("/dashboard");
    revalidatePath("/calendar");
    revalidatePath(`/studio/${post.platform.toLowerCase()}`);
    return { id: post.id, status: post.status };
  });
}

export async function updatePostAction(input: {
  id: string;
  body?: string;
  status?: PostStatus;
  scheduledAt?: string | null;
  campaignId?: string | null;
}): Promise<ActionResult<{ id: string; status: PostStatus }>> {
  return toActionResult(async () => {
    const session = await requireSession();
    const post = await posts.updatePost(session, {
      id: input.id,
      body: input.body,
      status: input.status,
      scheduledAt:
        input.scheduledAt === undefined
          ? undefined
          : input.scheduledAt
            ? new Date(input.scheduledAt)
            : null,
      campaignId: input.campaignId,
    });
    revalidatePath("/dashboard");
    revalidatePath("/calendar");
    revalidatePath(`/studio/${post.platform.toLowerCase()}`);
    return { id: post.id, status: post.status };
  });
}

export async function reschedulePostAction(input: {
  id: string;
  scheduledAt: string;
}): Promise<ActionResult<{ id: string; scheduledAt: string | null }>> {
  return toActionResult(async () => {
    const session = await requireSession();
    const post = await posts.reschedulePost(session, {
      id: input.id,
      scheduledAt: new Date(input.scheduledAt),
    });
    revalidatePath("/calendar");
    return {
      id: post.id,
      scheduledAt: post.scheduledAt?.toISOString() ?? null,
    };
  });
}

export async function publishPostAction(
  id: string
): Promise<ActionResult<{ id: string; status: PostStatus }>> {
  return toActionResult(async () => {
    const session = await requireSession();
    const post = await posts.publishPost(session, id);
    revalidatePath("/dashboard");
    revalidatePath("/calendar");
    revalidatePath(`/studio/${post.platform.toLowerCase()}`);
    return { id: post.id, status: post.status };
  });
}

export async function deletePostAction(
  id: string
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const session = await requireSession();
    await posts.deletePost(session, id);
    revalidatePath("/dashboard");
    revalidatePath("/calendar");
    return null;
  });
}
