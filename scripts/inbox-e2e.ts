/**
 * Stage 5 verification: triage, the queue, and the one thing an inbox must
 * never do — say a reply was sent when it wasn't.
 *
 *   DATABASE_URL=… npx tsx scripts/inbox-e2e.ts
 *
 * Writes to the database. Point it at a throwaway one.
 */

import {
  ConversationKind,
  ConversationStatus,
  Platform,
  Role,
  Sentiment,
} from "@prisma/client";

import { can } from "@/lib/auth/permissions";
import type { Session } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  assign,
  getConversation,
  inboxCounts,
  listConversations,
  reply,
  setStatus,
  syncInbox,
  wakeSnoozed,
} from "@/modules/inbox/service";
import { priorityBand, triage } from "@/modules/inbox/triage";

let failures = 0;
let checks = 0;

function ok(label: string, condition: boolean, detail = "") {
  checks += 1;
  if (!condition) failures += 1;
  console.log(`  ${condition ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
}

async function throws(label: string, fn: () => Promise<unknown>) {
  checks += 1;
  try {
    await fn();
    failures += 1;
    console.log(`  ✗ ${label} — expected a rejection, got none`);
  } catch (error) {
    console.log(
      `  ✓ ${label} — ${(error instanceof Error ? error.message : String(error)).slice(0, 60)}`
    );
  }
}

const TAG = `e2e-inbox-${Date.now()}`;

async function main() {
  const membership = await db.membership.findFirst({
    where: { role: "OWNER", org: { slug: "northwind" } },
    include: { org: true, user: true },
  });
  if (!membership) throw new Error("Seed the northwind demo org first");

  const session: Session = {
    userId: membership.userId,
    email: membership.user.email,
    name: null,
    avatarUrl: null,
    orgId: membership.orgId,
    orgName: membership.org.name,
    orgSlug: membership.org.slug,
    role: membership.role,
  };

  console.log("\nTriage — sentiment");
  ok(
    "a complaint reads as negative",
    triage({
      text: "This didn't work for us at all. Really disappointed.",
      kind: ConversationKind.COMMENT,
    }).sentiment === Sentiment.NEGATIVE
  );
  ok(
    "praise reads as positive",
    triage({
      text: "Genuinely useful, thanks for writing it up.",
      kind: ConversationKind.COMMENT,
    }).sentiment === Sentiment.POSITIVE
  );
  ok(
    "a plain question is neutral",
    triage({
      text: "What tool are you using for the charts?",
      kind: ConversationKind.COMMENT,
    }).sentiment === Sentiment.NEUTRAL
  );

  console.log("\nTriage — priority ordering");
  const lead = triage({
    text: "Do you offer this as a service? Would like to talk about pricing.",
    kind: ConversationKind.DM,
  });
  const praise = triage({ text: "🔥 love this", kind: ConversationKind.COMMENT });
  const complaint = triage({
    text: "Third time I've asked and still no reply. Unacceptable.",
    kind: ConversationKind.COMMENT,
  });
  const spam = triage({
    text: "Check my profile, free followers, dm me for crypto",
    kind: ConversationKind.COMMENT,
  });
  const question = triage({
    text: "Wait, how does this work if the team is remote?",
    kind: ConversationKind.COMMENT,
  });

  // The whole justification for not sorting by recency: this ordering is what
  // the inbox claims to know, so it is what gets tested.
  ok("a sales enquiry outranks praise", lead.priority > praise.priority,
    `${lead.priority} vs ${praise.priority}`);
  ok("a complaint outranks praise", complaint.priority > praise.priority,
    `${complaint.priority} vs ${praise.priority}`);
  ok("a question outranks praise", question.priority > praise.priority,
    `${question.priority} vs ${praise.priority}`);
  ok("spam sinks below everything", spam.priority < praise.priority,
    `${spam.priority} vs ${praise.priority}`);
  ok("a sales enquiry lands in the high band", priorityBand(lead.priority) === "high",
    `${lead.priority}`);
  ok("praise does not", priorityBand(praise.priority) !== "high");
  ok("priority is bounded to 0–100",
    [lead, praise, complaint, spam, question].every(
      (t) => t.priority >= 0 && t.priority <= 100
    ));
  ok("every score explains itself", lead.reasons.length > 0,
    lead.reasons.join(", "));

  const waited = triage({
    text: "What tool are you using?",
    kind: ConversationKind.COMMENT,
    waitingHours: 72,
  });
  ok(
    "age raises priority",
    waited.priority > question.priority,
    `${waited.priority} vs ${question.priority}`
  );
  const ancient = triage({
    text: "What tool are you using?",
    kind: ConversationKind.COMMENT,
    waitingHours: 24 * 90,
  });
  ok(
    "but age is bounded — three months is not 90× urgent",
    ancient.priority - question.priority <= 20,
    `+${ancient.priority - question.priority}`
  );

  console.log("\nRole gating");
  ok("OWNER can reply", can(Role.OWNER, "inbox.reply"));
  ok("EDITOR can reply", can(Role.EDITOR, "inbox.reply"));
  ok(
    "a CREATOR cannot speak as the brand",
    !can(Role.CREATOR, "inbox.reply")
  );
  ok("a VIEWER cannot reply", !can(Role.VIEWER, "inbox.reply"));
  ok("a CLIENT cannot reply", !can(Role.CLIENT, "inbox.reply"));
  ok(
    "internal commenting is still separate from replying",
    can(Role.VIEWER, "comment.write") && !can(Role.VIEWER, "inbox.reply")
  );

  console.log("\nSync");
  const account = await db.connectedAccount.findFirst({
    where: { orgId: session.orgId, platform: Platform.X },
  });
  if (!account) throw new Error("Seed a connected X account first");

  await db.conversation.deleteMany({ where: { accountId: account.id } });

  const first = await syncInbox(session, account.id);
  ok("a sync finds conversations", first.conversations > 0,
    `${first.conversations} conversations, ${first.messages} messages`);

  const second = await syncInbox(session, account.id);
  const total = await db.conversation.count({ where: { accountId: account.id } });
  ok(
    "a second sync updates rather than duplicating",
    total === first.conversations,
    `${total} rows after ${first.conversations} + ${second.conversations}`
  );

  console.log("\nThe queue");
  const queue = await listConversations(session);
  ok("conversations are listed", queue.length > 0, `${queue.length}`);
  ok(
    "sorted by priority, not recency",
    queue.every((c, i) => i === 0 || queue[i - 1]!.priority >= c.priority)
  );
  ok(
    "every row carries a band",
    queue.every((c) => ["high", "medium", "low"].includes(c.band))
  );
  ok(
    "unread is set on a never-answered thread",
    queue.some((c) => c.unread > 0)
  );

  const counts = await inboxCounts(session);
  ok("counts agree with the queue", counts.open === queue.length,
    `${counts.open} vs ${queue.length}`);
  ok("unassigned counts everything nobody owns", counts.unassigned === counts.open);

  const target = queue[0]!;
  const opened = await getConversation(session, target.id);
  ok("opening a thread returns its messages", opened.messages.length > 0);
  ok(
    "and marks it read",
    (await db.conversation.findUnique({ where: { id: target.id } }))?.unread === 0
  );

  console.log("\nIsolation");
  const other = await db.organization.create({
    data: { name: `${TAG} other`, slug: `${TAG}-other` },
  });
  const outsider: Session = { ...session, orgId: other.id };
  ok(
    "another org sees none of these conversations",
    (await listConversations(outsider)).length === 0
  );
  await throws("and cannot open one by id", () =>
    getConversation(outsider, target.id)
  );
  await throws("or sync an account it doesn't own", () =>
    syncInbox(outsider, account.id)
  );

  console.log("\nAssignment and status");
  await throws("assigning to a non-member is refused", () =>
    assign(session, { conversationId: target.id, userId: "nobody-at-all" })
  );
  const assigned = await assign(session, {
    conversationId: target.id,
    userId: session.userId,
  });
  ok("a member can be assigned", assigned.assigneeId === session.userId);
  ok(
    "mine now counts it",
    (await inboxCounts(session)).mine === 1
  );

  await throws("a snooze with no wake time is refused", () =>
    setStatus(session, {
      conversationId: target.id,
      status: ConversationStatus.SNOOZED,
    })
  );

  await setStatus(session, {
    conversationId: target.id,
    status: ConversationStatus.SNOOZED,
    snoozeHours: 24,
  });
  ok(
    "a snoozed thread leaves the open queue",
    (await listConversations(session, { status: ConversationStatus.OPEN })).every(
      (c) => c.id !== target.id
    )
  );

  // Wind the clock back rather than waiting a day.
  await db.conversation.update({
    where: { id: target.id },
    data: { snoozeUntil: new Date(Date.now() - 1000) },
  });
  const woken = await wakeSnoozed();
  ok("a snooze that has expired comes back", woken.woken >= 1, `${woken.woken}`);
  ok(
    "and is OPEN again with no snooze time left on it",
    (await db.conversation.findUnique({ where: { id: target.id } }))?.status ===
      ConversationStatus.OPEN
  );

  console.log("\nReplying");
  const replied = await reply(session, {
    conversationId: target.id,
    text: "Thanks for flagging this — here's what we're doing about it.",
  });
  ok("a reply through the mock adapter sends", replied.ok === true);

  const afterReply = await db.conversation.findUnique({
    where: { id: target.id },
    include: { messages: { orderBy: { sentAt: "desc" }, take: 1 } },
  });
  ok("the reply is recorded outbound", afterReply?.messages[0]?.outbound === true);
  ok("attributed to the person who sent it",
    afterReply?.messages[0]?.sentById === session.userId);
  ok("and the thread is closed", afterReply?.status === ConversationStatus.DONE);
  ok("with nothing unread", afterReply?.unread === 0);

  ok(
    "an empty reply is refused",
    (await reply(session, { conversationId: target.id, text: "   " })).ok === false
  );

  // The property that matters most: a refusal must not leave a recorded reply.
  //
  // Getting a genuine refusal takes some setup, and the setup is itself worth
  // stating: the registry only hands back a DIRECT adapter when direct is
  // *available*, so merely setting the column falls back to the mock and the
  // reply succeeds. That is the registry working correctly. Credentials and an
  // encryption key have to be present for the read-only path to be reached at
  // all — no network call follows, because LiveAdapter refuses before making
  // one.
  process.env.X_CLIENT_ID ??= "e2e-client";
  process.env.X_CLIENT_SECRET ??= "e2e-secret";
  process.env.SOCIALOS_ENCRYPTION_KEY ??= Buffer.from(
    "e2e-inbox-key-32-bytes-exactly!!"
  ).toString("base64");

  const before = await db.inboxMessage.count({
    where: { conversation: { id: target.id }, outbound: true },
  });
  await db.connectedAccount.update({
    where: { id: account.id },
    data: { integrationMode: "DIRECT" },
  });
  const refused = await reply(session, {
    conversationId: target.id,
    text: "This one should not go anywhere.",
  });
  ok("a read-only connection refuses clearly", refused.ok === false,
    refused.ok ? "" : refused.error.slice(0, 50));
  ok(
    "and records nothing — a thread must never look answered when it isn't",
    (await db.inboxMessage.count({
      where: { conversation: { id: target.id }, outbound: true },
    })) === before
  );

  console.log("\nCleanup");
  await db.connectedAccount.update({
    where: { id: account.id },
    data: { integrationMode: account.integrationMode },
  });
  await db.conversation.deleteMany({ where: { accountId: account.id } });
  await db.organization.delete({ where: { id: other.id } });
  console.log("  ✓ test rows removed");

  console.log(
    `\n${failures === 0 ? "✓" : "✗"} ${checks - failures}/${checks} checks passed\n`
  );
  await db.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("\nInbox e2e threw:\n", error);
  await db.$disconnect();
  process.exit(1);
});
