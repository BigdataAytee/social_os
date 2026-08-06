/**
 * End-to-end exercise of the connected-account feature against a fake platform.
 *
 * Covers the path a real connection takes — authorize, code exchange with PKCE,
 * identity lookup, account link, token encryption, data pull, insight analysis,
 * idea generation — using the same functions the route handlers call. The only
 * things stubbed are the platform's own endpoints (scripts/fake-platform.ts).
 *
 *   DATABASE_URL=… npx tsx scripts/oauth-e2e.ts
 *
 * It writes to the database. Point it at a throwaway one.
 */

import { Platform } from "@prisma/client";

import type { Session } from "@/lib/auth/session";
import { createPkcePair, decodeState, encodeState, openJson, seal, open as unseal } from "@/lib/crypto";
import { db } from "@/lib/db";
import { generateIdeasFromAccount } from "@/modules/ai/orchestrator";
import { getAccountInsights } from "@/modules/insights/service";
import { fetchIdentity } from "@/modules/integrations/oauth/identity";
import {
  connectAvailability,
  disconnectAccount,
  exchangeCode,
  linkAccount,
  listAccounts,
  withAccessToken,
} from "@/modules/integrations/oauth/service";
import { redirectUri } from "@/modules/integrations/oauth/providers";
import { isDirectAvailable } from "@/modules/integrations/registry";
import { syncAccount } from "@/modules/integrations/sync";
import { FAKE_CLIENT, startFakePlatform } from "./fake-platform";

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
      `  ✓ ${label} — ${(error instanceof Error ? error.message : String(error)).slice(0, 70)}`
    );
  }
}

async function main() {
  const fake = await startFakePlatform();

  // Point the whole X path at the fake before anything reads the environment.
  process.env.X_CLIENT_ID = FAKE_CLIENT.id;
  process.env.X_CLIENT_SECRET = FAKE_CLIENT.secret;
  process.env.SOCIALOS_OAUTH_BASE_X = fake.url;
  process.env.SOCIALOS_API_BASE_X = `${fake.url}/2`;
  process.env.SOCIALOS_PUBLIC_URL = "http://localhost:3000";
  process.env.SOCIALOS_ENCRYPTION_KEY ??= Buffer.from(
    "e2e-test-key-32-bytes-exactly!!!"
  ).toString("base64");

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

  console.log("\nEncryption");
  const box = seal("a-platform-access-token");
  ok("round-trips", unseal(box) === "a-platform-access-token");
  ok("ciphertext is not the plaintext", !box.ciphertext.includes("platform"));
  ok("iv differs per encryption", seal("x").iv !== seal("x").iv);
  checks += 1;
  try {
    unseal({ ...box, ciphertext: Buffer.from("tampered").toString("base64") });
    failures += 1;
    console.log("  ✗ tampering is rejected — decrypt succeeded");
  } catch {
    console.log("  ✓ tampering is rejected");
  }

  console.log("\nSigned OAuth state");
  const state = encodeState({
    orgId: session.orgId,
    userId: session.userId,
    platform: Platform.X,
    nonce: "nonce-1",
    returnTo: "/studio/x",
  });
  ok("decodes what it encoded", decodeState(state)?.nonce === "nonce-1");
  ok("rejects a tampered signature", decodeState(`${state}x`) === null);
  ok(
    "rejects a swapped payload",
    decodeState(`${Buffer.from('{"orgId":"evil"}').toString("base64url")}.${state.split(".")[1]}`) === null
  );

  console.log("\nConfiguration gating");
  ok("X reports connectable", connectAvailability(Platform.X).available);
  ok("X can use a direct adapter", isDirectAvailable(Platform.X));
  ok(
    "an unconfigured platform stays on the mock",
    !isDirectAvailable(Platform.TIKTOK)
  );
  ok(
    "unavailable platforms name the missing variable",
    (connectAvailability(Platform.TIKTOK) as { reason: string }).reason.includes(
      "TIKTOK_CLIENT_KEY"
    )
  );

  console.log("\nAuthorization code flow");
  const { verifier, challenge } = createPkcePair();
  const authorize = new URL(`${fake.url}/i/oauth2/authorize`);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", FAKE_CLIENT.id);
  authorize.searchParams.set("redirect_uri", redirectUri(Platform.X));
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");

  const authorizeResponse = await fetch(authorize, { redirect: "manual" });
  ok("authorize redirects back", authorizeResponse.status === 302);
  const callbackUrl = new URL(authorizeResponse.headers.get("location")!);
  const code = callbackUrl.searchParams.get("code")!;
  ok("callback carries a code", Boolean(code));
  ok(
    "callback echoes our state",
    callbackUrl.searchParams.get("state") === state
  );

  await throws("a wrong PKCE verifier is rejected", () =>
    exchangeCode({ platform: Platform.X, code, codeVerifier: "wrong-verifier" })
  );

  // That failed attempt consumed the code, which is itself correct behaviour —
  // start a fresh authorization for the successful path.
  const second = await fetch(authorize, { redirect: "manual" });
  const freshCode = new URL(second.headers.get("location")!).searchParams.get(
    "code"
  )!;

  const exchanged = await exchangeCode({
    platform: Platform.X,
    code: freshCode,
    codeVerifier: verifier,
  });
  ok("token exchange succeeds", Boolean(exchanged.tokens.accessToken));
  ok("a refresh token is issued", Boolean(exchanged.tokens.refreshToken));
  ok("an expiry is recorded", exchanged.expiresAt !== null);
  ok(
    "granted scopes are captured",
    exchanged.scopes.includes("offline.access"),
    exchanged.scopes.join(" ")
  );

  await throws("replaying a used code fails", () =>
    exchangeCode({ platform: Platform.X, code: freshCode, codeVerifier: verifier })
  );

  console.log("\nIdentity and linking");
  const identity = await fetchIdentity(Platform.X, exchanged.tokens.accessToken);
  ok("identity resolves the handle", identity.handle === "@northwind", identity.handle);

  const account = await linkAccount({
    orgId: session.orgId,
    platform: Platform.X,
    handle: identity.handle,
    externalId: identity.externalId,
    tokens: exchanged.tokens,
    expiresAt: exchanged.expiresAt,
    scopes: exchanged.scopes,
    meta: identity.meta,
  });
  ok("account is CONNECTED", account.status === "CONNECTED");

  const stored = await db.platformCredential.findUnique({
    where: { accountId: account.id },
  });
  ok("a credential row exists", stored !== null);
  ok(
    "the token is not stored in plaintext",
    !stored!.ciphertext.includes(exchanged.tokens.accessToken)
  );
  ok(
    "meta holds no token material",
    !JSON.stringify(account.meta).includes(exchanged.tokens.accessToken)
  );
  ok(
    "the stored token decrypts to what we exchanged",
    openJson<{ accessToken: string }>(stored!).accessToken ===
      exchanged.tokens.accessToken
  );

  // Reconnecting must land on the same row, not fork the account's history.
  const relinked = await linkAccount({
    orgId: session.orgId,
    platform: Platform.X,
    handle: identity.handle,
    externalId: identity.externalId,
    tokens: exchanged.tokens,
    expiresAt: exchanged.expiresAt,
    scopes: exchanged.scopes,
  });
  ok("reconnecting reuses the account", relinked.id === account.id);

  console.log("\nToken refresh");
  await db.platformCredential.update({
    where: { accountId: account.id },
    data: { expiresAt: new Date(Date.now() + 60_000) }, // inside the skew
  });
  const before = fake.issuedRefreshTokens.length;
  await withAccessToken(account.id, async () => undefined);
  ok("an expiring token is refreshed", fake.issuedRefreshTokens.length > before);
  const after = await db.platformCredential.findUnique({
    where: { accountId: account.id },
  });
  ok(
    "the refreshed token is persisted",
    openJson<{ accessToken: string }>(after!).accessToken !==
      exchanged.tokens.accessToken
  );
  ok(
    "the new expiry is in the future",
    (after!.expiresAt?.getTime() ?? 0) > Date.now() + 3_600_000
  );

  console.log("\nData pull");
  const sync = await syncAccount(session, account.id);
  ok("posts were pulled", sync.posts > 0, `${sync.posts} posts`);
  ok("snapshots were derived", sync.snapshots > 0, `${sync.snapshots} days`);

  const rows = await db.externalPost.findMany({
    where: { accountId: account.id },
  });
  ok("posts persisted", rows.length === sync.posts);
  ok(
    "video posts were classified",
    rows.some((r) => r.mediaType === "video")
  );
  ok(
    "metrics came through",
    rows.every((r) => r.views > 0)
  );

  const resynced = await syncAccount(session, account.id);
  const afterResync = await db.externalPost.count({
    where: { accountId: account.id },
  });
  ok(
    "re-syncing updates rather than duplicates",
    afterResync === rows.length,
    `${afterResync} rows after pulling ${resynced.posts} again`
  );

  console.log("\nInsights");
  const insights = await getAccountInsights(session, { platform: Platform.X });
  ok("sample is large enough to analyse", !insights.thin, `${insights.sampleSize} posts`);
  ok("formats were compared", insights.formats.length >= 2);
  ok(
    "video is identified as the strongest format",
    insights.formats[0]?.mediaType === "video",
    insights.formats.map((f) => `${f.mediaType} ${f.averageEngagementRate.toFixed(1)}%`).join(", ")
  );
  ok(
    "the best slot is the Tuesday morning one",
    insights.timing[0]?.dayName === "Tuesday" && insights.timing[0]?.hour === 9,
    `${insights.timing[0]?.dayName} ${insights.timing[0]?.hour}:00`
  );
  ok(
    "the seeded hashtag surfaces as a topic",
    insights.topics.some((t) => t.term === "#buildinpublic"),
    insights.topics.slice(0, 3).map((t) => t.term).join(", ")
  );
  ok(
    "top posts are ordered by engagement rate",
    insights.topPosts.every(
      (p, i) => i === 0 || p.engagementRate <= insights.topPosts[i - 1]!.engagementRate
    )
  );
  ok(
    "long text underperforms video",
    (insights.lengths.find((l) => l.label === "Over 500 characters")
      ?.averageEngagementRate ?? 99) <
      (insights.formats.find((f) => f.mediaType === "video")
        ?.averageEngagementRate ?? 0)
  );

  console.log("\nIdea generation");
  const generated = await generateIdeasFromAccount(session, {
    studio: Platform.X,
    count: 5,
  });
  ok("ideas were produced", generated.ideas.length > 0, `${generated.ideas.length} ideas`);
  ok("an AIGeneration row was written", generated.generationId !== "");
  const row = await db.aIGeneration.findUnique({
    where: { id: generated.generationId },
  });
  ok("the generation records the report it worked from", Boolean(row?.input.includes("Format performance")));
  ok("it is typed as account-ideas", row?.type === "account-ideas");

  console.log("\nDisconnect");
  const listed = await listAccounts(session, Platform.X);
  ok("the account lists as connected", listed.some((a) => a.connected));
  ok(
    "listing never exposes token material",
    !JSON.stringify(listed).includes(
      openJson<{ accessToken: string }>(after!).accessToken
    )
  );

  await disconnectAccount(session, account.id);
  const credentialAfter = await db.platformCredential.findUnique({
    where: { accountId: account.id },
  });
  ok("the credential is deleted", credentialAfter === null);
  const kept = await db.externalPost.count({ where: { accountId: account.id } });
  ok("pulled history survives a disconnect", kept === rows.length, `${kept} posts kept`);

  console.log("\nCleanup");
  await db.externalPost.deleteMany({ where: { accountId: account.id } });
  await db.connectedAccount.delete({ where: { id: account.id } });
  await db.idea.deleteMany({
    where: { orgId: session.orgId, source: "ai-insights" },
  });
  await db.aIGeneration.deleteMany({
    where: { orgId: session.orgId, type: "account-ideas" },
  });
  console.log("  ✓ test account removed");

  await fake.close();
  console.log(
    `\n${failures === 0 ? "✓" : "✗"} ${checks - failures}/${checks} checks passed\n`
  );
  await db.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("\nOAuth e2e threw:\n", error);
  await db.$disconnect();
  process.exit(1);
});
