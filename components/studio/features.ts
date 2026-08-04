import { Platform } from "@prisma/client";

import type { GenerateFeature } from "./ai-generate-box";

/**
 * Which AI features each Studio offers (Phase 2 for X, Phase 3 for the rest).
 *
 * Every entry from the brief's per-Studio feature list that produces text lands
 * here as a `type` + label. This is the whole of "Studio-specific AI features"
 * (§9): a prompt template plus a type string, never a separate endpoint.
 */
export const STUDIO_FEATURES: Record<Platform, GenerateFeature[]> = {
  [Platform.X]: [
    {
      type: "tweet",
      label: "Tweet writer",
      placeholder: "The point you want to make, plus any numbers you have.",
    },
    {
      type: "thread",
      label: "Thread builder",
      placeholder: "The argument, and the 3-6 beats it should cover.",
    },
    {
      type: "hook",
      label: "Hook generator",
      placeholder: "What the post is about — you'll get five openings.",
    },
    {
      type: "reply",
      label: "Reply generator",
      placeholder: "Paste the post you're replying to.",
    },
    {
      type: "quote-tweet",
      label: "Quote tweet",
      placeholder: "Paste the post, and your angle on it.",
    },
    {
      type: "idea",
      label: "Idea generator",
      placeholder: "A theme or audience to generate ideas around.",
    },
  ],
  [Platform.TIKTOK]: [
    {
      type: "script",
      label: "Video script",
      placeholder: "The idea, the audience, and roughly how long it should run.",
    },
    {
      type: "hook",
      label: "Hook generator",
      placeholder: "The video's subject — you'll get five three-second openings.",
    },
    {
      type: "caption",
      label: "Caption generator",
      placeholder: "Describe the video the caption sits under.",
    },
    {
      type: "idea",
      label: "Idea generator",
      placeholder: "A niche, trend or format to riff on.",
    },
  ],
  [Platform.INSTAGRAM]: [
    {
      type: "caption",
      label: "Caption generator",
      placeholder: "Describe the image, reel or carousel.",
    },
    {
      type: "idea",
      label: "Carousel / reel planner",
      placeholder: "The topic — you'll get slide-by-slide ideas.",
    },
    {
      type: "hook",
      label: "Hook generator",
      placeholder: "What the post is about.",
    },
    {
      type: "tweet",
      label: "Story copy",
      placeholder: "What the story frame needs to say.",
    },
  ],
  [Platform.FACEBOOK]: [
    {
      type: "long-form",
      label: "Post writer",
      placeholder: "The story or argument, with the detail you want kept.",
    },
    {
      type: "comment",
      label: "Comment assistant",
      placeholder: "Paste the community comment you're answering.",
    },
    {
      type: "idea",
      label: "Group content planner",
      placeholder: "The group's focus and what you want to prompt.",
    },
    {
      type: "tweet",
      label: "Event promotion",
      placeholder: "Event, date, who it's for, and the outcome.",
    },
  ],
  [Platform.YOUTUBE]: [
    {
      type: "script",
      label: "Script writer",
      placeholder: "The video's topic and the promise the title makes.",
    },
    {
      type: "title",
      label: "Title generator",
      placeholder: "What the video covers.",
    },
    {
      type: "description",
      label: "Description generator",
      placeholder: "What the video covers, plus links and chapters.",
    },
    {
      type: "thumbnail",
      label: "Thumbnail ideas",
      placeholder: "The video's subject and its single strongest moment.",
    },
    {
      type: "idea",
      label: "Topic research",
      placeholder: "Your channel's niche.",
    },
  ],
};
