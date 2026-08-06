"use client";

import { Platform } from "@prisma/client";

import { FacebookComposer } from "./facebook-composer";
import { InstagramComposer } from "./instagram-composer";
import { TikTokComposer } from "./tiktok-composer";
import { XComposer } from "./x-composer";
import { YouTubeComposer } from "./youtube-composer";

/**
 * Picks the Studio's native composer (Platform-Native-Studios.md §1).
 *
 * A switch rather than a config map, so adding a platform is a compile error
 * here rather than a silent fallback to a generic form — which is exactly the
 * failure this whole step exists to undo.
 */
export function NativeComposer(props: {
  platform: Platform;
  seed: string;
  campaigns: { id: string; name: string }[];
  canSchedule: boolean;
  onConsumed: () => void;
}) {
  const { platform, ...rest } = props;
  switch (platform) {
    case Platform.X:
      return <XComposer {...rest} />;
    case Platform.TIKTOK:
      return <TikTokComposer {...rest} />;
    case Platform.INSTAGRAM:
      return <InstagramComposer {...rest} />;
    case Platform.FACEBOOK:
      return <FacebookComposer {...rest} />;
    case Platform.YOUTUBE:
      return <YouTubeComposer {...rest} />;
  }
}
