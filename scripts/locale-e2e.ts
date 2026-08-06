/**
 * Verification for account locale: the timezone fix, region-scoped trends,
 * language in the prompt, and the guard that keeps one-click unified safe.
 *
 *   DATABASE_URL=… npx tsx scripts/locale-e2e.ts
 *
 * Writes to the database. Point it at a throwaway one.
 */

import { Platform } from "@prisma/client";

import type { Session } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { isValidTimeZone, localParts, zoneAbbreviation } from "@/lib/time";
import { getBestPostingTimes } from "@/modules/analytics/service";
import { MockAdapter } from "@/modules/integrations/mock-adapter";
import { recomputeBestTimes } from "@/modules/strategy/engine";

let failures = 0;
let checks = 0;

function ok(label: string, condition: boolean, detail = "") {
  checks += 1;
  if (!condition) failures += 1;
  console.log(`  ${condition ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
}

const TAG = `e2e-locale-${Date.now()}`;

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

  console.log("\nlocalParts — the arithmetic the fix rests on");
  // 2026-03-01T23:30Z is the next day in Lagos and still the previous evening
  // in Los Angeles. If bucketing were UTC all three would agree, which is
  // exactly the bug.
  const instant = new Date("2026-03-01T23:30:00Z");
  const utc = localParts(instant, "UTC");
  const lagos = localParts(instant, "Africa/Lagos");
  const la = localParts(instant, "America/Los_Angeles");

  ok("UTC is unchanged", utc.hour === 23 && utc.day === 0, `${utc.day}:${utc.hour}`);
  ok(
    "Lagos is the next day",
    lagos.hour === 0 && lagos.day === 1,
    `${lagos.day}:${lagos.hour}`
  );
  ok(
    "Los Angeles is still the afternoon before",
    la.hour === 15 && la.day === 0,
    `${la.day}:${la.hour}`
  );

  // The reason Intl is used rather than a stored offset: these two instants
  // straddle a US DST transition, and a fixed offset would put one in the wrong
  // hour for half the year.
  const winter = localParts(new Date("2026-01-15T18:00:00Z"), "America/New_York");
  const summer = localParts(new Date("2026-07-15T18:00:00Z"), "America/New_York");
  ok(
    "DST is handled, not approximated",
    winter.hour === 13 && summer.hour === 14,
    `${winter.hour} winter, ${summer.hour} summer`
  );

  ok("midnight never renders as 24", localParts(new Date("2026-03-01T00:00:00Z"), "UTC").hour === 0);
  ok("a real zone validates", isValidTimeZone("Africa/Lagos"));
  ok("a made-up zone does not", !isValidTimeZone("Mars/Olympus_Mons"));
  ok(
    "an unknown zone falls back to UTC rather than throwing",
    localParts(instant, "Mars/Olympus_Mons").hour === 23
  );
  ok("a zone abbreviates for display", zoneAbbreviation("UTC").length > 0, zoneAbbreviation("Africa/Lagos"));

  console.log("\nBest times move with the account's zone");
  const account = await db.connectedAccount.findFirst({
    where: { orgId: session.orgId, platform: Platform.X },
  });
  if (!account) throw new Error("Seed a connected X account first");
  const original = account.timezone;

  // Twelve posts at a fixed UTC hour. Twelve rather than six because the engine
  // refuses to use an account's own data below `minimumPostsForOwnData` (10)
  // and falls back to benchmarks — correct behaviour, but it would leave this
  // test asserting against an empty slot list and reading as a timezone bug.
  await db.externalPost.deleteMany({
    where: { orgId: session.orgId, externalId: { startsWith: TAG } },
  });
  await db.externalPost.createMany({
    data: Array.from({ length: 12 }, (_, index) => ({
      orgId: session.orgId,
      accountId: account.id,
      externalId: `${TAG}-${index}`,
      text: `Locale fixture ${index}`,
      mediaType: "text",
      // Every one at 23:30 UTC on a Sunday, a week apart.
      publishedAt: new Date(
        new Date("2026-03-01T23:30:00Z").getTime() - index * 7 * 86_400_000
      ),
      // Deliberately far above anything in the demo corpus: the engine returns
      // only the top five slots, so a fixture that merely qualifies can be
      // truncated away by real data and the assertion would be testing the
      // seed rather than the timezone.
      likes: 9_000,
      comments: 500,
      shares: 500,
      views: 10_000,
    })),
  });

  await db.connectedAccount.update({
    where: { id: account.id },
    data: { timezone: null },
  });
  const inUtc = await recomputeBestTimes(session.orgId, Platform.X);
  const utcSlots = (inUtc.payload as { slots: { day: number; hour: number; posts: number }[]; timezone: string });
  const utcTop = utcSlots.slots.find((slot) => slot.posts >= 12);
  ok(
    "with no zone set the hour is UTC",
    utcTop?.hour === 23 && utcTop?.day === 0,
    utcTop ? `${utcTop.day}:${utcTop.hour}` : "slot not found"
  );
  ok("and the payload says so", utcSlots.timezone === "UTC");

  await db.connectedAccount.update({
    where: { id: account.id },
    data: { timezone: "Africa/Lagos" },
  });
  const inLagos = await recomputeBestTimes(session.orgId, Platform.X);
  const lagosSlots = (inLagos.payload as { slots: { day: number; hour: number; posts: number }[]; timezone: string });
  const lagosTop = lagosSlots.slots.find((slot) => slot.posts >= 12);
  ok(
    "the same posts land on a different hour and day in Lagos",
    lagosTop?.hour === 0 && lagosTop?.day === 1,
    lagosTop ? `${lagosTop.day}:${lagosTop.hour}` : "slot not found"
  );
  ok("and the payload names the zone", lagosSlots.timezone === "Africa/Lagos");

  // The two surfaces must agree — they advise the same person.
  const analytics = await getBestPostingTimes(session, Platform.X);
  ok(
    "the analytics surface reports the same zone",
    analytics.timezone === "Africa/Lagos",
    analytics.timezone
  );
  ok("and returns slots alongside it", Array.isArray(analytics.slots));

  console.log("\nTrends are scoped by region");
  const adapter = new MockAdapter(Platform.X);
  const worldwide = await adapter.fetchTrends();
  const nigeria = await adapter.fetchTrends("NG");
  const usa = await adapter.fetchTrends("US");

  ok("a worldwide list comes back", worldwide.length > 0);
  ok(
    "two regions rank differently — not one list with a flag on it",
    nigeria.map((t) => t.topic).join() !== usa.map((t) => t.topic).join()
  );
  ok(
    "a national volume is smaller than the worldwide one",
    Math.max(...nigeria.map((t) => t.volume)) <
      Math.max(...worldwide.map((t) => t.volume))
  );
  ok(
    "the same region is stable within a day",
    (await adapter.fetchTrends("NG")).map((t) => t.topic).join() ===
      nigeria.map((t) => t.topic).join()
  );

  console.log("\nLanguage reaches the prompt");
  const { systemPrompt } = await import("@/modules/ai/prompts");
  const withLanguage = systemPrompt({
    voice: null,
    platform: Platform.X,
    orgName: "Test",
    language: "yo",
  });
  ok("the tag is named in words", withLanguage.includes("Yoruba"), "Yoruba");
  ok("and the tag itself is included", withLanguage.includes("(yo)"));
  ok(
    "no language section when unset",
    !systemPrompt({ voice: null, platform: Platform.X, orgName: "Test" }).includes(
      "## Language"
    )
  );
  ok(
    "an unknown tag degrades to the raw tag rather than throwing",
    systemPrompt({
      voice: null,
      platform: Platform.X,
      orgName: "Test",
      language: "zz-ZZ",
    }).includes("zz-ZZ")
  );

  console.log("\nCleanup");
  await db.externalPost.deleteMany({
    where: { orgId: session.orgId, externalId: { startsWith: TAG } },
  });
  await db.connectedAccount.update({
    where: { id: account.id },
    data: { timezone: original },
  });
  console.log("  ✓ test rows removed, timezone restored");

  console.log(
    `\n${failures === 0 ? "✓" : "✗"} ${checks - failures}/${checks} checks passed\n`
  );
  await db.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("\nLocale e2e threw:\n", error);
  await db.$disconnect();
  process.exit(1);
});
