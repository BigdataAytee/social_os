import { Platform } from "@prisma/client";
import { z } from "zod";

/**
 * Per-platform shapes for Post.platformData (ARCHITECTURE.md §4).
 *
 * The column is deliberately Json so a new Studio doesn't need a migration.
 * These schemas are the contract; everything that reads platformData parses
 * through `parsePlatformData` rather than trusting the shape.
 */

/**
 * The native shapes (Platform-Native-Studios.md §1).
 *
 * Each is what that platform actually rewards, not a generic post with extra
 * fields: a thread is a list of tweets because that's the unit X publishes; a
 * TikTok is beats because that's what a script is; a carousel is slides because
 * the cover decides whether anyone swipes at all.
 *
 * `kind` is the discriminator the Growth Strategist groups by when it compares
 * content types (Growth-Strategist-Engine.md §1.2), so it has to be present and
 * meaningful on every row.
 */

/** Shared by TikTok scripts, Instagram Reels and YouTube Shorts. */
function tiktokBeats() {
  return z.array(
    z.object({
      t: z.string().default(""),
      action: z.string().default(""),
      onScreenText: z.string().default(""),
    })
  );
}

export const xData = z.object({
  kind: z.enum(["tweet", "thread"]).default("tweet"),
  /** One entry per tweet card. A single tweet is a one-element list. */
  tweets: z.array(z.string()).default([]),
  /** URL of the post being quoted, when this adds a take on top of one. */
  quoteOf: z.string().nullable().default(null),
  mediaCard: z
    .object({
      type: z.enum(["stat-card", "screenshot", "none"]).default("none"),
      assetId: z.string().nullable().default(null),
    })
    .default({ type: "none", assetId: null }),
  characters: z.number().optional(),
});

export const tiktokData = z.object({
  kind: z.enum(["script", "reel"]).default("script"),
  /** The 0–3 second hook. Its own field because it does different work. */
  hookLine: z.string().default(""),
  beats: z
    .array(
      z.object({
        t: z.string().default(""),
        action: z.string().default(""),
        onScreenText: z.string().default(""),
      })
    )
    .default([]),
  soundId: z.string().nullable().default(null),
  durationTargetSec: z.number().default(30),
  hashtags: z.array(z.string()).default([]),
});

export const instagramData = z.object({
  kind: z.enum(["carousel", "reel", "post", "story"]).default("carousel"),
  /** Pulled out of the deck: the cover decides whether anyone swipes. */
  coverHook: z.string().default(""),
  slides: z
    .array(
      z.object({
        headline: z.string().default(""),
        body: z.string().default(""),
        template: z
          .enum(["list-item", "stat", "quote", "step", "cover", "close"])
          .default("list-item"),
      })
    )
    .default([]),
  /** Reels reuse TikTok's beat shape. */
  hookLine: z.string().optional(),
  beats: tiktokBeats().optional(),
  hashtags: z.array(z.string()).default([]),
});

export const facebookData = z.object({
  kind: z.enum(["post", "event", "group"]).default("post"),
  body: z.string().default(""),
  linkCard: z
    .object({
      url: z.string().nullable().default(null),
      title: z.string().nullable().default(null),
    })
    .default({ url: null, title: null }),
  /** First-class, not buried at the end of the body — the algorithm rewards
   *  comments specifically, and a prompt tacked on gets skimmed past. */
  discussionPrompt: z.string().default(""),
  audience: z.string().default("public"),
});

export const youtubeData = z.object({
  kind: z.enum(["long-form", "short"]).default("long-form"),
  /** Titles and thumbnails are designed as one unit and iterated together, so
   *  they're parallel arrays of paired concepts rather than separate fields. */
  titleOptions: z.array(z.string()).default([]),
  thumbnailConcepts: z.array(z.string()).default([]),
  chapters: z
    .array(
      z.object({
        time: z.string().default("0:00"),
        label: z.string().default(""),
      })
    )
    .default([]),
  /** Shorts reuse TikTok's beats, plus keywords for YouTube search. */
  hookLine: z.string().optional(),
  beats: tiktokBeats().optional(),
  keywords: z.array(z.string()).default([]),
});

const SCHEMAS = {
  [Platform.X]: xData,
  [Platform.TIKTOK]: tiktokData,
  [Platform.INSTAGRAM]: instagramData,
  [Platform.FACEBOOK]: facebookData,
  [Platform.YOUTUBE]: youtubeData,
} as const;

export type PlatformData = {
  [Platform.X]: z.infer<typeof xData>;
  [Platform.TIKTOK]: z.infer<typeof tiktokData>;
  [Platform.INSTAGRAM]: z.infer<typeof instagramData>;
  [Platform.FACEBOOK]: z.infer<typeof facebookData>;
  [Platform.YOUTUBE]: z.infer<typeof youtubeData>;
};

/** Never throws — seeded/legacy rows fall back to the schema's defaults. */
export function parsePlatformData<P extends Platform>(
  platform: P,
  value: unknown
): PlatformData[P] {
  const parsed = SCHEMAS[platform].safeParse(value ?? {});
  return (parsed.success
    ? parsed.data
    : SCHEMAS[platform].parse({})) as PlatformData[P];
}

/** Per-platform body limits, enforced in the composer and the service layer. */
export const CHARACTER_LIMITS: Record<Platform, number> = {
  [Platform.X]: 280,
  [Platform.TIKTOK]: 2200,
  [Platform.INSTAGRAM]: 2200,
  [Platform.FACEBOOK]: 63206,
  [Platform.YOUTUBE]: 5000,
};

/**
 * Kinds whose body is several units joined together, not one post.
 *
 * A thread's rendered body is every tweet concatenated, so measuring it against
 * X's 280 is measuring the wrong thing — the limit applies per tweet, and each
 * card enforces it in the composer. Before the native shapes existed every post
 * was a single unit and this distinction couldn't arise; now it's the difference
 * between threads being saveable and not.
 */
const MULTI_PART_KINDS = new Set([
  "thread",
  "script",
  "reel",
  "carousel",
  "short",
  "long-form",
]);

/**
 * The limit that actually applies to a post's `body`, given its native shape.
 *
 * Multi-part kinds still get a ceiling — an unbounded body would let a runaway
 * generation write a novel into a column the queue has to render — but it's the
 * sum of a sensible number of units rather than one unit's limit.
 */
export function bodyLimitFor(
  platform: Platform,
  platformData: unknown
): number {
  const kind = (platformData as { kind?: string } | null)?.kind;
  const single = CHARACTER_LIMITS[platform];
  return kind && MULTI_PART_KINDS.has(kind) ? Math.max(single * 25, 10_000) : single;
}
