"use server";

import { revalidatePath } from "next/cache";
import type { Platform, Role, TaskStatus } from "@prisma/client";

import { requireSession } from "@/lib/auth/session";
import * as assets from "@/modules/assets/service";
import * as brandvoice from "@/modules/brandvoice/service";
import * as campaigns from "@/modules/campaigns/service";
import * as ideas from "@/modules/ideas/service";
import * as notifications from "@/modules/notifications/service";
import * as team from "@/modules/team/service";
import { toActionResult, type ActionResult } from "./result";

// ------------------------------------------------------------------- ideas

export async function createIdeaAction(input: {
  platform: Platform;
  content: string;
  source?: "manual" | "ai" | "swipe-file";
}): Promise<ActionResult<{ id: string }>> {
  return toActionResult(async () => {
    const session = await requireSession();
    const idea = await ideas.createIdea(session, input);
    revalidatePath(`/studio/${input.platform.toLowerCase()}`);
    return { id: idea.id };
  });
}

export async function deleteIdeaAction(
  id: string
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const session = await requireSession();
    await ideas.deleteIdea(session, id);
    return null;
  });
}

// --------------------------------------------------------------- campaigns

export async function createCampaignAction(input: {
  name: string;
  description?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}): Promise<ActionResult<{ id: string }>> {
  return toActionResult(async () => {
    const session = await requireSession();
    const campaign = await campaigns.createCampaign(session, {
      name: input.name,
      description: input.description ?? null,
      startDate: input.startDate ? new Date(input.startDate) : null,
      endDate: input.endDate ? new Date(input.endDate) : null,
    });
    revalidatePath("/dashboard");
    revalidatePath("/calendar");
    return { id: campaign.id };
  });
}

// ------------------------------------------------------------- brand voice

export async function saveBrandVoiceAction(input: {
  tone: string;
  audience: string;
  emojiUsage: "none" | "light" | "heavy";
  ctaStyle: string;
  readingLevel: string;
  avoidWords: string[];
}): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const session = await requireSession();
    await brandvoice.upsertBrandVoice(session, input);
    revalidatePath("/settings");
    return null;
  });
}

// -------------------------------------------------------------------- team

export async function setMemberRoleAction(input: {
  membershipId: string;
  role: Role;
}): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const session = await requireSession();
    await team.setMemberRole(session, input);
    revalidatePath("/team");
    return null;
  });
}

export async function createTaskAction(input: {
  title: string;
  assigneeId?: string | null;
  dueDate?: string | null;
}): Promise<ActionResult<{ id: string }>> {
  return toActionResult(async () => {
    const session = await requireSession();
    const task = await team.createTask(session, {
      title: input.title,
      assigneeId: input.assigneeId ?? null,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
    });
    revalidatePath("/team");
    revalidatePath("/dashboard");
    return { id: task.id };
  });
}

export async function setTaskStatusAction(input: {
  id: string;
  status: TaskStatus;
}): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const session = await requireSession();
    await team.setTaskStatus(session, input);
    revalidatePath("/team");
    revalidatePath("/dashboard");
    return null;
  });
}

export async function addCommentAction(input: {
  postId: string;
  body: string;
}): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const session = await requireSession();
    await team.addComment(session, input);
    revalidatePath("/calendar");
    return null;
  });
}

// ------------------------------------------------------------------ assets

export async function createAssetAction(input: {
  name: string;
  type: "image" | "video" | "document" | "brand-asset";
  url: string;
  folderId?: string | null;
  tags?: string[];
}): Promise<ActionResult<{ id: string }>> {
  return toActionResult(async () => {
    const session = await requireSession();
    const asset = await assets.createAsset(session, {
      name: input.name,
      type: input.type,
      url: input.url,
      folderId: input.folderId ?? null,
      tags: input.tags ?? [],
    });
    revalidatePath("/assets");
    return { id: asset.id };
  });
}

export async function createFolderAction(input: {
  name: string;
  parentId?: string | null;
}): Promise<ActionResult<{ id: string }>> {
  return toActionResult(async () => {
    const session = await requireSession();
    const folder = await assets.createFolder(session, {
      name: input.name,
      parentId: input.parentId ?? null,
    });
    revalidatePath("/assets");
    return { id: folder.id };
  });
}

export async function deleteAssetAction(
  id: string
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const session = await requireSession();
    await assets.deleteAsset(session, id);
    revalidatePath("/assets");
    return null;
  });
}

// ----------------------------------------------------------- notifications

export async function markNotificationReadAction(
  id: string
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const session = await requireSession();
    await notifications.markRead(session, id);
    revalidatePath("/dashboard");
    return null;
  });
}

export async function markAllNotificationsReadAction(): Promise<
  ActionResult<null>
> {
  return toActionResult(async () => {
    const session = await requireSession();
    await notifications.markAllRead(session);
    revalidatePath("/dashboard");
    return null;
  });
}
