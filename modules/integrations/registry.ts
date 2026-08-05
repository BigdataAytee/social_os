import { Platform } from "@prisma/client";

import { isEncryptionConfigured } from "@/lib/crypto";
import { LiveAdapter } from "./live-adapter";
import { MockAdapter } from "./mock-adapter";
import { isPlatformConfigured } from "./oauth/providers";
import type { PlatformAdapter } from "./types";

/**
 * The adapter registry (ARCHITECTURE.md §10).
 *
 * Selection is per-request rather than a module-level constant, because whether
 * a platform has a real adapter now depends on environment variables — and a
 * constant evaluated at import time would freeze that decision at whatever the
 * environment looked like when the module first loaded.
 *
 * A platform gets the live adapter only when both halves are present: OAuth
 * client credentials, and an encryption key to store the resulting tokens with.
 * Without the key we could complete the OAuth dance and then have nowhere safe
 * to put the token, so the mock is the honest answer.
 */

const MOCKS: Record<Platform, MockAdapter> = {
  [Platform.X]: new MockAdapter(Platform.X),
  [Platform.TIKTOK]: new MockAdapter(Platform.TIKTOK),
  [Platform.INSTAGRAM]: new MockAdapter(Platform.INSTAGRAM),
  [Platform.FACEBOOK]: new MockAdapter(Platform.FACEBOOK),
  [Platform.YOUTUBE]: new MockAdapter(Platform.YOUTUBE),
};

const LIVE: Record<Platform, LiveAdapter> = {
  [Platform.X]: new LiveAdapter(Platform.X),
  [Platform.TIKTOK]: new LiveAdapter(Platform.TIKTOK),
  [Platform.INSTAGRAM]: new LiveAdapter(Platform.INSTAGRAM),
  [Platform.FACEBOOK]: new LiveAdapter(Platform.FACEBOOK),
  [Platform.YOUTUBE]: new LiveAdapter(Platform.YOUTUBE),
};

export function isLivePlatform(platform: Platform): boolean {
  return isPlatformConfigured(platform) && isEncryptionConfigured();
}

export function getAdapter(platform: Platform): PlatformAdapter {
  return isLivePlatform(platform) ? LIVE[platform] : MOCKS[platform];
}

export { type PlatformAdapter, type Trend } from "./types";
