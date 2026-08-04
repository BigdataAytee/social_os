import { Platform, type BrandVoice } from "@prisma/client";

import { CHARACTER_LIMITS } from "@/lib/validators/platform-data";
import type { GenerationType } from "@/lib/validators/ai";

/**
 * Prompt assembly (ARCHITECTURE.md §9).
 *
 * Studio-specific features are a prompt template plus a `type` string — not
 * separate endpoints. Brand voice is applied in the system prompt, which is what
 * makes "change the tone in Settings, regenerate, get different output" true
 * with no code change.
 */

const PLATFORM_BRIEF: Record<Platform, string> = {
  [Platform.X]:
    "X (formerly Twitter). Terse, high-signal, no hashtag stuffing. A strong first line decides whether anything else gets read.",
  [Platform.TIKTOK]:
    "TikTok. Spoken-word rhythm, written to be read aloud over video. The first three seconds carry the whole post.",
  [Platform.INSTAGRAM]:
    "Instagram. Visual-first; the caption supports an image, reel or carousel rather than standing alone. Saves matter more than likes.",
  [Platform.FACEBOOK]:
    "Facebook. Room for longer, more conversational writing. Community and discussion beat broadcast.",
  [Platform.YOUTUBE]:
    "YouTube. Search-and-browse driven — titles and descriptions are discovery surfaces, not decoration. Retention is the metric that matters.",
};

const TYPE_BRIEF: Record<GenerationType, string> = {
  tweet: "Write a single post. One idea, stated plainly.",
  thread:
    "Write a numbered thread. The first post must earn the second; each subsequent post must be worth reading on its own.",
  hook:
    "Write 5 alternative opening lines. Vary the angle across them — contrarian, numeric, story-led, question-led, and plain-statement.",
  reply:
    "Write a reply that adds something. No empty agreement, no restating the original.",
  "quote-tweet":
    "Write a quote-post that adds a distinct take rather than summarising what's being quoted.",
  caption:
    "Write a caption for the described visual. Open strong; the first line is all most people see.",
  script:
    "Write a short video script with explicit beats: HOOK, then the body beats, then the close. Mark each beat.",
  idea: "Generate 6 distinct content ideas. Each one line, each a different angle.",
  title:
    "Write 6 title options. Vary the formula across them; no clickbait that the content can't pay off.",
  description:
    "Write a description. Lead with what the viewer gets, then the detail, then any links or chapters.",
  thumbnail:
    "Describe 4 thumbnail concepts. Each concrete enough to hand to a designer: subject, composition, and the words on screen.",
  "long-form":
    "Write a longer post that develops one argument. Concrete, with a real example.",
  comment:
    "Write a reply to a community comment. Helpful and human; solve the thing they actually asked about.",
  repurpose:
    "Rewrite the source material for this platform. Keep the substance; change the shape, length and rhythm to fit.",
  chat: "Respond conversationally and concretely.",
};

export function brandVoiceBlock(voice: BrandVoice | null): string {
  if (!voice) {
    return "No brand voice profile is configured yet. Write plainly and avoid marketing filler.";
  }

  const lines = [
    `Tone: ${voice.tone}`,
    `Audience: ${voice.audience}`,
    `Emoji usage: ${voice.emojiUsage}`,
    `Call-to-action style: ${voice.ctaStyle}`,
    `Reading level: ${voice.readingLevel}`,
  ];

  if (voice.avoidWords.length > 0) {
    lines.push(
      `Never use these words or phrases: ${voice.avoidWords.join(", ")}.`
    );
  }

  const terminology = voice.terminology as Record<string, string> | null;
  if (terminology && Object.keys(terminology).length > 0) {
    lines.push(
      `Terminology rules: ${Object.entries(terminology)
        .map(([term, rule]) => `"${term}" — ${rule}`)
        .join("; ")}.`
    );
  }

  return lines.join("\n");
}

export function systemPrompt(opts: {
  voice: BrandVoice | null;
  platform: Platform | null;
  orgName: string;
}) {
  const platformSection = opts.platform
    ? `\n\n## Platform\n${PLATFORM_BRIEF[opts.platform]}\nHard character limit: ${CHARACTER_LIMITS[opts.platform]}.`
    : "";

  return `You are the writing assistant inside SocialOS, working for ${opts.orgName}. You draft social content that a professional social media manager will publish under their own name.

## Brand voice — follow this exactly
${brandVoiceBlock(opts.voice)}${platformSection}

## How to write
Write the content itself. No preamble, no "Here's a draft", no explanation of your choices, no meta-commentary. If you are asked for several options, separate them with a blank line and nothing else — do not number them unless the format calls for numbering.

Be specific. A concrete number, example, or observation beats a general claim. If the request is too vague to write something specific, write the strongest version you can and note in one short line at the end what detail would sharpen it.

Never invent statistics, quotes, results, or customer names. If a claim needs a number the user has not given you, write around it.`;
}

export function userPrompt(opts: {
  type: GenerationType;
  input: string;
  context?: string;
}) {
  return [
    TYPE_BRIEF[opts.type],
    opts.context ? `\nAdditional direction: ${opts.context}` : "",
    `\n---\n${opts.input}`,
  ].join("");
}
