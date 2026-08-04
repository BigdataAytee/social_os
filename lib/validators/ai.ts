import { Platform } from "@prisma/client";
import { z } from "zod";

/**
 * AIGeneration.type is a string in the schema, not an enum, because AI feature
 * types churn every phase (ARCHITECTURE.md §4). This is where they're validated.
 */
export const GENERATION_TYPES = [
  "tweet",
  "thread",
  "hook",
  "reply",
  "quote-tweet",
  "caption",
  "script",
  "idea",
  "title",
  "description",
  "thumbnail",
  "long-form",
  "comment",
  "repurpose",
  "chat",
] as const;

export type GenerationType = (typeof GENERATION_TYPES)[number];

export const generateSchema = z.object({
  studio: z.nativeEnum(Platform),
  type: z.enum(GENERATION_TYPES),
  input: z.string().min(1, "Give the assistant something to work with").max(4000),
  /** Optional extra steer, e.g. a tone override for this one generation. */
  context: z.string().max(2000).optional(),
});

export const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })
    )
    .min(1),
  studio: z.nativeEnum(Platform).nullable().default(null),
});

export const repurposeSchema = z.object({
  input: z.string().min(1).max(4000),
  platforms: z.array(z.nativeEnum(Platform)).min(1),
});

export type GenerateInput = z.infer<typeof generateSchema>;
