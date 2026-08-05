import { Platform } from "@prisma/client";

/**
 * Per-platform OAuth 2.0 configuration.
 *
 * Every awkward difference between the five providers is isolated here so the
 * flow in `service.ts` stays one code path. The differences that actually
 * matter, and why each field exists:
 *
 *   - X and TikTok require PKCE; Google and Meta don't (`pkce`).
 *   - X wants HTTP Basic auth on the token endpoint with the client id/secret,
 *     while everyone else wants them in the form body (`tokenAuth`).
 *   - TikTok names its client credentials `client_key`/`client_secret` rather
 *     than `client_id`/`client_secret` (`clientIdParam`).
 *   - Only X and TikTok issue refresh tokens for these scopes. Google issues one
 *     but only when asked with `access_type=offline` (`extraAuthParams`).
 *   - Meta's long-lived tokens are obtained by exchanging the short-lived one
 *     rather than by refreshing (`exchangeForLongLived`).
 *
 * Scopes are read-only throughout. This feature pulls data; it does not post,
 * and requesting write scopes we don't use would fail app review for no gain.
 */

export type TokenAuth = "basic" | "body";

export type OAuthProvider = {
  platform: Platform;
  /** Human name for the consent screen copy. */
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  pkce: boolean;
  tokenAuth: TokenAuth;
  clientIdParam: "client_id" | "client_key";
  /** Env var names, so a missing one can be named precisely in the UI. */
  clientIdEnv: string;
  clientSecretEnv: string;
  /** Appended to the authorize URL — consent prompts, offline access. */
  extraAuthParams?: Record<string, string>;
  /** Meta only: swap the short-lived token for a ~60 day one. */
  exchangeForLongLived?: { url: string; grantType: string };
  /** Where the platform's docs explain the app setup, shown when unconfigured. */
  docsUrl: string;
};

export const OAUTH_PROVIDERS: Record<Platform, OAuthProvider> = {
  [Platform.X]: {
    platform: Platform.X,
    label: "X",
    authorizeUrl: "https://x.com/i/oauth2/authorize",
    tokenUrl: "https://api.x.com/2/oauth2/token",
    // offline.access is what makes the refresh token appear; without it the
    // connection silently dies after two hours.
    scopes: ["tweet.read", "users.read", "offline.access"],
    pkce: true,
    tokenAuth: "basic",
    clientIdParam: "client_id",
    clientIdEnv: "X_CLIENT_ID",
    clientSecretEnv: "X_CLIENT_SECRET",
    docsUrl: "https://developer.x.com/en/portal/dashboard",
  },

  [Platform.TIKTOK]: {
    platform: Platform.TIKTOK,
    label: "TikTok",
    authorizeUrl: "https://www.tiktok.com/v2/auth/authorize/",
    tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    scopes: ["user.info.basic", "user.info.stats", "video.list"],
    pkce: true,
    tokenAuth: "body",
    clientIdParam: "client_key",
    clientIdEnv: "TIKTOK_CLIENT_KEY",
    clientSecretEnv: "TIKTOK_CLIENT_SECRET",
    docsUrl: "https://developers.tiktok.com/",
  },

  [Platform.INSTAGRAM]: {
    platform: Platform.INSTAGRAM,
    label: "Instagram",
    // Instagram Business accounts authenticate through Facebook Login — there
    // is no separate Instagram OAuth for the insights this feature needs.
    authorizeUrl: "https://www.facebook.com/v21.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
    scopes: [
      "instagram_basic",
      "instagram_manage_insights",
      "pages_show_list",
      "pages_read_engagement",
    ],
    pkce: false,
    tokenAuth: "body",
    clientIdParam: "client_id",
    clientIdEnv: "META_CLIENT_ID",
    clientSecretEnv: "META_CLIENT_SECRET",
    exchangeForLongLived: {
      url: "https://graph.facebook.com/v21.0/oauth/access_token",
      grantType: "fb_exchange_token",
    },
    docsUrl: "https://developers.facebook.com/docs/instagram-api",
  },

  [Platform.FACEBOOK]: {
    platform: Platform.FACEBOOK,
    label: "Facebook",
    authorizeUrl: "https://www.facebook.com/v21.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
    scopes: ["pages_show_list", "pages_read_engagement", "read_insights"],
    pkce: false,
    tokenAuth: "body",
    clientIdParam: "client_id",
    clientIdEnv: "META_CLIENT_ID",
    clientSecretEnv: "META_CLIENT_SECRET",
    exchangeForLongLived: {
      url: "https://graph.facebook.com/v21.0/oauth/access_token",
      grantType: "fb_exchange_token",
    },
    docsUrl: "https://developers.facebook.com/docs/pages-api",
  },

  [Platform.YOUTUBE]: {
    platform: Platform.YOUTUBE,
    label: "YouTube",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/yt-analytics.readonly",
    ],
    pkce: false,
    tokenAuth: "body",
    clientIdParam: "client_id",
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    // Google returns a refresh token only on the first consent unless forced,
    // and a reconnect without it leaves an account that dies in an hour.
    extraAuthParams: { access_type: "offline", prompt: "consent" },
    docsUrl: "https://console.cloud.google.com/apis/credentials",
  },
};

export type ProviderCredentials = { clientId: string; clientSecret: string };

/**
 * Reads the client id/secret for a platform, or null when either is absent.
 *
 * Overridable base URLs exist so the whole flow can be pointed at a local fake
 * provider in tests — the alternative is that this code path only ever runs in
 * production, which is how OAuth bugs survive to launch day.
 */
export function providerCredentials(
  platform: Platform
): ProviderCredentials | null {
  const provider = OAUTH_PROVIDERS[platform];
  const clientId = process.env[provider.clientIdEnv]?.trim();
  const clientSecret = process.env[provider.clientSecretEnv]?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function isPlatformConfigured(platform: Platform): boolean {
  return providerCredentials(platform) !== null;
}

/**
 * Test seam: SOCIALOS_OAUTH_BASE_<PLATFORM> replaces the provider's origin so a
 * local server can stand in for the real one. Ignored in production.
 */
export function resolveProvider(platform: Platform): OAuthProvider {
  const provider = OAUTH_PROVIDERS[platform];
  const override = process.env[`SOCIALOS_OAUTH_BASE_${platform}`]?.trim();
  if (!override || process.env.VERCEL_ENV === "production") return provider;

  const swap = (url: string) => {
    const target = new URL(url);
    const base = new URL(override);
    target.protocol = base.protocol;
    target.host = base.host;
    return target.toString();
  };

  return {
    ...provider,
    authorizeUrl: swap(provider.authorizeUrl),
    tokenUrl: swap(provider.tokenUrl),
    exchangeForLongLived: provider.exchangeForLongLived
      ? {
          ...provider.exchangeForLongLived,
          url: swap(provider.exchangeForLongLived.url),
        }
      : undefined,
  };
}

/** The callback URL registered with each platform's developer console. */
export function redirectUri(platform: Platform): string {
  const base =
    process.env.SOCIALOS_PUBLIC_URL?.trim().replace(/\/$/, "") ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
    "http://localhost:3000";
  return `${base}/api/oauth/${platform.toLowerCase()}/callback`;
}
