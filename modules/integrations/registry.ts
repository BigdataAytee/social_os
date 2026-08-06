import { IntegrationMode, Platform } from "@prisma/client";

import { isEncryptionConfigured } from "@/lib/crypto";
import { LiveAdapter } from "./live-adapter";
import { MockAdapter } from "./mock-adapter";
import { OAUTH_PROVIDERS, isPlatformConfigured } from "./oauth/providers";
import { UnifiedAdapter } from "./unified/adapter";
import { isUnifiedConfigured, unifiedUnavailableReason } from "./unified/provider";
import type { PlatformAdapter } from "./types";

/**
 * The adapter registry (ARCHITECTURE.md §10, Platform-Connections.md §4).
 *
 * Which implementation answers for an account is a stored field, not a global
 * decision — that is what lets X run on `DIRECT`, where its per-call cost buys
 * full control, while TikTok and Meta stay on `UNIFIED` to skip their review
 * queues. Four rows with one column set differently, not a fork in the codebase.
 *
 * Nothing above this layer can tell which one answered. Studios, the insights
 * module and the Growth Strategist only ever see `PlatformAdapter`.
 *
 * Instances are per platform for all three modes, including unified: §4 sketches
 * one `unifiedAdapter` with the platform passed per call, but `PlatformAdapter`
 * carries `platform` as a property, so this returns a thin per-platform binding
 * over the one shared client in `unified/client.ts`. There is one implementation
 * of the provider protocol, which is the part that mattered.
 */

const MOCKS: Record<Platform, MockAdapter> = {
  [Platform.X]: new MockAdapter(Platform.X),
  [Platform.TIKTOK]: new MockAdapter(Platform.TIKTOK),
  [Platform.INSTAGRAM]: new MockAdapter(Platform.INSTAGRAM),
  [Platform.FACEBOOK]: new MockAdapter(Platform.FACEBOOK),
  [Platform.YOUTUBE]: new MockAdapter(Platform.YOUTUBE),
};

const DIRECT: Record<Platform, LiveAdapter> = {
  [Platform.X]: new LiveAdapter(Platform.X),
  [Platform.TIKTOK]: new LiveAdapter(Platform.TIKTOK),
  [Platform.INSTAGRAM]: new LiveAdapter(Platform.INSTAGRAM),
  [Platform.FACEBOOK]: new LiveAdapter(Platform.FACEBOOK),
  [Platform.YOUTUBE]: new LiveAdapter(Platform.YOUTUBE),
};

const UNIFIED: Record<Platform, UnifiedAdapter> = {
  [Platform.X]: new UnifiedAdapter(Platform.X),
  [Platform.TIKTOK]: new UnifiedAdapter(Platform.TIKTOK),
  [Platform.INSTAGRAM]: new UnifiedAdapter(Platform.INSTAGRAM),
  [Platform.FACEBOOK]: new UnifiedAdapter(Platform.FACEBOOK),
  [Platform.YOUTUBE]: new UnifiedAdapter(Platform.YOUTUBE),
};

/**
 * Can a direct integration be *built* for this platform right now?
 *
 * Both halves are required: OAuth client credentials, and an encryption key to
 * store the resulting tokens with. Without the key we could complete the OAuth
 * dance and then have nowhere safe to put the token.
 */
export function isDirectAvailable(platform: Platform): boolean {
  return isPlatformConfigured(platform) && isEncryptionConfigured();
}

export function isUnifiedAvailable(): boolean {
  return isUnifiedConfigured() && isEncryptionConfigured();
}

export type ModeAvailability = {
  mode: IntegrationMode | null;
  available: boolean;
  /** Why not, when unavailable — shown in the Settings tooltip (§4). */
  reason: string | null;
};

/** Every mode's state for one platform, for the Settings selector (§4). */
export function modeAvailability(platform: Platform): ModeAvailability[] {
  const noKey = !isEncryptionConfigured()
    ? "SOCIALOS_ENCRYPTION_KEY isn't set, so a real connection's credentials couldn't be stored safely."
    : null;

  return [
    { mode: null, available: true, reason: null },
    {
      mode: IntegrationMode.UNIFIED,
      available: isUnifiedAvailable(),
      reason: noKey ?? unifiedUnavailableReason(),
    },
    {
      mode: IntegrationMode.DIRECT,
      available: isDirectAvailable(platform),
      reason: noKey ?? directUnavailableReason(platform),
    },
  ];
}

function directUnavailableReason(platform: Platform): string | null {
  if (isDirectAvailable(platform)) return null;
  const provider = OAUTH_PROVIDERS[platform];
  return `${provider.clientIdEnv} and ${provider.clientSecretEnv} aren't set. A direct integration needs an app in the ${provider.label} developer console, and that platform's own review before it works for anyone but your test accounts.`;
}

/**
 * Resolve the adapter for one account.
 *
 * `mode` comes from `ConnectedAccount.integrationMode` — null while the account
 * is still MOCK. Callers pass the account's own value rather than a constant;
 * see the note at the top of this file for why that matters.
 *
 * A mode whose configuration has since gone away falls back to the mock rather
 * than throwing. An org that loses its provider key should see demo data and a
 * "reconnect" prompt, not five hundred pages.
 */
export function getAdapter(
  platform: Platform,
  mode: IntegrationMode | null
): PlatformAdapter {
  if (!mode) return MOCKS[platform];
  if (mode === IntegrationMode.UNIFIED) {
    return isUnifiedAvailable() ? UNIFIED[platform] : MOCKS[platform];
  }
  return isDirectAvailable(platform) ? DIRECT[platform] : MOCKS[platform];
}

/**
 * The adapter for surfaces that aren't scoped to one account — trend panels,
 * which read a platform-wide feed rather than an org's own data.
 *
 * Separate from `getAdapter` on purpose: making the account-scoped call take an
 * optional mode would let a caller silently omit it and get the wrong adapter.
 */
export function getPlatformAdapter(platform: Platform): PlatformAdapter {
  return MOCKS[platform];
}

export { type PlatformAdapter, type Trend } from "./types";
