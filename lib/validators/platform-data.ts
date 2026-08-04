import { Platform } from "@prisma/client";
import { z } from "zod";

/**
 * Per-platform shapes for Post.platformData (ARCHITECTURE.md §4).
 *
 * The column is deliberately Json so a new Studio doesn't need a migration.
 * These schemas are the contract; everything that reads platformData parses
 * through `parsePlatformData` rather than trusting the shape.
 */

export const xData = z.object({
  kind: z.enum(["tweet", "thread"]).default("tweet"),
  tweets: z.array(z.string()).optional(),
  characters: z.number().optional(),
});

export const tiktokData = z.object({
  kind: z.literal("video").default("video"),
  durationSeconds: z.number().optional(),
  sound: z.string().optional(),
  hashtags: z.array(z.string()).default([]),
});

export const instagramData = z.object({
  kind: z.enum(["post", "reel", "carousel", "story"]).default("post"),
  slides: z.array(z.string()).optional(),
  hashtags: z.array(z.string()).default([]),
});

export const facebookData = z.object({
  kind: z.enum(["post", "event", "group"]).default("post"),
  linkPreview: z.string().nullable().optional(),
  audience: z.string().default("public"),
});

export const youtubeData = z.object({
  kind: z.enum(["video", "short"]).default("video"),
  title: z.string().optional(),
  thumbnailIdeas: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
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
