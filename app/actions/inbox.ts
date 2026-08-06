"use server";

import { revalidatePath } from "next/cache";
import type { ConversationStatus } from "@prisma/client";

import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  assign,
  reply,
  setStatus,
  suggestReply,
  syncInbox,
} from "@/modules/inbox/service";
import { toActionResult, type ActionResult } from "./result";

/**
 * Inbox actions (OS-ARCHITECTURE.md §11 stage 5).
 *
 * Every one revalidates `/inbox`, because the queue's ordering is derived —
 * replying changes a thread's status, which changes what the counts say, which
 * changes what the nav badge shows. Leaving any of those stale makes the inbox
 * look broken in the one way an inbox must not: showing work that is already
 * done.
 */

export async function replyAction(input: {
  conversationId: string;
  text: string;
}): Promise<ActionResult<{ sent: boolean; error?: string }>> {
  return toActionResult(async () => {
    const session = await requireSession();
    const result = await reply(session, input);
    revalidatePath("/inbox");

    // A platform refusal is a result, not an exception: the person needs to see
    // *why* their reply didn't send, and an ActionResult error would lose the
    // text they just wrote.
    return result.ok
      ? { sent: true }
      : { sent: false, error: result.error };
  });
}

export async function suggestReplyAction(input: {
  conversationId: string;
}): Promise<ActionResult<{ draft: string; source: string }>> {
  return toActionResult(async () => {
    const session = await requireSession();
    return suggestReply(session, input.conversationId);
  });
}

export async function assignAction(input: {
  conversationId: string;
  userId: string | null;
}): Promise<ActionResult<{ assigneeId: string | null }>> {
  return toActionResult(async () => {
    const session = await requireSession();
    const updated = await assign(session, input);
    revalidatePath("/inbox");
    return { assigneeId: updated.assigneeId };
  });
}

export async function setStatusAction(input: {
  conversationId: string;
  status: ConversationStatus;
  snoozeHours?: number;
}): Promise<ActionResult<{ status: ConversationStatus }>> {
  return toActionResult(async () => {
    const session = await requireSession();
    const updated = await setStatus(session, input);
    revalidatePath("/inbox");
    return { status: updated.status };
  });
}

/**
 * Pull every account's inbox now.
 *
 * The cron does this every fifteen minutes; this is the "I'm looking at it
 * right now" button. Failures are collected rather than thrown, so one
 * unsupported connection doesn't hide the four that worked.
 */
export async function syncInboxAction(): Promise<
  ActionResult<{ conversations: number; messages: number; notes: string[] }>
> {
  return toActionResult(async () => {
    const session = await requireSession();
    const accounts = await db.connectedAccount.findMany({
      where: { orgId: session.orgId, status: { in: ["CONNECTED", "MOCK"] } },
      select: { id: true, platform: true },
    });

    let conversations = 0;
    let messages = 0;
    const notes: string[] = [];

    for (const account of accounts) {
      try {
        const result = await syncInbox(session, account.id);
        conversations += result.conversations;
        messages += result.messages;
        if (result.unsupported) {
          notes.push(`${account.platform}: ${result.unsupported}`);
        }
      } catch (error) {
        notes.push(
          `${account.platform}: ${error instanceof Error ? error.message : "sync failed"}`
        );
      }
    }

    revalidatePath("/inbox");
    return { conversations, messages, notes };
  });
}
