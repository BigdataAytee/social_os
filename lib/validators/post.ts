import { Platform, PostStatus } from "@prisma/client";
import { z } from "zod";

import { CHARACTER_LIMITS } from "./platform-data";

export const createPostSchema = z
  .object({
    platform: z.nativeEnum(Platform),
    body: z.string().min(1, "A post needs a body"),
    status: z.nativeEnum(PostStatus).default(PostStatus.DRAFT),
    platformData: z.record(z.string(), z.unknown()).default({}),
    campaignId: z.string().nullable().default(null),
    scheduledAt: z.coerce.date().nullable().default(null),
  })
  .refine((v) => v.body.length <= CHARACTER_LIMITS[v.platform], {
    message: "Body exceeds this platform's character limit",
    path: ["body"],
  })
  .refine(
    (v) =>
      v.status !== PostStatus.SCHEDULED && v.status !== PostStatus.QUEUED
        ? true
        : Boolean(v.scheduledAt),
    { message: "A scheduled post needs a time", path: ["scheduledAt"] }
  );

export const updatePostSchema = z.object({
  id: z.string(),
  body: z.string().min(1).optional(),
  status: z.nativeEnum(PostStatus).optional(),
  platformData: z.record(z.string(), z.unknown()).optional(),
  campaignId: z.string().nullable().optional(),
  scheduledAt: z.coerce.date().nullable().optional(),
});

export const reschedulePostSchema = z.object({
  id: z.string(),
  scheduledAt: z.coerce.date(),
});

export type CreatePostInput = z.input<typeof createPostSchema>;
export type UpdatePostInput = z.input<typeof updatePostSchema>;
