/**
 * Stage 6 verification: monitors, mentions, and the competitor comparisons that
 * are only worth showing when the samples support them.
 *
 *   DATABASE_URL=… npx tsx scripts/listening-e2e.ts
 *
 * Writes to the database. Point it at a throwaway one.
 */

import { MentionSource, MonitorKind, Platform, Sentiment } from "@prisma/client";

import type { Session } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { extractTerms } from "@/modules/brandbrain/terms";
import {
  addCompetitor,
  benchmark,
  contentGaps,
  listCompetitorSummaries,
  removeCompetitor,
  syncCompetitor,
  topCompetitorPosts,
} from "@/modules/competitors/service";
import {
  createMonitor,
  deleteMonitor,
  listMentions,
  listMonitors,
  scanMonitors,
  sentimentBreakdown,
  setMonitorActive,
  shareOfVoice,
} from "@/modules/listening/service";

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

const TAG = `e2e-listen-${Date.now()}`;
const TERM = `zibbleflux${Date.now().toString(36)}`;

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

  const account = await db.connectedAccount.findFirst({
    where: { orgId: session.orgId, platform: Platform.X },
  });
  if (!account) throw new Error("Seed a connected X account first");

  console.log("\nTerm extraction — shared with the brand profile");
  const terms = extractTerms([
    "Retention is a product problem, not a marketing one.",
    "Retention compounds over time and acquisition does not.",
    "Our retention curve flattened at day thirty this quarter.",
    "Churn is retention read backwards, same underlying number.",
    "Measuring retention weekly changed how the team plans.",
  ]);
  ok("it finds the recurring subject", terms.some((t) => t.term.includes("retention")),
    terms.map((t) => t.term).join(", ") || "none");
  ok(
    "and nothing is a stop word",
    terms.every((t) => !["the", "and", "that", "this"].includes(t.term))
  );
  ok("too small a corpus yields nothing", extractTerms(["one", "two"]).length === 0);
  ok(
    "overlapping terms are collapsed",
    // "retention" and "retention curve" must not both survive.
    terms.filter((t) => t.term.startsWith("retention")).length <= 1,
    terms.filter((t) => t.term.startsWith("retention")).map((t) => t.term).join(", ")
  );

  console.log("\nMonitors — validation");
  await throws("a one-character monitor is refused", () =>
    createMonitor(session, { term: "x" })
  );
  await throws("a monitor of pure punctuation is refused", () =>
    createMonitor(session, { term: "!!!" })
  );

  console.log("\nMonitors — matching");
  // A nonsense term so nothing in the demo corpus matches by accident, planted
  // in exactly two places we control.
  const conversation = await db.conversation.create({
    data: {
      orgId: session.orgId,
      accountId: account.id,
      platform: Platform.X,
      kind: "COMMENT",
      externalId: `${TAG}-conv`,
      authorHandle: "@e2e_asker",
      lastMessageAt: new Date(),
      messages: {
        create: {
          externalId: `${TAG}-msg`,
          outbound: false,
          authorHandle: "@e2e_asker",
          text: `Do you have ${TERM} pricing? Really disappointed I can't find it.`,
          sentAt: new Date(),
        },
      },
    },
  });

  const ownPost = await db.externalPost.create({
    data: {
      orgId: session.orgId,
      accountId: account.id,
      externalId: `${TAG}-own`,
      text: `We shipped ${TERM} this week. Thanks to everyone who tested it.`,
      mediaType: "text",
      publishedAt: new Date(),
      likes: 400,
      comments: 20,
      shares: 30,
      views: 10_000,
    },
  });

  const monitor = await createMonitor(session, {
    term: TERM,
    kind: MonitorKind.BRAND,
  });
  ok("a monitor is created lowercased", monitor.term === TERM.toLowerCase());

  const scan = await scanMonitors(session.orgId);
  ok("a scan runs every active monitor", scan.scanned >= 1, `${scan.scanned}`);

  const mentions = await listMentions(session, { monitorId: monitor.id });
  ok("it matches both corpora", mentions.length === 2, `${mentions.length} mentions`);
  ok(
    "an inbox mention is labelled as one",
    mentions.some((m) => m.source === MentionSource.INBOX)
  );
  ok(
    "and our own post as our own",
    mentions.some((m) => m.source === MentionSource.OWN_POST)
  );
  ok(
    "the complaint is scored negative",
    mentions.find((m) => m.source === MentionSource.INBOX)?.sentiment ===
      Sentiment.NEGATIVE
  );
  ok(
    "our own thank-you is scored positive",
    mentions.find((m) => m.source === MentionSource.OWN_POST)?.sentiment ===
      Sentiment.POSITIVE
  );
  ok(
    "sorted by reach, not recency",
    mentions[0]!.reach >= mentions[1]!.reach,
    `${mentions[0]!.reach} then ${mentions[1]!.reach}`
  );

  // The property a scheduled rescan depends on.
  await scanMonitors(session.orgId);
  ok(
    "a rescan updates rather than duplicating",
    (await listMentions(session, { monitorId: monitor.id })).length === 2
  );

  const paused = await setMonitorActive(session, {
    id: monitor.id,
    active: false,
  });
  ok("a monitor can be paused", paused.active === false);
  const afterPause = await scanMonitors(session.orgId);
  ok(
    "and a paused monitor is skipped",
    afterPause.scanned === scan.scanned - 1,
    `${afterPause.scanned} vs ${scan.scanned}`
  );
  await setMonitorActive(session, { id: monitor.id, active: true });

  const breakdown = await sentimentBreakdown(session, monitor.id);
  ok("sentiment is broken down", breakdown.total === 2, `${breakdown.total}`);
  ok(
    "net is zero with one of each",
    breakdown.net === 0,
    `${breakdown.net}`
  );
  ok(
    "an empty monitor reports null rather than zero",
    (await sentimentBreakdown(session, "no-such-monitor")).net === null
  );

  const summaries = await listMonitors(session);
  ok(
    "monitor summaries count their mentions",
    summaries.find((m) => m.id === monitor.id)?.mentions === 2
  );
  ok(
    "and count the negative ones separately",
    summaries.find((m) => m.id === monitor.id)?.negative === 1
  );

  console.log("\nCompetitors");
  await db.competitor.deleteMany({
    where: { orgId: session.orgId, handle: { startsWith: "e2erival" } },
  });

  const rival = await addCompetitor(session, {
    platform: Platform.X,
    handle: "@e2erival_one",
  });
  ok("the @ is stripped from a handle", rival.handle === "e2erival_one");

  const synced = await syncCompetitor(session, rival.id);
  ok("their posts are pulled", synced.posts > 0, `${synced.posts} posts`);

  const resynced = await syncCompetitor(session, rival.id);
  ok(
    "a resync updates rather than duplicating",
    (await db.competitorPost.count({ where: { competitorId: rival.id } })) ===
      synced.posts,
    `${resynced.posts} returned`
  );

  // By id, not the first row: the demo org already tracks competitors of its
  // own, and asserting against whichever sorted first would be testing the seed.
  const summary = (await listCompetitorSummaries(session, Platform.X)).find(
    (row) => row.id === rival.id
  );
  ok("a summary reports cadence", (summary?.cadence ?? 0) > 0,
    `${summary?.cadence.toFixed(2)}/week`);
  ok("and an engagement rate", (summary?.engagementRate ?? 0) > 0,
    `${summary?.engagementRate.toFixed(1)}%`);
  ok("with the sync recorded", summary?.lastSyncAt !== null);
  ok("and no error", summary?.lastSyncError === null);

  const top = await topCompetitorPosts(session, { take: 3 });
  ok("their best posts are ranked by rate", top.length > 0 &&
    top.every((post, i) => i === 0 || top[i - 1]!.rate >= post.rate));

  console.log("\nBenchmarking — refusing to compare on nothing");
  // Give our own side enough posts to be measured. The demo org has fewer than
  // the floor on any single platform, and a benchmark from three posts is
  // exactly what `thin` exists to withhold — so the fixture supplies six rather
  // than the threshold being lowered to fit the seed.
  await db.externalPost.createMany({
    data: Array.from({ length: 6 }, (_, index) => ({
      orgId: session.orgId,
      accountId: account.id,
      externalId: `${TAG}-ours-${index}`,
      text: `Our own post number ${index} about shipping and measurement.`,
      mediaType: index % 2 === 0 ? "text" : "image",
      publishedAt: new Date(Date.now() - index * 86_400_000),
      likes: 200 + index * 20,
      comments: 10,
      shares: 5,
      views: 8_000,
    })),
  });

  const empty = await benchmark(session, Platform.TIKTOK);
  ok(
    "a platform with no competitor data is thin",
    empty.thin,
    `${empty.ourSample} ours, ${empty.theirSample} theirs`
  );

  const compared = await benchmark(session, Platform.X);
  ok(
    "with data on both sides it compares",
    !compared.thin,
    `${compared.ourSample} ours, ${compared.theirSample} theirs`
  );
  ok("their rate is computed", compared.theirs > 0, `${compared.theirs.toFixed(1)}%`);
  ok("cadence is per competitor, not summed", compared.theirCadence > 0 &&
    compared.theirCadence < 20, `${compared.theirCadence.toFixed(1)}/week`);
  ok(
    "their best format is against their own average",
    compared.theirBestFormat === null || compared.theirBestFormat.lift > 0,
    compared.theirBestFormat
      ? `${compared.theirBestFormat.kind} +${compared.theirBestFormat.lift.toFixed(0)}%`
      : "none called"
  );

  console.log("\nContent gaps");
  const gaps = await contentGaps(session, Platform.X);
  ok("gaps are found", gaps.length > 0, gaps.map((g) => g.term).join(", ") || "none");
  ok(
    "every gap outperformed their own average",
    gaps.every((gap) => gap.theirRate > 0)
  );
  ok(
    "and none is a subject we already cover",
    await (async () => {
      const ours = await db.externalPost.findMany({
        where: { orgId: session.orgId },
        select: { text: true },
      });
      const ourTerms = new Set(
        extractTerms(ours.map((p) => p.text)).map((t) => t.term)
      );
      return gaps.every((gap) => !ourTerms.has(gap.term));
    })()
  );

  console.log("\nShare of voice");
  const voice = await shareOfVoice(session, monitor.id);
  ok("share of voice is computed", voice.length > 0, `${voice.length} voices`);
  ok(
    "shares sum to one",
    Math.abs(voice.reduce((sum, v) => sum + v.share, 0) - 1) < 0.01,
    voice.reduce((sum, v) => sum + v.share, 0).toFixed(3)
  );
  ok("ours is marked as ours", voice.some((v) => v.own));

  console.log("\nIsolation");
  const other = await db.organization.create({
    data: { name: `${TAG} other`, slug: `${TAG}-other` },
  });
  const outsider: Session = { ...session, orgId: other.id };
  ok(
    "another org sees none of these mentions",
    (await listMentions(outsider)).length === 0
  );
  ok(
    "or these monitors",
    (await listMonitors(outsider)).length === 0
  );
  ok(
    "or these competitors",
    (await listCompetitorSummaries(outsider)).length === 0
  );
  await throws("and cannot sync a competitor it doesn't own", () =>
    syncCompetitor(outsider, rival.id)
  );
  await throws("or delete a monitor it doesn't own", () =>
    deleteMonitor(outsider, monitor.id)
  );

  console.log("\nCleanup");
  await deleteMonitor(session, monitor.id);
  ok(
    "deleting a monitor takes its mentions with it",
    (await db.mention.count({ where: { monitorId: monitor.id } })) === 0
  );
  await removeCompetitor(session, rival.id);
  ok(
    "and removing a competitor takes their posts",
    (await db.competitorPost.count({ where: { competitorId: rival.id } })) === 0
  );
  await db.conversation.delete({ where: { id: conversation.id } });
  await db.externalPost.delete({ where: { id: ownPost.id } });
  await db.externalPost.deleteMany({
    where: { orgId: session.orgId, externalId: { startsWith: `${TAG}-ours-` } },
  });
  await db.organization.delete({ where: { id: other.id } });
  console.log("  ✓ test rows removed");

  console.log(
    `\n${failures === 0 ? "✓" : "✗"} ${checks - failures}/${checks} checks passed\n`
  );
  await db.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("\nListening e2e threw:\n", error);
  await db.$disconnect();
  process.exit(1);
});
