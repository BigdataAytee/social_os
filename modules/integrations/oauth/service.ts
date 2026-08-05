import { ConnectedAccountStatus, Platform, Prisma } from "@prisma/client";

import { assertCan } from "@/lib/auth/permissions";
import type { Session } from "@/lib/auth/session";
import {
  isEncryptionConfigured,
  openJson,
  sealJson,
  type SealedBox,
} from "@/lib/crypto";
import { db } from "@/lib/db";
import { logActivity } from "@/modules/activity/service";
import {
  isPlatformConfigured,
  providerCredentials,
  redirectUri,
  resolveProvider,
  type OAuthProvider,
} from "./providers";

/**
 * OAuth token lifecycle (ARCHITECTURE.md §10).
 *
 * Everything that touches a token goes through here, and nothing outside this
 * file ever sees a decrypted one except `withAccessToken`, which hands it to a
 * callback and never returns it. That's deliberate: the moment a token can be
 * returned to a caller it ends up logged, serialised into an RSC payload, or
 * put in an error message.
 */

export type TokenEnvelope = {
  accessToken: string;
  refreshToken?: string;
};

/** Refresh this far ahead of expiry rather than waiting for a 401. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;

export type ConnectAvailability =
  | { available: true }
  | { available: false; reason: string };

/**
 * Can this platform be connected right now? Three separate ways to be "no",
 * each with a different fix, so they are not collapsed into one boolean.
 */
export function connectAvailability(platform: Platform): ConnectAvailability {
  if (!isEncryptionConfigured()) {
    return {
      available: false,
      reason:
        "SOCIALOS_ENCRYPTION_KEY isn't set, so access tokens can't be stored safely. Generate one with `openssl rand -base64 32`.",
    };
  }
  if (!isPlatformConfigured(platform)) {
    const provider = resolveProvider(platform);
    return {
      available: false,
      reason: `${provider.clientIdEnv} and ${provider.clientSecretEnv} aren't set. Create an app in the ${provider.label} developer console and add them.`,
    };
  }
  return { available: true };
}

// ------------------------------------------------------------ token exchange

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  /** TikTok nests its payload and reports errors in-band with HTTP 200. */
  data?: Record<string, unknown>;
  error?: string;
  error_description?: string;
};

function authHeaders(
  provider: OAuthProvider,
  creds: { clientId: string; clientSecret: string }
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  if (provider.tokenAuth === "basic") {
    const basic = Buffer.from(
      `${creds.clientId}:${creds.clientSecret}`
    ).toString("base64");
    headers.Authorization = `Basic ${basic}`;
  }
  return headers;
}

async function postForm(
  url: string,
  body: URLSearchParams,
  headers: Record<string, string>
): Promise<TokenResponse> {
  const response = await fetch(url, { method: "POST", headers, body });
  const text = await response.text();

  let parsed: TokenResponse;
  try {
    parsed = JSON.parse(text) as TokenResponse;
  } catch {
    // Meta's older endpoints answer form-encoded. Parse rather than fail.
    parsed = Object.fromEntries(
      new URLSearchParams(text)
    ) as unknown as TokenResponse;
  }

  // TikTok wraps success in `data` and still returns HTTP 200 on failure.
  const payload = (parsed.data as TokenResponse | undefined) ?? parsed;

  if (!response.ok || payload.error || !payload.access_token) {
    const detail =
      payload.error_description ?? payload.error ?? `HTTP ${response.status}`;
    throw new Error(`Token endpoint rejected the request: ${detail}`);
  }
  return payload;
}

/** Exchange an authorization code for tokens. Called only from the callback. */
export async function exchangeCode(opts: {
  platform: Platform;
  code: string;
  codeVerifier?: string;
}): Promise<{ tokens: TokenEnvelope; expiresAt: Date | null; scopes: string[] }> {
  const provider = resolveProvider(opts.platform);
  const creds = providerCredentials(opts.platform);
  if (!creds) throw new Error(`${provider.label} OAuth is not configured`);

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: redirectUri(opts.platform),
  });
  // X authenticates with the header instead, and sending the secret twice makes
  // it reject the request.
  body.set(provider.clientIdParam, creds.clientId);
  if (provider.tokenAuth === "body") {
    body.set("client_secret", creds.clientSecret);
  }
  if (opts.codeVerifier) body.set("code_verifier", opts.codeVerifier);

  let token = await postForm(
    provider.tokenUrl,
    body,
    authHeaders(provider, creds)
  );

  // Meta issues a ~1 hour token from the code; without this trade the
  // connection expires the same afternoon.
  if (provider.exchangeForLongLived) {
    token = await exchangeLongLived(provider, creds, token.access_token);
  }

  return {
    tokens: {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
    },
    expiresAt: token.expires_in
      ? new Date(Date.now() + token.expires_in * 1000)
      : null,
    scopes: token.scope ? token.scope.split(/[\s,]+/).filter(Boolean) : [],
  };
}

async function exchangeLongLived(
  provider: OAuthProvider,
  creds: { clientId: string; clientSecret: string },
  shortLived: string
): Promise<TokenResponse> {
  const url = new URL(provider.exchangeForLongLived!.url);
  url.searchParams.set("grant_type", provider.exchangeForLongLived!.grantType);
  url.searchParams.set("client_id", creds.clientId);
  url.searchParams.set("client_secret", creds.clientSecret);
  url.searchParams.set("fb_exchange_token", shortLived);

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const payload = (await response.json()) as TokenResponse;
  if (!response.ok || !payload.access_token) {
    // Not fatal — the short-lived token still works today. Better a connection
    // that lasts an hour than a failed connect.
    return { access_token: shortLived, expires_in: 3600 };
  }
  return payload;
}

async function refresh(
  platform: Platform,
  refreshToken: string
): Promise<{ tokens: TokenEnvelope; expiresAt: Date | null }> {
  const provider = resolveProvider(platform);
  const creds = providerCredentials(platform);
  if (!creds) throw new Error(`${provider.label} OAuth is not configured`);

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  body.set(provider.clientIdParam, creds.clientId);
  if (provider.tokenAuth === "body") {
    body.set("client_secret", creds.clientSecret);
  }

  const token = await postForm(
    provider.tokenUrl,
    body,
    authHeaders(provider, creds)
  );

  return {
    tokens: {
      accessToken: token.access_token,
      // Rotating providers issue a new refresh token each time; keeping the old
      // one would break the *next* refresh, not this one.
      refreshToken: token.refresh_token ?? refreshToken,
    },
    expiresAt: token.expires_in
      ? new Date(Date.now() + token.expires_in * 1000)
      : null,
  };
}

// ---------------------------------------------------------- credential store

export async function saveCredential(opts: {
  accountId: string;
  tokens: TokenEnvelope;
  expiresAt: Date | null;
  scopes: string[];
  externalId: string;
}) {
  const box = sealJson(opts.tokens);
  const data = {
    ciphertext: box.ciphertext,
    iv: box.iv,
    authTag: box.authTag,
    expiresAt: opts.expiresAt,
    scopes: opts.scopes,
    externalId: opts.externalId,
  };

  await db.platformCredential.upsert({
    where: { accountId: opts.accountId },
    update: data,
    create: { accountId: opts.accountId, ...data },
  });
}

/**
 * Runs `use` with a valid access token, refreshing first if it is about to
 * expire. The token is never returned — see the note at the top of the file.
 *
 * A refresh failure marks the account ERROR rather than throwing an opaque
 * fetch error, so the Studio can say "reconnect this account" instead of
 * showing a stack trace.
 */
export async function withAccessToken<T>(
  accountId: string,
  use: (accessToken: string, externalId: string) => Promise<T>
): Promise<T> {
  const credential = await db.platformCredential.findUnique({
    where: { accountId },
    include: { account: true },
  });
  if (!credential) {
    throw new Error("This account has no stored credentials — reconnect it.");
  }

  let tokens: TokenEnvelope;
  try {
    tokens = openJson<TokenEnvelope>(credential as SealedBox);
  } catch {
    // Wrong key, or a tampered row. Either way the credential is unusable and
    // saying so beats a cryptic GCM error.
    await markAccountError(accountId, "Stored credentials could not be read.");
    throw new Error(
      "Stored credentials could not be decrypted. If SOCIALOS_ENCRYPTION_KEY changed, reconnect the account."
    );
  }

  const expiring =
    credential.expiresAt !== null &&
    credential.expiresAt.getTime() - Date.now() < REFRESH_SKEW_MS;

  if (expiring && tokens.refreshToken) {
    try {
      const renewed = await refresh(
        credential.account.platform,
        tokens.refreshToken
      );
      await saveCredential({
        accountId,
        tokens: renewed.tokens,
        expiresAt: renewed.expiresAt,
        scopes: credential.scopes,
        externalId: credential.externalId,
      });
      tokens = renewed.tokens;
    } catch (error) {
      await markAccountError(
        accountId,
        error instanceof Error ? error.message : "Token refresh failed."
      );
      throw new Error(
        "The stored token expired and could not be refreshed — reconnect this account."
      );
    }
  } else if (expiring) {
    await markAccountError(
      accountId,
      "The access token expired and this platform issued no refresh token."
    );
    throw new Error(
      "The access token expired and there is no refresh token — reconnect this account."
    );
  }

  return use(tokens.accessToken, credential.externalId);
}

async function markAccountError(accountId: string, message: string) {
  await db.connectedAccount.update({
    where: { id: accountId },
    data: { status: ConnectedAccountStatus.ERROR, lastSyncError: message },
  });
}

// ------------------------------------------------------------- account wiring

/**
 * Attach a freshly authorised platform account to the org.
 *
 * Reconnecting an account that already exists updates it in place rather than
 * creating a second row — the unique key is (orgId, platform, handle), and a
 * duplicate would split a single account's history across two rows and silently
 * halve its analytics.
 */
export async function linkAccount(opts: {
  orgId: string;
  platform: Platform;
  handle: string;
  externalId: string;
  tokens: TokenEnvelope;
  expiresAt: Date | null;
  scopes: string[];
  meta?: Record<string, unknown>;
}) {
  // meta holds only display fields (ARCHITECTURE.md §10) — the token went to
  // PlatformCredential above.
  const meta = opts.meta as Prisma.InputJsonValue | undefined;

  const account = await db.connectedAccount.upsert({
    where: {
      orgId_platform_handle: {
        orgId: opts.orgId,
        platform: opts.platform,
        handle: opts.handle,
      },
    },
    update: {
      status: ConnectedAccountStatus.CONNECTED,
      lastSyncError: null,
      ...(meta ? { meta } : {}),
    },
    create: {
      orgId: opts.orgId,
      platform: opts.platform,
      handle: opts.handle,
      status: ConnectedAccountStatus.CONNECTED,
      ...(meta ? { meta } : {}),
    },
  });

  await saveCredential({
    accountId: account.id,
    tokens: opts.tokens,
    expiresAt: opts.expiresAt,
    scopes: opts.scopes,
    externalId: opts.externalId,
  });

  return account;
}

/**
 * Disconnect: delete the credential, keep the account and its history.
 *
 * Deleting the account would cascade away every AnalyticsSnapshot and
 * ExternalPost with it, so a momentary disconnect would destroy months of
 * history. Reconnecting later re-attaches to the same row.
 */
export async function disconnectAccount(session: Session, accountId: string) {
  assertCan(session.role, "integration.manage");

  const account = await db.connectedAccount.findFirst({
    where: { id: accountId, orgId: session.orgId },
  });
  if (!account) throw new Error("Account not found");

  await db.platformCredential.deleteMany({ where: { accountId } });
  await db.connectedAccount.update({
    where: { id: accountId },
    data: {
      status: ConnectedAccountStatus.DISCONNECTED,
      lastSyncError: null,
    },
  });

  await logActivity(session, "integration.disconnected", "account", accountId, {
    platform: account.platform,
  });

  return account;
}

/** Accounts for a platform, with connection state but never token material. */
export async function listAccounts(session: Session, platform?: Platform) {
  const accounts = await db.connectedAccount.findMany({
    where: { orgId: session.orgId, ...(platform ? { platform } : {}) },
    include: { credential: { select: { expiresAt: true, scopes: true } } },
    orderBy: { createdAt: "asc" },
  });

  return accounts.map((account) => ({
    id: account.id,
    platform: account.platform,
    handle: account.handle,
    status: account.status,
    lastSyncAt: account.lastSyncAt,
    lastSyncError: account.lastSyncError,
    connected: account.credential !== null,
    scopes: account.credential?.scopes ?? [],
    expiresAt: account.credential?.expiresAt ?? null,
  }));
}

export type AccountSummary = Awaited<ReturnType<typeof listAccounts>>[number];
