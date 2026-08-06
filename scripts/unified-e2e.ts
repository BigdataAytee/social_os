/**
 * Step 2 verification: the registry resolves per account, and the unified
 * adapter pulls and publishes for real (Platform-Connections.md §4).
 *
 *   DATABASE_URL=… npx tsx scripts/unified-e2e.ts
 *
 * Writes to the database. Point it at a throwaway one.
 */

import { IntegrationMode, Platform, PostStatus } from "@prisma/client";

import type { Session } from "@/lib/auth/session";
import { sealJson } from "@/lib/crypto";
import { db } from "@/lib/db";
import { getAdapter, getPlatformAdapter, modeAvailability } from "@/modules/integrations/registry";
import { LiveAdapter } from "@/modules/integrations/live-adapter";
import { MockAdapter } from "@/modules/integrations/mock-adapter";
import { UnifiedAdapter } from "@/modules/integrations/unified/adapter";
import { syncAccount } from "@/modules/integrations/sync";
import { getAccountInsights } from "@/modules/insights/service";
import { publishPost } from "@/modules/posts/service";
import { FAKE_UNIFIED_KEY, startFakeUnified } from "./fake-unified";

let failures = 0;
let checks = 0;

function ok(label: string, condition: boolean, detail = "") {
  checks += 1;
  if (!condition) failures += 1;
  console.log(`  ${condition ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const fake = await startFakeUnified();

  process.env.SOCIALOS_UNIFIED_PROVIDER = "ayrshare";
  process.env.SOCIALOS_UNIFIED_BASE = fake.url;
  process.env.AYRSHARE_API_KEY = FAKE_UNIFIED_KEY;
  process.env.SOCIALOS_ENCRYPTION_KEY ??= Buffer.from(
    "unified-e2e-key-exactly-32-bytes"
  ).toString("base64");
  // Direct stays unconfigured for X so the two modes are distinguishable.
  delete process.env.X_CLIENT_ID;
  delete process.env.X_CLIENT_SECRET;

  const membership = await db.membership.findFirst({
    where: { role: "OWNER", org: { slug: "northwind" } },
    include: { org: true, user: true },
  });
  if (!membership) throw new Error("Seed the northwind demo org first");

  const session: Session = {
    userId: membership.userId,
    email: membership.user.email,
    name: membership.user.name,
    avatarUrl: membership.user.avatarUrl,
    orgId: membership.orgId,
    orgName: membership.org.name,
    orgSlug: membership.org.slug,
    role: membership.role,
  };

  console.log("\nRegistry resolution");
  ok(
    "null mode → mock",
    getAdapter(Platform.X, null) instanceof MockAdapter
  );
  ok(
    "UNIFIED → unified adapter",
    getAdapter(Platform.X, IntegrationMode.UNIFIED) instanceof UnifiedAdapter
  );
  ok(
    "DIRECT with no OAuth app falls back to mock rather than throwing",
    getAdapter(Platform.X, IntegrationMode.DIRECT) instanceof MockAdapter
  );

  process.env.X_CLIENT_ID = "id";
  process.env.X_CLIENT_SECRET = "secret";
  ok(
    "DIRECT resolves once the OAuth app is configured",
    getAdapter(Platform.X, IntegrationMode.DIRECT) instanceof LiveAdapter
  );
  ok(
    "two platforms can run different modes at once",
    getAdapter(Platform.X, IntegrationMode.DIRECT) instanceof LiveAdapter &&
      getAdapter(Platform.TIKTOK, IntegrationMode.UNIFIED) instanceof UnifiedAdapter
  );
  ok(
    "trend panels stay platform-wide",
    getPlatformAdapter(Platform.X) instanceof MockAdapter
  );

  console.log("\nSettings selector state (§4)");
  const modes = modeAvailability(Platform.TIKTOK);
  ok("three options offered", modes.length === 3);
  ok("mock is always available", modes[0]!.available && modes[0]!.mode === null);
  ok("unified available with a provider key", modes[1]!.available);
  ok(
    "direct unavailable, with a reason naming the variables",
    !modes[2]!.available && (modes[2]!.reason ?? "").includes("TIKTOK_CLIENT_KEY"),
    (modes[2]!.reason ?? "").slice(0, 60)
  );

  console.log("\nUnified account: pull");
  const account = await db.connectedAccount.upsert({
    where: {
      orgId_platform_handle: {
        orgId: session.orgId,
        platform: Platform.X,
        handle: "@unified-test",
      },
    },
    update: { status: "CONNECTED", integrationMode: IntegrationMode.UNIFIED },
    create: {
      orgId: session.orgId,
      platform: Platform.X,
      handle: "@unified-test",
      status: "CONNECTED",
      integrationMode: IntegrationMode.UNIFIED,
    },
  });

  // The provider reference is stored exactly like a direct token would be.
  const sealed = sealJson({ accessToken: "acct-primary" });
  await db.platformCredential.upsert({
    where: { accountId: account.id },
    update: { ...sealed, externalId: "acct-primary", scopes: [] },
    create: {
      accountId: account.id,
      ...sealed,
      externalId: "acct-primary",
      scopes: [],
    },
  });

  const result = await syncAccount(session, account.id);
  ok("sync pulled posts", result.posts > 0, `${result.posts} posts`);
  ok("sync derived snapshots", result.snapshots > 0, `${result.snapshots} days`);
  ok(
    "the per-account header was sent on every call",
    fake.seenAccountKeys.length > 0 &&
      fake.seenAccountKeys.every((key) => key === "acct-primary"),
    `${fake.seenAccountKeys.length} calls, all scoped`
  );

  const rows = await db.externalPost.findMany({ where: { accountId: account.id } });
  ok("posts persisted", rows.length === result.posts);
  ok("video posts classified", rows.some((r) => r.mediaType === "video"));
  ok("engagement came through", rows.every((r) => r.likes > 0 && r.views > 0));
  ok(
    "provider extras normalised into metrics",
    rows.every((r) => (r.metrics as Record<string, number>).saves === 12)
  );

  const before = rows.length;
  await syncAccount(session, account.id);
  ok(
    "re-sync updates rather than duplicates",
    (await db.externalPost.count({ where: { accountId: account.id } })) === before
  );

  console.log("\nInsights read it the same as any other source");
  const insights = await getAccountInsights(session, { platform: Platform.X });
  ok("analysable sample", !insights.thin, `${insights.sampleSize} posts`);
  ok(
    "video identified as the stronger format",
    insights.formats[0]?.mediaType === "video",
    insights.formats.map((f) => `${f.mediaType} ${f.averageEngagementRate.toFixed(1)}%`).join(", ")
  );

  console.log("\nUnified account: publish");
  const draft = await db.post.create({
    data: {
      orgId: session.orgId,
      platform: Platform.X,
      body: "Unified publish test.",
      status: PostStatus.DRAFT,
      authorId: session.userId,
      platformData: {},
    },
  });
  const published = await publishPost(session, draft.id);
  ok("post reached PUBLISHED", published.status === PostStatus.PUBLISHED, published.status);
  ok("the provider actually received it", fake.published.length === 1);
  ok(
    "it was addressed to the right network",
    fake.published[0]?.platforms.includes("twitter"),
    fake.published[0]?.platforms.join(",")
  );

  console.log("\nCleanup");
  await db.externalPost.deleteMany({ where: { accountId: account.id } });
  await db.post.delete({ where: { id: draft.id } });
  await db.connectedAccount.delete({ where: { id: account.id } });
  console.log("  ✓ test account removed");

  await fake.close();
  console.log(
    `\n${failures === 0 ? "✓" : "✗"} ${checks - failures}/${checks} checks passed\n`
  );
  await db.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("\nUnified e2e threw:\n", error);
  await db.$disconnect();
  process.exit(1);
});
