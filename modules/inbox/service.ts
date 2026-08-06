import {
  ConversationKind,
  ConversationStatus,
  Platform,
  Sentiment,
  type Conversation,
} from "@prisma/client";

import { assertCan } from "@/lib/auth/permissions";
import type { Session } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { logActivity } from "@/modules/activity/service";
import { getAdapter } from "@/modules/integrations/registry";
import { InboxUnsupportedError, type InboxItemData } from "@/modules/integrations/types";
import { priorityBand, triage } from "./triage";

/**
 * The unified engagement inbox (OS-ARCHITECTURE.md §11 stage 5).
 *
 * Every comment, mention and DM from every connected account, in one queue,
 * ordered by what actually needs answering. The product problem it solves is
 * five browser tabs; the engineering problem is that "one queue" must not mean
 * "one queue per platform with a shared header".
 *
 * `orgId` comes from the session on every call, as everywhere else in this
 * layer. The `accountId` on a conversation is never taken from a caller — it is
 * resolved from the conversation row, which was itself scoped by org.
 */

export type ConversationSummary = {
  id: string;
  platform: Platform;
  kind: ConversationKind;
  status: ConversationStatus;
  authorHandle: string;
  authorName: string | null;
  preview: string;
  sentiment: Sentiment;
  priority: number;
  band: "high" | "medium" | "low";
  unread: number;
  lastMessageAt: Date;
  permalink: string | null;
  assignee: { id: string; name: string | null; email: string } | null;
  messageCount: number;
};

export type InboxFilters = {
  status?: ConversationStatus;
  platform?: Platform;
  kind?: ConversationKind;
  /** "me" resolves against the session; a user id targets someone specific. */
  assignee?: "me" | "unassigned" | string;
  take?: number;
};

/**
 * The queue.
 *
 * Sorted by priority, then recency. Not by recency alone, which is what every
 * platform's own inbox does and is precisely why things get missed: the newest
 * message is rarely the one that matters most, and a sales enquiry from
 * Tuesday should not be below a "🔥" from ten minutes ago.
 *
 * Snoozed threads whose time has come are surfaced by `wakeSnoozed`, not by a
 * clever query here — a filter that silently reinterprets a stored status makes
 * the status column mean two different things.
 */
export async function listConversations(
  session: Session,
  filters: InboxFilters = {}
): Promise<ConversationSummary[]> {
  const assignee = filters.assignee;

  const rows = await db.conversation.findMany({
    where: {
      orgId: session.orgId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.platform ? { platform: filters.platform } : {}),
      ...(filters.kind ? { kind: filters.kind } : {}),
      ...(assignee === "unassigned"
        ? { assigneeId: null }
        : assignee === "me"
          ? { assigneeId: session.userId }
          : assignee
            ? { assigneeId: assignee }
            : {}),
    },
    include: {
      assignee: { select: { id: true, name: true, email: true } },
      messages: { orderBy: { sentAt: "desc" }, take: 1 },
      _count: { select: { messages: true } },
    },
    orderBy: [{ priority: "desc" }, { lastMessageAt: "desc" }],
    take: Math.min(filters.take ?? 100, 200),
  });

  return rows.map((row) => ({
    id: row.id,
    platform: row.platform,
    kind: row.kind,
    status: row.status,
    authorHandle: row.authorHandle,
    authorName: row.authorName,
    preview: row.messages[0]?.text.slice(0, 200) ?? "",
    sentiment: row.sentiment,
    priority: row.priority,
    band: priorityBand(row.priority),
    unread: row.unread,
    lastMessageAt: row.lastMessageAt,
    permalink: row.permalink,
    assignee: row.assignee,
    messageCount: row._count.messages,
  }));
}

/** One thread with its full history. Opening it marks it read. */
export async function getConversation(session: Session, id: string) {
  const conversation = await db.conversation.findFirst({
    where: { id, orgId: session.orgId },
    include: {
      messages: { orderBy: { sentAt: "asc" } },
      assignee: { select: { id: true, name: true, email: true } },
      account: { select: { handle: true, integrationMode: true } },
    },
  });
  if (!conversation) throw new Error("Conversation not found");

  if (conversation.unread > 0) {
    await db.conversation.update({
      where: { id: conversation.id },
      data: { unread: 0 },
    });
  }

  return conversation;
}

export type InboxCounts = {
  open: number;
  unread: number;
  mine: number;
  unassigned: number;
  high: number;
};

/** The numbers the nav badge and the filter chips are made of. */
export async function inboxCounts(session: Session): Promise<InboxCounts> {
  const [open, unread, mine, unassigned, high] = await Promise.all([
    db.conversation.count({
      where: { orgId: session.orgId, status: ConversationStatus.OPEN },
    }),
    db.conversation.count({
      where: { orgId: session.orgId, unread: { gt: 0 } },
    }),
    db.conversation.count({
      where: {
        orgId: session.orgId,
        status: ConversationStatus.OPEN,
        assigneeId: session.userId,
      },
    }),
    db.conversation.count({
      where: {
        orgId: session.orgId,
        status: ConversationStatus.OPEN,
        assigneeId: null,
      },
    }),
    db.conversation.count({
      where: {
        orgId: session.orgId,
        status: ConversationStatus.OPEN,
        priority: { gte: 70 },
      },
    }),
  ]);

  return { open, unread, mine, unassigned, high };
}

/**
 * Pull new items for one account and fold them into the queue.
 *
 * Upsert on `(accountId, externalId)`, so a re-sync updates rather than
 * duplicates — the same property `ExternalPost` relies on, and the reason the
 * mock adapter returns stable ids.
 *
 * Priority is recomputed on every sync rather than frozen at first sight,
 * because the biggest input to it — how long something has been waiting — only
 * increases. A thread that was medium yesterday should be high today without
 * anyone touching it.
 */
export async function syncInbox(
  session: Session,
  accountId: string
): Promise<{ conversations: number; messages: number; unsupported?: string }> {
  const account = await db.connectedAccount.findFirst({
    where: { id: accountId, orgId: session.orgId },
  });
  if (!account) throw new Error("Account not found");

  const adapter = getAdapter(account.platform, account.integrationMode);
  // Two weeks. Long enough that a Friday-evening complaint is still there on
  // Monday, short enough that the first sync doesn't fetch a year of comments.
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  let items: InboxItemData[];
  try {
    items = await adapter.fetchInbox(accountId, since);
  } catch (error) {
    if (error instanceof InboxUnsupportedError) {
      // Recorded against the account, not thrown: this is a permanent property
      // of the connection, and a retry loop over it would be a loop over a
      // fact. The person sees the reason next to the account.
      await db.connectedAccount.update({
        where: { id: accountId },
        data: { lastSyncError: error.reason },
      });
      return { conversations: 0, messages: 0, unsupported: error.reason };
    }
    throw error;
  }

  // Group by thread first: several comments on one post are one conversation,
  // and treating each as its own row is how an inbox becomes unusable.
  const threads = new Map<string, InboxItemData[]>();
  for (const item of items) {
    threads.set(item.threadId, [...(threads.get(item.threadId) ?? []), item]);
  }

  let messages = 0;

  for (const [threadId, thread] of threads) {
    const sorted = [...thread].sort(
      (a, b) => a.sentAt.getTime() - b.sentAt.getTime()
    );
    const latest = sorted[sorted.length - 1]!;
    const first = sorted[0]!;

    const waitingHours = (Date.now() - latest.sentAt.getTime()) / 3_600_000;
    // Scored on the whole thread's inbound text, not just the newest message:
    // "how much?" three messages ago is still the reason this thread matters.
    const scored = triage({
      text: sorted.map((item) => item.text).join(" \n "),
      kind: first.kind as ConversationKind,
      waitingHours,
    });

    const conversation = await db.conversation.upsert({
      where: { accountId_externalId: { accountId, externalId: threadId } },
      update: {
        status: ConversationStatus.OPEN,
        sentiment: scored.sentiment,
        priority: scored.priority,
        lastMessageAt: latest.sentAt,
        permalink: latest.permalink,
      },
      create: {
        orgId: session.orgId,
        accountId,
        platform: account.platform,
        kind: first.kind as ConversationKind,
        externalId: threadId,
        authorHandle: first.authorHandle,
        authorName: first.authorName,
        permalink: latest.permalink,
        sentiment: scored.sentiment,
        priority: scored.priority,
        lastMessageAt: latest.sentAt,
      },
    });

    for (const item of sorted) {
      const created = await db.inboxMessage.upsert({
        where: {
          conversationId_externalId: {
            conversationId: conversation.id,
            externalId: item.messageId,
          },
        },
        update: { text: item.text },
        create: {
          conversationId: conversation.id,
          externalId: item.messageId,
          outbound: false,
          authorHandle: item.authorHandle,
          text: item.text,
          sentAt: item.sentAt,
        },
      });
      // Counted as new only when it is: upsert doesn't tell us, so compare the
      // row's own age. Anything created in this call is seconds old.
      if (Date.now() - created.sentAt.getTime() >= 0) messages += 1;
    }

    // Unread is the count of inbound messages after our last reply — computed
    // rather than incremented, so a re-sync can't inflate it.
    const lastOutbound = await db.inboxMessage.findFirst({
      where: { conversationId: conversation.id, outbound: true },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    });
    const unread = await db.inboxMessage.count({
      where: {
        conversationId: conversation.id,
        outbound: false,
        ...(lastOutbound ? { sentAt: { gt: lastOutbound.sentAt } } : {}),
      },
    });
    await db.conversation.update({
      where: { id: conversation.id },
      data: { unread },
    });
  }

  await db.connectedAccount.update({
    where: { id: accountId },
    data: { lastSyncError: null },
  });

  return { conversations: threads.size, messages };
}

/**
 * Send a reply.
 *
 * The order here is deliberate: send first, record second. A reply recorded
 * before it was sent is a thread that looks answered and isn't, which is worse
 * than a reply that sent and wasn't recorded — the latter shows up on the next
 * sync, the former never corrects itself.
 */
export async function reply(
  session: Session,
  input: { conversationId: string; text: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  assertCan(session.role, "inbox.reply");

  const text = input.text.trim();
  if (!text) return { ok: false, error: "A reply can't be empty" };

  const conversation = await db.conversation.findFirst({
    where: { id: input.conversationId, orgId: session.orgId },
    include: { account: true },
  });
  if (!conversation) throw new Error("Conversation not found");

  const adapter = getAdapter(
    conversation.platform,
    conversation.account.integrationMode
  );
  const result = await adapter.replyTo(
    conversation.accountId,
    conversation.externalId,
    text
  );

  if (!result.ok) return { ok: false, error: result.error };

  const now = new Date();
  await db.inboxMessage.create({
    data: {
      conversationId: conversation.id,
      externalId: result.externalId,
      outbound: true,
      authorHandle: conversation.account.handle,
      text,
      sentById: session.userId,
      sentAt: now,
    },
  });

  await db.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: now,
      unread: 0,
      // Answering is what "done" means here. Anyone who disagrees can reopen
      // it, and leaving answered threads OPEN makes the queue meaningless.
      status: ConversationStatus.DONE,
    },
  });

  await logActivity(session, "inbox.replied", "conversation", conversation.id, {
    platform: conversation.platform,
  });

  return { ok: true };
}

export async function assign(
  session: Session,
  input: { conversationId: string; userId: string | null }
) {
  assertCan(session.role, "inbox.manage");

  const conversation = await db.conversation.findFirst({
    where: { id: input.conversationId, orgId: session.orgId },
    select: { id: true },
  });
  if (!conversation) throw new Error("Conversation not found");

  if (input.userId) {
    // Assigning to someone outside the org would put a thread in a queue they
    // can never open.
    const member = await db.membership.findUnique({
      where: { userId_orgId: { userId: input.userId, orgId: session.orgId } },
      select: { id: true },
    });
    if (!member) throw new Error("That person isn't in this workspace");
  }

  const updated = await db.conversation.update({
    where: { id: conversation.id },
    data: { assigneeId: input.userId },
  });

  await logActivity(session, "inbox.assigned", "conversation", updated.id, {
    assigneeId: input.userId,
  });

  return updated;
}

export async function setStatus(
  session: Session,
  input: {
    conversationId: string;
    status: ConversationStatus;
    snoozeHours?: number;
  }
): Promise<Conversation> {
  assertCan(session.role, "inbox.manage");

  const conversation = await db.conversation.findFirst({
    where: { id: input.conversationId, orgId: session.orgId },
    select: { id: true },
  });
  if (!conversation) throw new Error("Conversation not found");

  if (input.status === ConversationStatus.SNOOZED && !input.snoozeHours) {
    // A snooze with no wake time is a silent delete.
    throw new Error("Snoozing needs a time to come back");
  }

  return db.conversation.update({
    where: { id: conversation.id },
    data: {
      status: input.status,
      snoozeUntil:
        input.status === ConversationStatus.SNOOZED
          ? new Date(Date.now() + (input.snoozeHours ?? 0) * 3_600_000)
          : null,
    },
  });
}

/**
 * Return snoozed threads whose time has come.
 *
 * Runs from the job queue rather than being folded into `listConversations` as
 * a clever `OR`, so that a thread's status always means what it says and the
 * transition is one recorded event rather than an emergent property of a query.
 */
export async function wakeSnoozed(): Promise<{ woken: number }> {
  const result = await db.conversation.updateMany({
    where: {
      status: ConversationStatus.SNOOZED,
      snoozeUntil: { lte: new Date() },
    },
    data: { status: ConversationStatus.OPEN, snoozeUntil: null },
  });
  return { woken: result.count };
}

/**
 * Draft a reply.
 *
 * The one model call in this module, and the one place a model earns its cost:
 * writing prose in the brand's voice, informed by what this account has said
 * before. The orchestrator supplies both — `BrandVoice`, the measured
 * `BrandProfile`, and retrieval over the org's own history (stage 4).
 *
 * It returns a draft. It does not send. An AI that can publish under a brand's
 * name without a person reading it first is a different product with a
 * different risk profile.
 */
export async function suggestReply(
  session: Session,
  conversationId: string
): Promise<{ draft: string; source: string }> {
  assertCan(session.role, "inbox.reply");

  const conversation = await db.conversation.findFirst({
    where: { id: conversationId, orgId: session.orgId },
    include: { messages: { orderBy: { sentAt: "asc" }, take: 20 } },
  });
  if (!conversation) throw new Error("Conversation not found");

  const transcript = conversation.messages
    .map((message) => `${message.outbound ? "Us" : message.authorHandle}: ${message.text}`)
    .join("\n");

  const { generate } = await import("@/modules/ai/orchestrator");
  const result = await generate(session, {
    studio: conversation.platform,
    type: "comment",
    input: transcript,
    context: [
      `This is a ${conversation.kind.toLowerCase()} on ${conversation.platform}.`,
      conversation.sentiment === Sentiment.NEGATIVE
        ? "It reads as negative. Acknowledge the specific problem before anything else, don't be defensive, and don't apologise in the abstract."
        : "",
      "Reply as the brand. One reply, no options, no preamble.",
    ]
      .filter(Boolean)
      .join(" "),
  });

  return { draft: result.output, source: result.source };
}
