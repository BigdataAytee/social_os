import { Platform } from "@prisma/client";

/**
 * The Studio registry (ARCHITECTURE.md §6).
 *
 * Single source of truth for the five Studios: sidebar, Studio Switcher, route
 * params and per-Studio theming all read from here. Adding a Studio is a
 * registry entry plus a route folder — nothing else should hardcode this list.
 */

export type StudioSlug = "x" | "tiktok" | "instagram" | "facebook" | "youtube";

export type Studio = {
  slug: StudioSlug;
  platform: Platform;
  label: string;
  /** Short line shown in the switcher. */
  tagline: string;
  /** Tailwind token name — resolves to --studio-<slug> in styles/tokens.css. */
  accentVar: string;
  /** Features this Studio ships (PROGRESS.md phases 2-3). Rendered as the
   *  placeholder checklist until each one is built. */
  features: string[];
};

export const STUDIOS: Studio[] = [
  {
    slug: "x",
    platform: Platform.X,
    label: "X",
    tagline: "Tweets, threads, hooks",
    accentVar: "--studio-x",
    features: [
      "AI Tweet Writer",
      "Thread Builder",
      "Hook Generator",
      "Viral Tweet Library",
      "Swipe File",
      "Saved Ideas",
      "Trending Topics",
      "Competitor Tracking",
      "Quote Tweet Generator",
      "Reply Generator",
      "Scheduling",
      "Content Queue",
      "Analytics",
      "Best Posting Times",
      "Engagement Predictions",
      "Templates",
    ],
  },
  {
    slug: "tiktok",
    platform: Platform.TIKTOK,
    label: "TikTok",
    tagline: "Trends, sounds, scripts",
    accentVar: "--studio-tiktok",
    features: [
      "Trend Discovery",
      "Trending Sounds",
      "Trending Hashtags",
      "Competitor Analysis",
      "Creator Discovery",
      "Hook Generator",
      "AI Video Script Generator",
      "Caption Generator",
      "Idea Generator",
      "Trend Alerts",
      "Analytics",
      "Content Calendar",
      "Performance Tracking",
    ],
  },
  {
    slug: "instagram",
    platform: Platform.INSTAGRAM,
    label: "Instagram",
    tagline: "Reels, carousels, stories",
    accentVar: "--studio-instagram",
    features: [
      "Reel Planner",
      "Carousel Builder",
      "Story Planner",
      "Caption Generator",
      "Hashtag Research",
      "AI Post Generator",
      "Brand Voice",
      "Competitor Analysis",
      "Scheduler",
      "Analytics",
      "Engagement Tracker",
    ],
  },
  {
    slug: "facebook",
    platform: Platform.FACEBOOK,
    label: "Facebook",
    tagline: "Pages, groups, community",
    accentVar: "--studio-facebook",
    features: [
      "AI Post Writer",
      "Long-form Content Generator",
      "Community Management",
      "Group Content Planner",
      "Business Page Manager",
      "Event Promotion",
      "Comment Assistant",
      "Messenger Templates",
      "Analytics",
      "Scheduler",
      "Campaign Planner",
    ],
  },
  {
    slug: "youtube",
    platform: Platform.YOUTUBE,
    label: "YouTube",
    tagline: "Scripts, SEO, thumbnails",
    accentVar: "--studio-youtube",
    features: [
      "Topic Research",
      "Keyword Explorer",
      "Video SEO",
      "AI Script Writer",
      "Title Generator",
      "Description Generator",
      "Thumbnail Ideas",
      "Shorts Generator",
      "Competitor Analysis",
      "Analytics",
      "Trend Explorer",
    ],
  },
];

const BY_SLUG = new Map(STUDIOS.map((s) => [s.slug, s]));
const BY_PLATFORM = new Map(STUDIOS.map((s) => [s.platform, s]));

export function getStudio(slug: string): Studio | undefined {
  return BY_SLUG.get(slug as StudioSlug);
}

export function studioForPlatform(platform: Platform): Studio {
  // Every Platform has a registry entry by construction.
  return BY_PLATFORM.get(platform)!;
}

/**
 * Slug → Platform for route segments that aren't Studio pages — the OAuth
 * callbacks, whose URLs are registered with each platform's developer console
 * and so must stay lowercase and stable.
 */
export function parsePlatformSlug(slug: string): Platform | null {
  return BY_SLUG.get(slug.toLowerCase() as StudioSlug)?.platform ?? null;
}

export const STUDIO_SLUGS = STUDIOS.map((s) => s.slug);
