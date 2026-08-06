import type { Session } from "@/lib/auth/session";
import type { XPostData } from "./source";

/**
 * Scoring replies (X-HUB.md §3).
 *
 * Four signals, each 0–100. Two are arithmetic and two are judgement, and the
 * split is deliberate rather than a compromise:
 *
 *   - **engagement** and **virality** come from the counts X reports. Exact,
 *     free, instant. Virality is the reply measured against the post it
 *     answers, which is the whole premise of the format: a reply that outdoes
 *     its own original is the thing worth surfacing.
 *   - **humour** and **roast** are a model call, batched. There is no lexicon
 *     that scores wit honestly — a rules-based "funny score" is a word count in
 *     a costume, and it would be confidently wrong about exactly the replies
 *     that matter.
 *
 * When no model is configured the two judgement scores are `null`, the ranking
 * runs on arithmetic alone, and `basis` says so. A hub that silently ranks by
 * likes while claiming to rank by humour is the failure this design exists to
 * prevent.
 */

export type ReplyScore = {
  humour: number | null;
  roast: number | null;
  virality: number;
  engagement: number;
  /** 0–100. What the hub sorts by. */
  total: number;
  /** What the total was actually computed from. Shown in the UI. */
  basis: "full" | "engagement-only";
};

/**
 * Log-scaled, because engagement is long-tailed.
 *
 * Linear scaling makes one viral reply score 100 and everything else score 2,
 * which is not a ranking — it is a single winner and a flat field. A log curve
 * keeps the middle of the distribution distinguishable, which is where almost
 * every reply lives.
 */
function engagementScore(post: XPostData): number {
  const interactions = post.likes + post.reposts + post.replies;
  if (interactions <= 0) return 0;
  // 10 interactions ≈ 33, 1k ≈ 67, 100k ≈ 100.
  return Math.min(100, Math.round((Math.log10(interactions + 1) / 5) * 100));
}

/**
 * The reply against the post it answers.
 *
 * Capped at 3× rather than unbounded: a reply with ten times its original's
 * likes is remarkable, and one with a hundred times is usually a reply to a
 * tiny account, which is not the same thing and should not outrank it.
 */
function viralityScore(reply: XPostData, original: XPostData | null): number {
  const replyScore = reply.likes + reply.reposts;
  if (replyScore <= 0) return 0;

  const originalScore = original ? original.likes + original.reposts : 0;
  if (originalScore <= 0) {
    // Nothing to compare against — fall back to the reply's own reach rather
    // than crediting it with an infinite ratio.
    return Math.round(engagementScore(reply) * 0.6);
  }

  const ratio = Math.min(3, replyScore / originalScore);
  return Math.round((ratio / 3) * 100);
}

export type ScoredReply = {
  post: XPostData;
  score: ReplyScore;
};

/**
 * Score a batch of replies to one original.
 *
 * Batched on purpose: one model call for up to twenty replies, not twenty
 * calls. At a call each, a hub refresh over thirty conversations would be six
 * hundred requests and a bill nobody signed up for.
 */
export async function scoreReplies(
  session: Session,
  input: { original: XPostData | null; replies: XPostData[] }
): Promise<ScoredReply[]> {
  const arithmetic = input.replies.map((post) => ({
    post,
    engagement: engagementScore(post),
    virality: viralityScore(post, input.original),
  }));

  const judged = await judge(session, input.original, input.replies).catch(
    // Never fail a hub refresh over the model. Arithmetic still ranks.
    () => null
  );

  return arithmetic.map((row) => {
    const wit = judged?.get(row.post.externalId) ?? null;

    if (!wit) {
      return {
        post: row.post,
        score: {
          humour: null,
          roast: null,
          virality: row.virality,
          engagement: row.engagement,
          // Weighted toward virality: without judgement, "outdid its original"
          // is the best available proxy for "worth reading".
          total: Math.round(row.virality * 0.6 + row.engagement * 0.4),
          basis: "engagement-only" as const,
        },
      };
    }

    return {
      post: row.post,
      score: {
        humour: wit.humour,
        roast: wit.roast,
        virality: row.virality,
        engagement: row.engagement,
        // Humour leads. The format is "the reply that was funnier than the
        // post", and engagement is evidence for that rather than the point.
        total: Math.round(
          wit.humour * 0.4 +
            wit.roast * 0.2 +
            row.virality * 0.25 +
            row.engagement * 0.15
        ),
        basis: "full" as const,
      },
    };
  });
}

type Wit = { humour: number; roast: number };

/**
 * One call, all the replies.
 *
 * The prompt asks for JSON and the parser tolerates the model wrapping it in
 * prose or a fence, because it sometimes will and a failed parse would silently
 * demote every reply to engagement-only ranking — the exact degradation this
 * function exists to avoid.
 */
async function judge(
  session: Session,
  original: XPostData | null,
  replies: XPostData[]
): Promise<Map<string, Wit> | null> {
  if (replies.length === 0) return null;

  const { isModelConfigured } = await import("@/modules/ai/orchestrator");
  if (!isModelConfigured()) return null;

  const batch = replies.slice(0, 20);
  const { complete } = await import("@/modules/ai/provider");

  const result = await complete({
    system: `You rate replies on X for a social media team that reposts the best ones.

Score each reply 0-100 on two axes:
- humour: is it actually funny? Wit, timing, absurdity, a good turn of phrase. Not "is it trying to be funny".
- roast: how hard does it go at the original? 0 is warm or neutral, 100 is a demolition.

Judge the reply against the post it answers. A reply that only makes sense as a response should be scored as one.

Be a hard marker. Most replies are not funny. If everything scores 70 the ranking is useless — reserve the top of the range for replies you would actually repost.

Respond with a JSON array and nothing else: [{"id":"<id>","humour":<0-100>,"roast":<0-100>}]`,
    messages: [
      {
        role: "user",
        content: [
          original
            ? `ORIGINAL POST by ${original.authorHandle}:\n${original.text}`
            : "ORIGINAL POST: not available.",
          "",
          "REPLIES:",
          ...batch.map(
            (reply) =>
              `id=${reply.externalId} by ${reply.authorHandle}: ${reply.text.replace(/\s+/g, " ").slice(0, 400)}`
          ),
        ].join("\n"),
      },
    ],
  });

  return parseWit(result.text);
}

export function parseWit(text: string): Map<string, Wit> | null {
  // Models add fences and preambles even when told not to. Pull the array out
  // rather than failing on the wrapper.
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return null;

  let rows: unknown;
  try {
    rows = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!Array.isArray(rows)) return null;

  const out = new Map<string, Wit>();
  for (const row of rows) {
    const entry = row as { id?: unknown; humour?: unknown; roast?: unknown };
    if (typeof entry.id !== "string") continue;
    const humour = clamp(entry.humour);
    const roast = clamp(entry.roast);
    if (humour === null || roast === null) continue;
    out.set(entry.id, { humour, roast });
  }
  return out.size > 0 ? out : null;
}

function clamp(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Story-level score: the best reply carries the story onto the hub. */
export function storyScoreFrom(replies: ScoredReply[]): number {
  return replies.length === 0
    ? 0
    : Math.max(...replies.map((reply) => reply.score.total));
}
