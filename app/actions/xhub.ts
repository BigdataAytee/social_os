"use server";

import { revalidatePath } from "next/cache";
import { Platform, PostStatus, XStoryKind } from "@prisma/client";

import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { generate } from "@/modules/ai/orchestrator";
import { createPost } from "@/modules/posts/service";
import { harvest } from "@/modules/xhub/harvest";
import { ingest, listStories, setSaved } from "@/modules/xhub/service";
import {
  buildGist,
  buildNewsStory,
  buildTrendStory,
  deriveTrends,
} from "@/modules/xhub/stories";
import { toActionResult, type ActionResult } from "./result";

/**
 * X Hub actions (X-HUB.md).
 *
 * The one-click actions deliberately route through `generate` and `createPost`
 * rather than a hub-specific pipeline. A caption made here therefore carries
 * the brand voice, the measured brand profile and history retrieval exactly as
 * one made in a Studio, and a drafted post appears in the queue and the
 * calendar like any other. A second content path is how "the AI path is the
 * real path" quietly stops being true.
 */

export async function ingestAction(input: {
  links: string;
}): Promise<ActionResult<{ posts: number; stories: number; skipped: string[] }>> {
  return toActionResult(async () => {
    const session = await requireSession();
    const result = await ingest(session, [input.links]);
    revalidatePath("/hub");
    return result;
  });
}

export async function setSavedAction(input: {
  storyId: string;
  saved: boolean;
}): Promise<ActionResult<{ saved: boolean }>> {
  return toActionResult(async () => {
    const session = await requireSession();
    const story = await setSaved(session, input);
    revalidatePath("/hub");
    return { saved: story.saved };
  });
}

export async function loadMoreAction(input: {
  kind?: XStoryKind;
  saved?: boolean;
  cursor: { score: number; id: string } | null;
}): Promise<ActionResult<Awaited<ReturnType<typeof listStories>>>> {
  return toActionResult(async () => {
    const session = await requireSession();
    return listStories(session, {
      kind: input.kind,
      saved: input.saved,
      cursor: input.cursor,
    });
  });
}

/** What a story can be turned into. Each maps to an existing generation type. */
export type HubAction =
  | "caption"
  | "thread"
  | "reel"
  | "meme"
  | "carousel"
  | "news";

const ACTION_TYPE: Record<HubAction, "caption" | "thread" | "script" | "thumbnail" | "idea" | "long-form"> = {
  caption: "caption",
  thread: "thread",
  reel: "script",
  meme: "thumbnail",
  carousel: "idea",
  news: "long-form",
};

const ACTION_BRIEF: Record<HubAction, string> = {
  caption: "Write a caption that sets this up for our audience. Do not quote the reply verbatim — the screenshot carries it.",
  thread: "Turn this into a thread that uses the exchange as its opening beat and then says something of our own.",
  reel: "Write a short video script built around this exchange. Mark the beats.",
  meme: "Describe meme treatments of this exchange — what is on screen, what the caption says, why it lands.",
  carousel: "Outline a carousel built from this exchange. One slide per line, first slide is the hook.",
  news: "Write this up as a short news item: what happened, who said what, why anyone cares. No invented detail.",
};

/**
 * Turn a story into a draft.
 *
 * The story's own text is the input, so the model is working from what actually
 * happened rather than a summary of it. Attribution is preserved in the draft's
 * context because reposting someone else's words as your own is the mistake
 * this feature makes easy.
 */
export async function generateFromStoryAction(input: {
  storyId: string;
  action: HubAction;
  platform?: Platform;
}): Promise<ActionResult<{ output: string; source: string; postId: string | null }>> {
  return toActionResult(async () => {
    const session = await requireSession();

    const story = await db.xStory.findFirst({
      where: { id: input.storyId, orgId: session.orgId },
      include: { posts: { include: { post: true }, orderBy: { position: "asc" } } },
    });
    if (!story) throw new Error("Story not found");

    const material = story.posts
      .map(
        (row) =>
          `${row.role === "ORIGINAL" ? "ORIGINAL" : "REPLY"} — ${row.post.authorHandle}: ${row.post.text}`
      )
      .join("\n\n");

    const generated = await generate(session, {
      studio: input.platform ?? Platform.X,
      type: ACTION_TYPE[input.action],
      input: material,
      context: [
        ACTION_BRIEF[input.action],
        "This is someone else's exchange. Credit the handles rather than presenting their words as ours, and never invent what anyone said.",
      ].join(" "),
    });

    // A draft is created for the formats that are one post. Multi-part outputs
    // — threads, scripts, meme concepts — are handed back for a person to shape
    // rather than dropped into the queue as one oversized post.
    const single = input.action === "caption";
    const post = single
      ? await createPost(session, {
          platform: input.platform ?? Platform.X,
          body: generated.output.slice(0, 280),
          status: PostStatus.DRAFT,
          platformData: {},
        })
      : null;

    revalidatePath("/hub");
    return {
      output: generated.output,
      source: generated.source,
      postId: post?.id ?? null,
    };
  });
}


/**
 * Build a News item or a Gist from posts already in the corpus.
 *
 * Selection is the user's — they choose which posts belong to a story — because
 * "these three posts are about the same thing" is a judgement a person makes
 * better and faster than a clustering pass, and getting it wrong produces a news
 * item that confidently merges two unrelated events.
 */
export async function buildStoryAction(input: {
  kind: "news" | "gist";
  postIds: string[];
}): Promise<ActionResult<{ id: string; title: string } | null>> {
  return toActionResult(async () => {
    const session = await requireSession();
    if (input.postIds.length === 0) {
      throw new Error("Pick at least one post to build from.");
    }
    const built =
      input.kind === "news"
        ? await buildNewsStory(session, input.postIds)
        : await buildGist(session, input.postIds);
    revalidatePath("/hub");
    return built;
  });
}

export async function buildTrendAction(input: {
  topic: string;
}): Promise<ActionResult<{ id: string; title: string } | null>> {
  return toActionResult(async () => {
    const session = await requireSession();
    const built = await buildTrendStory(session, input.topic);
    revalidatePath("/hub");
    return built;
  });
}

export async function deriveTrendsAction(): Promise<
  ActionResult<Awaited<ReturnType<typeof deriveTrends>>>
> {
  return toActionResult(async () => {
    const session = await requireSession();
    return deriveTrends(session);
  });
}


/**
 * Pull from the connected X account.
 *
 * Reads what the account sync, the engagement inbox and competitor tracking
 * have already stored, so it costs no new API calls — and only reaches out for
 * replies to your own top posts, where there is a real tweet id to ask about.
 */
export async function harvestAction(): Promise<
  ActionResult<Awaited<ReturnType<typeof harvest>>>
> {
  return toActionResult(async () => {
    const session = await requireSession();
    const result = await harvest(session);
    revalidatePath("/hub");
    revalidatePath("/studio/x");
    return result;
  });
}
