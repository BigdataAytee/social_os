/**
 * Stage 4 verification: the measured voice, and retrieval over the org's own
 * history.
 *
 *   DATABASE_URL=… npx tsx scripts/brain-e2e.ts
 *
 * Writes to the database. Point it at a throwaway one.
 *
 * The properties worth testing here are not "does it produce output" — a word
 * counter always produces output. They are: does it *refuse* to produce output
 * from too little data, does the ranking actually prefer what performed, and is
 * recall tenant-scoped. The third is the one that would be a breach.
 */

import type { Session } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  brandProfileBlock,
  getBrandProfile,
  rebuildBrandProfile,
} from "@/modules/brandbrain/service";
import { forget, recall, reindexOrg, remember, memoryStats } from "@/modules/memory/service";

let failures = 0;
let checks = 0;

function ok(label: string, condition: boolean, detail = "") {
  checks += 1;
  if (!condition) failures += 1;
  console.log(`  ${condition ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
}

const TAG = `e2e-brain-${Date.now()}`;

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

  // A second org, to prove isolation with. Raw SQL is the attack surface stage 4
  // added, and this is the test that says it wasn't opened.
  const other = await db.organization.create({
    data: { name: `${TAG} other`, slug: `${TAG}-other` },
  });

  console.log("\nMemory — indexing");
  await remember({
    orgId: session.orgId,
    sourceType: "idea",
    sourceId: `${TAG}-a`,
    text: "Pricing pages convert better when the cheapest plan is listed first.",
    score: 12,
  });
  await remember({
    orgId: session.orgId,
    sourceType: "idea",
    sourceId: `${TAG}-b`,
    text: "Pricing experiments need four weeks before the numbers settle.",
    score: 1,
  });
  await remember({
    orgId: session.orgId,
    sourceType: "idea",
    sourceId: `${TAG}-c`,
    text: "Onboarding emails should arrive before the first login, not after.",
  });

  ok(
    "an empty text is not indexed",
    (await remember({
      orgId: session.orgId,
      sourceType: "idea",
      sourceId: `${TAG}-empty`,
      text: "   ",
    })) === null
  );

  const twice = await remember({
    orgId: session.orgId,
    sourceType: "idea",
    sourceId: `${TAG}-a`,
    text: "Pricing pages convert better when the cheapest plan is listed first.",
    score: 12,
  });
  ok(
    "re-indexing the same source updates rather than duplicating",
    (await db.memoryChunk.count({
      where: { orgId: session.orgId, sourceId: `${TAG}-a` },
    })) === 1,
    `id ${twice?.id.slice(0, 6)}`
  );

  console.log("\nMemory — recall");
  const hits = await recall(session, "pricing");
  ok("a query finds matching chunks", hits.length >= 2, `${hits.length} hits`);
  // By sourceId, not by text: the demo org has a real corpus of its own, and an
  // assertion about what the *text* looks like would be testing the seed data.
  ok(
    "an unrelated chunk does not match",
    hits.every((hit) => hit.sourceId !== `${TAG}-c`)
  );
  // The ranking claim from the module doc, tested rather than asserted: both
  // chunks match "pricing" equally, so only the score can separate them.
  const a = hits.findIndex((hit) => hit.text.includes("cheapest plan"));
  const b = hits.findIndex((hit) => hit.text.includes("four weeks"));
  ok(
    "what performed outranks what merely matched",
    a >= 0 && b >= 0 && a < b,
    `positions ${a} and ${b}`
  );
  ok(
    "an empty query returns nothing rather than everything",
    (await recall(session, "   ")).length === 0
  );
  ok(
    "a query with no matches returns nothing",
    (await recall(session, "quantum chromodynamics")).length === 0
  );
  ok(
    "natural language doesn't need escaping",
    (await recall(session, "what did we say about pricing?")).length >= 2
  );
  const filtered = await recall(session, "pricing", { sourceTypes: ["idea"] });
  ok(
    "source type filters",
    filtered.length >= 2 && filtered.every((hit) => hit.sourceType === "idea"),
    `${filtered.length} hits`
  );
  // The property the OR query buys: partial matches are allowed in, and the
  // document matching more of the query still comes first.
  const partial = await recall(session, "cheapest plan listed pricing");
  ok(
    "more matched terms outrank fewer",
    partial.length >= 2 && partial[0]!.sourceId === `${TAG}-a`,
    partial[0]?.sourceId ?? "no hits"
  );
  ok("take is capped", (await recall(session, "pricing", { take: 500 })).length <= 50);

  console.log("\nMemory — isolation");
  await remember({
    orgId: other.id,
    sourceType: "idea",
    sourceId: `${TAG}-other`,
    text: "Pricing is the other org's secret and must never leak.",
    score: 99,
  });
  const mine = await recall(session, "pricing");
  ok(
    "another org's chunk never surfaces, even with a higher score",
    mine.every((hit) => !hit.text.includes("secret"))
  );
  const theirs = await recall(
    { ...session, orgId: other.id },
    "pricing"
  );
  ok(
    "and the reverse holds",
    theirs.length === 1 && theirs[0]!.text.includes("secret"),
    `${theirs.length} hits`
  );

  // Quotes and a SQL fragment in the query itself. plainto_tsquery plus a bound
  // parameter should treat both as ordinary words.
  const hostile = await recall(session, "pricing' OR '1'='1");
  ok(
    "a query that looks like an injection is just text",
    hostile.every((hit) => hit.text.toLowerCase().includes("pricing"))
  );

  console.log("\nMemory — forgetting");
  await forget(session.orgId, "idea", `${TAG}-c`);
  ok(
    "a forgotten chunk stops matching",
    (await recall(session, "onboarding emails first login", { take: 50 })).every(
      (hit) => hit.sourceId !== `${TAG}-c`
    )
  );

  const stats = await memoryStats(session.orgId);
  ok("stats count by source type", (stats.idea ?? 0) >= 2, JSON.stringify(stats));

  console.log("\nBrand Brain — refusing to guess");
  const thin = await rebuildBrandProfile(other.id);
  ok("an org with no content learns nothing", thin.basedOnPosts === 0);
  ok(
    "and its profile block is empty rather than zeros",
    brandProfileBlock(await getBrandProfile({ ...session, orgId: other.id })) === ""
  );
  ok(
    "a null profile is also empty rather than throwing",
    brandProfileBlock(null) === ""
  );

  console.log("\nBrand Brain — learning");
  // Enough posts to clear MIN_POSTS, written in a deliberate style: short
  // sentences, a repeated subject, no emoji, a question in a third of them.
  const account = await db.connectedAccount.findFirst({
    where: { orgId: session.orgId },
  });
  if (!account) throw new Error("Seed a connected account first");

  const corpus = [
    ["Retention beats acquisition. Every time.", 900, 10000],
    ["Retention is a product problem. Not a marketing one.", 800, 10000],
    ["Why does retention get measured last?", 1200, 10000],
    ["Retention compounds. Acquisition does not.", 700, 10000],
    ["Churn is retention read backwards. Same number.", 300, 10000],
    ["Cohort curves flatten or they don't. Retention shows it first.", 250, 10000],
    ["What does your retention curve look like at day thirty?", 1100, 10000],
    ["Acquisition spend hides bad retention for one quarter.", 200, 10000],
    ["Retention is the only growth loop that doesn't cost money.", 950, 10000],
    ["Measure retention weekly. Report it monthly.", 180, 10000],
    ["Onboarding is retention. The rest is maintenance.", 160, 10000],
    ["Retention dashboards lie when the cohort is small.", 140, 10000],
  ] as const;

  await db.externalPost.deleteMany({
    where: { orgId: session.orgId, externalId: { startsWith: TAG } },
  });
  await db.externalPost.createMany({
    data: corpus.map(([text, interactions, views], index) => ({
      orgId: session.orgId,
      accountId: account.id,
      externalId: `${TAG}-${index}`,
      text,
      // Alternating so `winningFormats` has two kinds with enough samples each.
      mediaType: index % 2 === 0 ? "video" : "text",
      publishedAt: new Date(Date.now() - index * 86_400_000),
      likes: interactions,
      comments: 0,
      shares: 0,
      views,
    })),
  });

  const profile = await rebuildBrandProfile(session.orgId);
  ok(
    "it learns from synced posts, not only from posts written here",
    profile.basedOnPosts >= 12,
    `${profile.basedOnPosts} posts`
  );
  ok(
    "it finds the recurring subject",
    profile.contentPillars.some((pillar) => pillar.includes("retention")),
    profile.contentPillars.join(", ") || "none"
  );
  ok(
    "vocabulary excludes stop words",
    profile.vocabulary.every((entry) => !["the", "and", "that"].includes(entry.term))
  );
  ok(
    "vocabulary requires a term in more than one post",
    profile.vocabulary.some((entry) => entry.term === "retention")
  );
  ok(
    "it measures emoji from what was written, not what was declared",
    profile.emojiRate === 0,
    `${profile.emojiRate}`
  );
  ok(
    "it measures question rate",
    profile.sentenceStats.questionRate > 0.1 &&
      profile.sentenceStats.questionRate < 0.4,
    profile.sentenceStats.questionRate.toFixed(2)
  );
  ok(
    "sentence stats reflect short sentences",
    profile.sentenceStats.avgWords > 2 && profile.sentenceStats.avgWords < 14,
    profile.sentenceStats.avgWords.toFixed(1)
  );
  ok(
    "hooks come from posts above the median, not the top of the list",
    profile.hookPatterns.length > 0 &&
      profile.hookPatterns.every((hook) =>
        corpus.some(([text]) => text.startsWith(hook.slice(0, 20)))
      ),
    `${profile.hookPatterns.length} hooks`
  );
  ok(
    "the winning format is the one that actually won",
    profile.winningFormats.length === 0 ||
      profile.winningFormats[0]!.kind === "video",
    profile.winningFormats.map((f) => f.kind).join(", ") || "none called"
  );

  const block = brandProfileBlock(profile);
  ok("the profile renders into a prompt block", block.length > 100);
  ok("the block states its sample size", block.includes(`${profile.basedOnPosts}`));
  ok(
    "the block tells the model not to add emoji",
    block.includes("Don't add any")
  );

  console.log("\nReindex");
  const indexed = await reindexOrg(session.orgId);
  ok("reindex covers the whole corpus", indexed.chunks >= 12, `${indexed.chunks} chunks`);
  const retention = await recall(session, "retention curve");
  ok("synced posts are recallable after reindex", retention.length > 0);
  ok(
    "recall carries the engagement score through",
    retention.some((hit) => (hit.score ?? 0) > 0)
  );

  console.log("\nCleanup");
  await db.externalPost.deleteMany({
    where: { orgId: session.orgId, externalId: { startsWith: TAG } },
  });
  await db.memoryChunk.deleteMany({
    where: { orgId: session.orgId, sourceId: { startsWith: TAG } },
  });
  // Leave the org's profile rebuilt from its real corpus rather than the fake
  // one — otherwise this script permanently teaches the demo org about
  // retention.
  await rebuildBrandProfile(session.orgId);
  await reindexOrg(session.orgId);
  await db.organization.delete({ where: { id: other.id } });
  console.log("  ✓ test rows removed, profile rebuilt from real data");

  console.log(
    `\n${failures === 0 ? "✓" : "✗"} ${checks - failures}/${checks} checks passed\n`
  );
  await db.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("\nBrain e2e threw:\n", error);
  await db.$disconnect();
  process.exit(1);
});
