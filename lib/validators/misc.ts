import { Platform, Role, TaskStatus } from "@prisma/client";
import { z } from "zod";

export const ideaSchema = z.object({
  platform: z.nativeEnum(Platform),
  content: z.string().min(1).max(2000),
  source: z.enum(["manual", "ai", "swipe-file"]).default("manual"),
});

export const campaignSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().default(null),
  startDate: z.coerce.date().nullable().default(null),
  endDate: z.coerce.date().nullable().default(null),
});

export const competitorSchema = z.object({
  platform: z.nativeEnum(Platform),
  handle: z.string().min(1).max(120),
  notes: z.string().max(2000).nullable().default(null),
});

export const brandVoiceSchema = z.object({
  tone: z.string().min(1).max(2000),
  audience: z.string().min(1).max(2000),
  emojiUsage: z.enum(["none", "light", "heavy"]),
  ctaStyle: z.string().min(1).max(1000),
  readingLevel: z.string().min(1).max(500),
  avoidWords: z.array(z.string().max(60)).max(60).default([]),
});

export const taskSchema = z.object({
  title: z.string().min(1).max(280),
  status: z.nativeEnum(TaskStatus).default(TaskStatus.TODO),
  assigneeId: z.string().nullable().default(null),
  dueDate: z.coerce.date().nullable().default(null),
});

export const assetSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(["image", "video", "document", "brand-asset"]),
  url: z.string().min(1),
  folderId: z.string().nullable().default(null),
  tags: z.array(z.string().max(40)).max(20).default([]),
});

export const folderSchema = z.object({
  name: z.string().min(1).max(120),
  parentId: z.string().nullable().default(null),
});

export const memberRoleSchema = z.object({
  membershipId: z.string(),
  role: z.nativeEnum(Role),
});

export const commentSchema = z.object({
  postId: z.string(),
  body: z.string().min(1).max(4000),
});
