import { Platform } from "@prisma/client";

import { MockAdapter } from "./mock-adapter";
import type { PlatformAdapter } from "./types";

/**
 * The adapter registry (ARCHITECTURE.md §10). Swapping a platform to a real
 * integration is a one-line change here — nothing else in the app knows.
 */
const ADAPTERS: Record<Platform, PlatformAdapter> = {
  [Platform.X]: new MockAdapter(Platform.X),
  [Platform.TIKTOK]: new MockAdapter(Platform.TIKTOK),
  [Platform.INSTAGRAM]: new MockAdapter(Platform.INSTAGRAM),
  [Platform.FACEBOOK]: new MockAdapter(Platform.FACEBOOK),
  [Platform.YOUTUBE]: new MockAdapter(Platform.YOUTUBE),
};

export function getAdapter(platform: Platform): PlatformAdapter {
  return ADAPTERS[platform];
}

export { type PlatformAdapter, type Trend } from "./types";
