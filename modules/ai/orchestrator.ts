import { Platform, PostStatus } from "@prisma/client";
import { z } from "zod";

import { assertCan } from "@/lib/auth/permissions";
import type { Session } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  accountIdeasSchema,
  generateSchema,
  type GenerationType,
} from "@/lib/validators/ai";
import { CHARACTER_LIMITS } from "@/lib/validators/platform-data";
import { brandProfileBlock, getBrandProfile } from "@/modules/brandbrain/service";
import { getBrandVoice } from "@/modules/brandvoice/service";
import { createIdea, listIdeas } from "@/modules/ideas/service";
import {
  describeInsights,
  getAccountInsights,
  type AccountInsights,
} from "@/modules/insights/service";
import { recall, remember } from "@/modules/memory/service";
import { createPost, updatePost } from "@/modules/posts/service";
import { systemPrompt, userPrompt } from "./prompts";
import {
  chat as providerChat,
  complete,
  isModelConfigured,
  type ProviderMessage,
  type ProviderSource,
  type ToolSpec,
} from "./provider";

/**
 * The AI orchestrator (ARCHITECTURE.md §9).
 *
 * Single entry point for every AI feature in the product. Tool calls map to the
 * service layer, never to Prisma — that is what keeps "the AI path is the real
 * path" (§2.3) true rather than aspirational.
 */

export { isModelConfigured };

export type GenerationResult = {
  id: string;
  output: string;
  source: ProviderSource;
};

/** Types whose output is several posts, options or beats — not one post. */
const MULTI_PART_TYPES = new Set<GenerationType>([
  "thread",
  "hook",
  "idea",
  "title",
  "thumbnail",
  "script",
  "repurpose",
  "chat",
]);

/**
 * Assemble the system prompt: stated voice, measured voice, and the org's own
 * relevant history.
 *
 * `recallQuery` is optional and the retrieval is deliberately best-effort —
 * every failure mode here degrades to the prompt this function returned before
 * stage 4 existed, rather than failing a generation. A brand profile that can't
 * be read or a memory index that isn't built yet must not stop someone writing
 * a post.
 */
async function context(
  session: Session,
  platform: Platform | null,
  recallQuery?: string
) {
  const [voice, profile, recalled] = await Promise.all([
    getBrandVoice(session),
    getBrandProfile(session).catch(() => null),
    recallQuery ? recallFor(session, recallQuery) : Promise.resolve(""),
  ]);

  return systemPrompt({
    voice,
    platform,
    orgName: session.orgName,
    profile: brandProfileBlock(profile),
    recalled,
  });
}

async function recallFor(session: Session, query: string): Promise<string> {
  try {
    const hits = await recall(session, query, { take: 5 });
    return hits
      .map((hit) => {
        // The score is the reason the model should weight one over another, so
        // it is stated rather than merely used for ordering.
        const performance =
          hit.score !== null && hit.score > 0
            ? ` (${hit.score.toFixed(1)}% engagement)`
            : "";
        return `- ${hit.text.replace(/\s+/g, " ").slice(0, 280)}${performance}`;
      })
      .join("\n");
  } catch {
    // Most likely the memory index has never been built for this org. Silence
    // is correct: the generation proceeds without retrieval.
    return "";
  }
}

/** Every Studio AI feature funnels through here — feature = prompt + type. */
export async function generate(
  session: Session,
  input: z.input<typeof generateSchema>
): Promise<GenerationResult> {
  assertCan(session.role, "ai.generate");
  const data = generateSchema.parse(input);

  // The user's own brief is the retrieval query — it is the best available
  // description of what they want, and it is what they'd have typed into a
  // search box if we'd asked them to do the retrieval by hand.
  const system = await context(session, data.studio, data.input);

  // Multi-part formats legitimately exceed a single post's limit; single-post
  // formats do not, and handing back an over-limit draft the composer will
  // reject is worse than no draft at all.
  const singlePost = !MULTI_PART_TYPES.has(data.type);

  const result = await complete({
    system,
    messages: [
      {
        role: "user",
        content: userPrompt({
          type: data.type,
          input: data.input,
          context: data.context,
        }),
      },
    ],
    maxChars: singlePost ? CHARACTER_LIMITS[data.studio] : undefined,
  });

  // Persisted as an AIGeneration row — audit trail and the source for the
  // "recent generations" surfaces (§9).
  const row = await db.aIGeneration.create({
    data: {
      orgId: session.orgId,
      userId: session.userId,
      studio: data.studio,
      type: data.type,
      input: data.input,
      output: result.text,
    },
  });

  // Index as we go, so the corpus stays current without waiting for the nightly
  // reindex. Awaited rather than fired and forgotten: an unawaited promise in a
  // serverless function is cancelled the moment the response is sent.
  await remember({
    orgId: session.orgId,
    sourceType: "generation",
    sourceId: row.id,
    text: result.text,
    metadata: { type: data.type, studio: data.studio },
  }).catch(() => null);

  return { id: row.id, output: result.text, source: result.source };
}

export async function listGenerations(
  session: Session,
  filters: { studio?: Platform; type?: GenerationType; take?: number } = {}
) {
  return db.aIGeneration.findMany({
    where: {
      orgId: session.orgId,
      ...(filters.studio ? { studio: filters.studio } : {}),
      ...(filters.type ? { type: filters.type } : {}),
    },
    include: { user: true },
    orderBy: { createdAt: "desc" },
    take: filters.take ?? 20,
  });
}

/**
 * "Repurpose this into everything" (Phase 4). One input becomes a real draft
 * per platform — created through createPost, so they are ordinary posts that
 * show up in the queue and the calendar like any other.
 */
export async function repurpose(
  session: Session,
  input: { input: string; platforms: Platform[] }
) {
  assertCan(session.role, "ai.generate");

  const results = [];
  for (const platform of input.platforms) {
    const generated = await generate(session, {
      studio: platform,
      type: "repurpose",
      input: input.input,
    });

    const post = await createPost(session, {
      platform,
      body: truncateForPlatform(platform, generated.output),
      status: PostStatus.DRAFT,
      platformData: {},
    });

    results.push({ platform, post, source: generated.source });
  }

  return results;
}

export type AccountIdeasResult = {
  ideas: string[];
  insights: AccountInsights;
  source: ProviderSource;
  generationId: string;
};

/**
 * Ideas derived from a connected account's own performance.
 *
 * The distinction from `generate({ type: "idea" })` is the input: that one works
 * from a prompt, this one works from what the account actually published and how
 * it did. The analysis happens in modules/insights — the model is handed a
 * finished report and asked to act on it, rather than being handed raw rows and
 * trusted to do arithmetic.
 */
export async function generateIdeasFromAccount(
  session: Session,
  input: z.input<typeof accountIdeasSchema>
): Promise<AccountIdeasResult> {
  assertCan(session.role, "ai.generate");
  const data = accountIdeasSchema.parse(input);

  const insights = await getAccountInsights(session, {
    platform: data.studio,
    days: data.days,
  });

  // Nothing synced, or too few posts for any bucket to clear its threshold.
  // Returning early beats asking the model to find patterns in three posts,
  // which it will do, convincingly and wrongly.
  if (insights.thin) {
    return { ideas: [], insights, source: "local", generationId: "" };
  }

  const report = describeInsights(insights);
  const result = await complete({
    system: await context(session, data.studio),
    messages: [
      {
        role: "user",
        content: userPrompt({
          type: "account-ideas",
          input: report,
          context: [
            `Generate exactly ${data.count} ideas.`,
            data.context,
          ]
            .filter(Boolean)
            .join(" "),
        }),
      },
    ],
  });

  const row = await db.aIGeneration.create({
    data: {
      orgId: session.orgId,
      userId: session.userId,
      studio: data.studio,
      type: "account-ideas",
      input: report,
      output: result.text,
    },
  });

  return {
    ideas: splitIdeas(result.text, data.count),
    insights,
    source: result.source,
    generationId: row.id,
  };
}

/** One idea per line, tolerating the numbering and bullets models add anyway. */
function splitIdeas(text: string, limit: number): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((line) => line.length > 8)
    .slice(0, limit);
}

// ------------------------------------------------------------- tool calling

const TOOLS: ToolSpec[] = [
  {
    name: "createPost",
    description:
      "Create a draft post in a Studio. Use when the person asks you to write and save something, not when they only want to see text. Call this once per platform.",
    input_schema: {
      type: "object",
      properties: {
        platform: {
          type: "string",
          enum: Object.values(Platform),
          description: "Which Studio the post belongs to",
        },
        body: { type: "string", description: "The post copy itself" },
      },
      required: ["platform", "body"],
    },
  },
  {
    name: "scheduleContent",
    description:
      "Schedule an existing post for a specific time. Call this when the person asks to schedule or move something and you know the post id.",
    input_schema: {
      type: "object",
      properties: {
        postId: { type: "string" },
        scheduledAt: {
          type: "string",
          description: "ISO 8601 timestamp for when it should go out",
        },
      },
      required: ["postId", "scheduledAt"],
    },
  },
  {
    name: "repurposeContent",
    description:
      "Turn one piece of source material into a draft for several platforms at once. Prefer this over calling createPost repeatedly.",
    input_schema: {
      type: "object",
      properties: {
        input: { type: "string", description: "The source material" },
        platforms: {
          type: "array",
          items: { type: "string", enum: Object.values(Platform) },
        },
      },
      required: ["input", "platforms"],
    },
  },
  {
    name: "saveIdea",
    description: "Save a content idea to the idea list for later.",
    input_schema: {
      type: "object",
      properties: {
        platform: { type: "string", enum: Object.values(Platform) },
        content: { type: "string" },
      },
      required: ["platform", "content"],
    },
  },
  {
    name: "generateIdeasFromAccount",
    description:
      "Analyse a connected account's real performance data — top posts, which formats and posting times work, which topics outperform — and produce content ideas grounded in it. Use this whenever the person asks what they should post, what's working, or why something did well. Prefer it over inventing ideas from nothing when the account is connected.",
    input_schema: {
      type: "object",
      properties: {
        platform: {
          type: "string",
          enum: Object.values(Platform),
          description: "Which connected account to analyse",
        },
        days: {
          type: "number",
          description: "How far back to analyse. Defaults to 90.",
        },
        count: {
          type: "number",
          description: "How many ideas to return. Defaults to 5.",
        },
      },
      required: ["platform"],
    },
  },
  {
    name: "listIdeas",
    description:
      "Read the saved idea list. Call this when the person asks what ideas they have, or asks you to build on an existing one.",
    input_schema: {
      type: "object",
      properties: {
        platform: { type: "string", enum: Object.values(Platform) },
      },
      required: [],
    },
  },
];

export type ChatToolEffect = {
  name: string;
  summary: string;
  postIds: string[];
};

export type ChatResult = {
  text: string;
  effects: ChatToolEffect[];
  source: ProviderSource;
};

/**
 * A chat turn. Runs the tool loop to completion so the caller gets a settled
 * answer plus whatever actually changed in the database.
 */
export async function chat(
  session: Session,
  opts: { messages: ProviderMessage[]; studio: Platform | null }
): Promise<ChatResult> {
  assertCan(session.role, "ai.generate");

  // Retrieve against the latest user turn only. Concatenating the whole
  // conversation would blur the query into every topic discussed so far, and
  // full-text search rewards a focused query.
  const latest = [...opts.messages]
    .reverse()
    .find((message) => message.role === "user");

  const system = await context(
    session,
    opts.studio,
    typeof latest?.content === "string" ? latest.content : undefined
  );
  const messages = [...opts.messages];
  const effects: ChatToolEffect[] = [];

  let source: ProviderSource = "local";
  let text = "";

  // Bounded: the assistant gets a few rounds to finish its tool work, then we
  // return whatever it has rather than looping indefinitely.
  for (let round = 0; round < 4; round++) {
    const result = await providerChat({ system, messages, tools: TOOLS });
    source = result.source;
    text = result.text || text;

    if (result.toolCalls.length === 0) break;

    const outcomes: string[] = [];
    for (const call of result.toolCalls) {
      const effect = await runTool(session, call.name, call.input);
      effects.push(effect);
      outcomes.push(`${call.name}: ${effect.summary}`);
    }

    // Feed the outcomes back as an ordinary turn. Keeping this in plain text
    // (rather than the tool_result block shape) means the same loop works
    // identically against the local provider, which has no tool protocol.
    messages.push({ role: "assistant", content: text || "(working)" });
    messages.push({
      role: "user",
      content: `Results of those actions:\n${outcomes.join("\n")}\n\nTell me what you did, briefly.`,
    });
  }

  return { text, effects, source };
}

async function runTool(
  session: Session,
  name: string,
  input: Record<string, unknown>
): Promise<ChatToolEffect> {
  switch (name) {
    case "createPost": {
      const post = await createPost(session, {
        platform: input.platform as Platform,
        body: truncateForPlatform(
          input.platform as Platform,
          String(input.body ?? "")
        ),
        status: PostStatus.DRAFT,
        platformData: {},
      });
      return {
        name,
        summary: `created a ${post.platform} draft`,
        postIds: [post.id],
      };
    }

    case "scheduleContent": {
      const post = await updatePost(session, {
        id: String(input.postId ?? ""),
        status: PostStatus.SCHEDULED,
        scheduledAt: new Date(String(input.scheduledAt ?? "")),
      });
      return {
        name,
        summary: `scheduled a ${post.platform} post`,
        postIds: [post.id],
      };
    }

    case "repurposeContent": {
      const created = await repurpose(session, {
        input: String(input.input ?? ""),
        platforms: (input.platforms as Platform[]) ?? [],
      });
      return {
        name,
        summary: `created ${created.length} drafts`,
        postIds: created.map((c) => c.post.id),
      };
    }

    case "saveIdea": {
      await createIdea(session, {
        platform: input.platform as Platform,
        content: String(input.content ?? ""),
        source: "ai",
      });
      return { name, summary: "saved an idea", postIds: [] };
    }

    case "generateIdeasFromAccount": {
      const result = await generateIdeasFromAccount(session, {
        studio: input.platform as Platform,
        days: typeof input.days === "number" ? input.days : undefined,
        count: typeof input.count === "number" ? input.count : undefined,
      });

      if (result.insights.sampleSize === 0) {
        return {
          name,
          summary: `no posts have been pulled from ${input.platform} yet — connect the account in that Studio first`,
          postIds: [],
        };
      }
      if (result.insights.thin) {
        return {
          name,
          summary: `only ${result.insights.sampleSize} posts pulled from ${input.platform} — too few to find a reliable pattern`,
          postIds: [],
        };
      }

      // The report goes back to the model, not just the ideas: the next turn is
      // usually "why?", and without the numbers it would have to invent them.
      return {
        name,
        summary: [
          describeInsights(result.insights),
          "",
          "Ideas generated:",
          ...result.ideas.map((idea) => `- ${idea}`),
        ].join("\n"),
        postIds: [],
      };
    }

    case "listIdeas": {
      const ideas = await listIdeas(session, {
        platform: input.platform as Platform | undefined,
        take: 10,
      });
      return {
        name,
        summary:
          ideas.length === 0
            ? "no saved ideas"
            : ideas.map((i) => `- ${i.content}`).join("\n"),
        postIds: [],
      };
    }

    default:
      return { name, summary: `unknown tool ${name}`, postIds: [] };
  }
}

function truncateForPlatform(platform: Platform, text: string) {
  const limits: Record<Platform, number> = {
    [Platform.X]: 280,
    [Platform.TIKTOK]: 2200,
    [Platform.INSTAGRAM]: 2200,
    [Platform.FACEBOOK]: 63206,
    [Platform.YOUTUBE]: 5000,
  };
  const limit = limits[platform];
  const trimmed = text.trim();
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit - 1)}…`;
}
