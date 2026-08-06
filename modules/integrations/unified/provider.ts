import { Platform } from "@prisma/client";

/**
 * The unified provider's configuration (Platform-Connections.md §4).
 *
 * Isolated here for the same reason `oauth/providers.ts` exists: the provider's
 * quirks — its base URL, how it names each network, how it scopes calls to one
 * connected user — should live in one file, so swapping Ayrshare for Blotato,
 * Zernio or Postproxy is a config change rather than an adapter rewrite.
 *
 * **Endpoint shapes below are written from the provider's published API and have
 * not been exercised against it.** `Platform-Connections.md` opens by warning
 * that these facts move fast and to re-verify against official docs before
 * relying on them; this environment has no egress to do that. What *is* verified
 * is the shape of the integration — auth, per-account scoping, error handling,
 * normalisation into `ExternalPostData` — against a local fake in
 * `scripts/fake-unified.ts`.
 */

export type UnifiedProvider = {
  id: string;
  label: string;
  baseUrl: string;
  apiKeyEnv: string;
  /** The provider's own name for each network, in its request payloads. */
  networkFor: Record<Platform, string>;
  /**
   * Every name the provider might use for a network when *reading* it back.
   *
   * Sending one name and matching on exactly that name assumes the provider
   * echoes what it accepts. X makes that assumption unsafe: the request value
   * is still `twitter` while responses may carry either `twitter` or `x`
   * depending on the provider's own migration, and a strict match silently
   * drops every post — a sync that succeeds with zero results, which is the
   * hardest failure to notice.
   */
  networkAliases?: Partial<Record<Platform, string[]>>;
  /** Header carrying the per-connected-account key on multi-user plans. */
  accountKeyHeader: string;
  docsUrl: string;
};

const AYRSHARE: UnifiedProvider = {
  id: "ayrshare",
  label: "Ayrshare",
  baseUrl: "https://api.ayrshare.com/api",
  apiKeyEnv: "AYRSHARE_API_KEY",
  networkFor: {
    [Platform.X]: "twitter",
    [Platform.TIKTOK]: "tiktok",
    [Platform.INSTAGRAM]: "instagram",
    [Platform.FACEBOOK]: "facebook",
    [Platform.YOUTUBE]: "youtube",
  },
  networkAliases: {
    [Platform.X]: ["twitter", "x"],
  },
  // Ayrshare scopes a call to one of your users' connected accounts with this
  // header; without it every call answers for the primary profile instead,
  // which in a multi-tenant app means one org reading another's data.
  accountKeyHeader: "Profile-Key",
  docsUrl: "https://docs.ayrshare.com/",
};

const PROVIDERS: Record<string, UnifiedProvider> = {
  ayrshare: AYRSHARE,
};

/**
 * Resolved per call rather than at import — the same reason as
 * `live-adapter.ts`'s `apiBase`: a module constant freezes the environment at
 * whatever it looked like when the file first loaded.
 */
export function unifiedProvider(): UnifiedProvider {
  const id = process.env.SOCIALOS_UNIFIED_PROVIDER?.trim() ?? "ayrshare";
  const provider = PROVIDERS[id];
  if (!provider) {
    throw new Error(
      `Unknown unified provider "${id}". Known: ${Object.keys(PROVIDERS).join(", ")}.`
    );
  }
  // Test seam, matching the OAuth flow's — lets the whole path run against a
  // local fake instead of only ever executing in production.
  const override = process.env.SOCIALOS_UNIFIED_BASE?.trim();
  return override && process.env.VERCEL_ENV !== "production"
    ? { ...provider, baseUrl: override }
    : provider;
}

export function unifiedApiKey(): string | null {
  return process.env[unifiedProvider().apiKeyEnv]?.trim() || null;
}

export function isUnifiedConfigured(): boolean {
  return unifiedApiKey() !== null;
}

/** Why unified can't be selected, or null when it can. */
export function unifiedUnavailableReason(): string | null {
  if (isUnifiedConfigured()) return null;
  const provider = unifiedProvider();
  return `${provider.apiKeyEnv} isn't set. Create an account with ${provider.label} (${provider.docsUrl}) and add the key.`;
}
