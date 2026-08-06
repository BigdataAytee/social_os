import type { Session } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { STOP_WORDS, extractTerms, words } from "./terms";

/**
 * Brand Brain — the voice this org *actually has*, measured (OS-ARCHITECTURE.md
 * §11 stage 4).
 *
 * `BrandVoice` is what someone typed into Settings: aspirational, stated once,
 * never revisited. `BrandProfile` is what they demonstrably write — vocabulary,
 * sentence length, emoji rate, which openings preceded posts that performed.
 * Both go into the prompt, and they answer different questions: the voice says
 * what to aim for, the profile says what this account sounds like.
 *
 * **Everything here is arithmetic, not inference.** No model call: counting
 * words is something Postgres and JavaScript do exactly, and an LLM does
 * approximately and expensively. The one place judgement is needed — turning the
 * numbers into a prompt — is `brandProfileBlock`, which is still just
 * formatting.
 *
 * The honesty rule: a profile derived from too few posts is worse than none,
 * because it hands the model confident instructions built from noise.
 * `MIN_POSTS` is the floor, `basedOnPosts` records the truth, and
 * `brandProfileBlock` returns nothing below the floor.
 */

/**
 * Below this the numbers are noise. Ten is not a statistical threshold, it is
 * the point where "you use short sentences" stops being an accident of the
 * three posts someone happened to write first.
 */
const MIN_POSTS = 10;

/** Ranked by frequency, so the top of the list is the strongest signal. */
export type BrandProfileShape = {
  vocabulary: { term: string; count: number }[];
  sentenceStats: {
    avgWords: number;
    avgSentences: number;
    questionRate: number;
    avgChars: number;
  };
  emojiRate: number;
  hookPatterns: string[];
  contentPillars: string[];
  winningFormats: { kind: string; lift: number }[];
  basedOnPosts: number;
};

const EMOJI = /\p{Extended_Pictographic}/gu;

/**
 * Recompute an org's profile from everything it has written.
 *
 * Published posts *and* synced external posts: the first is what they wrote in
 * SocialOS, the second is what they wrote before SocialOS existed. A new org
 * that connects an account with two years of history should get a real profile
 * on day one, not after it has published ten posts here.
 */
export async function rebuildBrandProfile(
  orgId: string
): Promise<BrandProfileShape> {
  const [posts, external] = await Promise.all([
    db.post.findMany({
      where: { orgId, status: { in: ["PUBLISHED", "SCHEDULED"] } },
      select: { body: true, platformData: true },
      take: 1000,
      orderBy: { createdAt: "desc" },
    }),
    db.externalPost.findMany({
      where: { orgId },
      select: {
        text: true,
        mediaType: true,
        likes: true,
        comments: true,
        shares: true,
        views: true,
      },
      take: 1000,
      orderBy: { publishedAt: "desc" },
    }),
  ]);

  type Sample = { text: string; kind: string | null; rate: number | null };

  const samples: Sample[] = [
    ...posts.map((post) => ({
      text: post.body,
      kind: (post.platformData as { kind?: string } | null)?.kind ?? null,
      // Own posts carry no engagement — SocialOS doesn't read back its own
      // published posts' metrics. They inform voice, not what won.
      rate: null,
    })),
    ...external.map((post) => {
      const interactions = post.likes + post.comments + post.shares;
      return {
        text: post.text,
        kind: post.mediaType,
        rate: post.views > 0 ? (interactions / post.views) * 100 : interactions,
      };
    }),
  ].filter((sample) => sample.text.trim().length > 0);

  const shape: BrandProfileShape = {
    vocabulary: vocabulary(samples.map((s) => s.text)),
    sentenceStats: sentenceStats(samples.map((s) => s.text)),
    emojiRate: emojiRate(samples.map((s) => s.text)),
    hookPatterns: hookPatterns(samples),
    contentPillars: contentPillars(samples.map((s) => s.text)),
    winningFormats: winningFormats(samples),
    basedOnPosts: samples.length,
  };

  await db.brandProfile.upsert({
    where: { orgId },
    update: {
      vocabulary: shape.vocabulary as never,
      sentenceStats: shape.sentenceStats as never,
      emojiRate: shape.emojiRate,
      hookPatterns: shape.hookPatterns as never,
      contentPillars: shape.contentPillars as never,
      winningFormats: shape.winningFormats as never,
      basedOnPosts: shape.basedOnPosts,
    },
    create: {
      orgId,
      vocabulary: shape.vocabulary as never,
      sentenceStats: shape.sentenceStats as never,
      emojiRate: shape.emojiRate,
      hookPatterns: shape.hookPatterns as never,
      contentPillars: shape.contentPillars as never,
      winningFormats: shape.winningFormats as never,
      basedOnPosts: shape.basedOnPosts,
    },
  });

  return shape;
}

export async function getBrandProfile(
  session: Session
): Promise<BrandProfileShape | null> {
  const row = await db.brandProfile.findUnique({
    where: { orgId: session.orgId },
  });
  if (!row) return null;

  return {
    vocabulary: (row.vocabulary as BrandProfileShape["vocabulary"]) ?? [],
    sentenceStats:
      (row.sentenceStats as BrandProfileShape["sentenceStats"]) ?? {
        avgWords: 0,
        avgSentences: 0,
        questionRate: 0,
        avgChars: 0,
      },
    emojiRate: row.emojiRate,
    hookPatterns: (row.hookPatterns as string[]) ?? [],
    contentPillars: (row.contentPillars as string[]) ?? [],
    winningFormats:
      (row.winningFormats as BrandProfileShape["winningFormats"]) ?? [],
    basedOnPosts: row.basedOnPosts,
  };
}

/**
 * Render the profile for the system prompt.
 *
 * Returns "" below `MIN_POSTS` — the caller then simply omits the section, and
 * the model behaves exactly as it did before stage 4. That is the whole safety
 * property: a thin profile changes nothing rather than changing something
 * badly.
 */
export function brandProfileBlock(profile: BrandProfileShape | null): string {
  if (!profile || profile.basedOnPosts < MIN_POSTS) return "";

  const lines: string[] = [
    `Measured from ${profile.basedOnPosts} of this account's own posts. This is how they actually write — match it.`,
  ];

  const stats = profile.sentenceStats;
  if (stats.avgWords > 0) {
    lines.push(
      `Typical post: ${Math.round(stats.avgChars)} characters, ${Math.round(
        stats.avgSentences
      )} sentences, about ${Math.round(stats.avgWords)} words per sentence.`
    );
  }
  if (stats.questionRate >= 0.2) {
    lines.push(
      `${Math.round(stats.questionRate * 100)}% of their posts ask a question — that is part of the voice, not an accident.`
    );
  }

  lines.push(
    profile.emojiRate < 0.2
      ? "They almost never use emoji. Don't add any."
      : `They average ${profile.emojiRate.toFixed(1)} emoji per post.`
  );

  if (profile.vocabulary.length > 0) {
    lines.push(
      `Words they reach for: ${profile.vocabulary
        .slice(0, 12)
        .map((v) => v.term)
        .join(", ")}.`
    );
  }
  if (profile.contentPillars.length > 0) {
    lines.push(`Subjects they return to: ${profile.contentPillars.join(", ")}.`);
  }
  if (profile.hookPatterns.length > 0) {
    lines.push(
      `Openings that worked for them before:\n${profile.hookPatterns
        .slice(0, 5)
        .map((hook) => `  - "${hook}"`)
        .join("\n")}`
    );
  }
  if (profile.winningFormats.length > 0) {
    lines.push(
      `Formats that outperform their own average: ${profile.winningFormats
        .map((f) => `${f.kind} (+${Math.round(f.lift)}%)`)
        .join(", ")}.`
    );
  }

  return lines.join("\n");
}

// ------------------------------------------------------------- the arithmetic

/**
 * Terms this org uses often, excluding filler.
 *
 * Raw frequency rather than TF-IDF: there is no corpus to compute an IDF
 * against — one org's posts are the entire universe here. A stop list plus a
 * document-frequency floor gets most of the way, and pretending otherwise would
 * be dressing a word count in statistics it doesn't have.
 */
function vocabulary(texts: string[]): { term: string; count: number }[] {
  const counts = new Map<string, number>();
  const documents = new Map<string, number>();

  for (const text of texts) {
    const seen = new Set<string>();
    for (const word of words(text)) {
      if (word.length < 4 || STOP_WORDS.has(word)) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
      seen.add(word);
    }
    for (const word of seen) {
      documents.set(word, (documents.get(word) ?? 0) + 1);
    }
  }

  // Used in at least two posts. A word that appears eleven times in one post is
  // that post's subject, not this account's vocabulary.
  return [...counts.entries()]
    .filter(([term]) => (documents.get(term) ?? 0) >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([term, count]) => ({ term, count }));
}

function sentenceStats(texts: string[]): BrandProfileShape["sentenceStats"] {
  if (texts.length === 0) {
    return { avgWords: 0, avgSentences: 0, questionRate: 0, avgChars: 0 };
  }

  let sentences = 0;
  let wordCount = 0;
  let questions = 0;
  let chars = 0;

  for (const text of texts) {
    const parts = text
      .split(/[.!?]+(?:\s|$)/)
      .map((part) => part.trim())
      .filter(Boolean);
    sentences += Math.max(parts.length, 1);
    wordCount += words(text).length;
    chars += text.length;
    if (text.includes("?")) questions += 1;
  }

  return {
    avgWords: sentences > 0 ? wordCount / sentences : 0,
    avgSentences: sentences / texts.length,
    questionRate: questions / texts.length,
    avgChars: chars / texts.length,
  };
}

function emojiRate(texts: string[]): number {
  if (texts.length === 0) return 0;
  const total = texts.reduce(
    (sum, text) => sum + (text.match(EMOJI)?.length ?? 0),
    0
  );
  return total / texts.length;
}

/**
 * The first line of posts that beat the median.
 *
 * Median, not mean: social engagement is long-tailed, and one viral post drags
 * a mean above everything else, leaving "above average" meaning "was the viral
 * one". Posts with no engagement data are excluded rather than assumed
 * average — this list only claims to contain openings that *worked*.
 */
function hookPatterns(
  samples: { text: string; rate: number | null }[]
): string[] {
  const scored = samples.filter(
    (s): s is { text: string; rate: number } => s.rate !== null
  );
  if (scored.length < 6) return [];

  const sorted = [...scored].sort((a, b) => a.rate - b.rate);
  const median = sorted[Math.floor(sorted.length / 2)]!.rate;

  return scored
    .filter((s) => s.rate > median)
    .sort((a, b) => b.rate - a.rate)
    .map((s) => firstLine(s.text))
    .filter((line) => line.length >= 15)
    .slice(0, 8);
}

function firstLine(text: string): string {
  const line = text.split("\n").find((l) => l.trim().length > 0) ?? "";
  const trimmed = line.trim();
  return trimmed.length > 120 ? `${trimmed.slice(0, 119)}…` : trimmed;
}

/**
 * Recurring subjects.
 *
 * Delegated to `terms.ts` because competitor gap analysis asks the same
 * question of a rival's corpus, and a gap is only meaningful if both sides were
 * measured identically.
 */
function contentPillars(texts: string[]): string[] {
  return extractTerms(texts).map((term) => term.term);
}

/**
 * Which formats beat this org's own average, as a percentage lift.
 *
 * Against their *own* average, not a global benchmark: the useful statement is
 * "carousels do 40% better than your usual", not "carousels do well". Three
 * samples minimum per format — below that a single good post makes a format
 * look like a strategy.
 */
function winningFormats(
  samples: { kind: string | null; rate: number | null }[]
): { kind: string; lift: number }[] {
  const scored = samples.filter(
    (s): s is { kind: string; rate: number } =>
      s.kind !== null && s.rate !== null
  );
  if (scored.length < 6) return [];

  const overall =
    scored.reduce((sum, s) => sum + s.rate, 0) / scored.length;
  if (overall <= 0) return [];

  const byKind = new Map<string, number[]>();
  for (const sample of scored) {
    byKind.set(sample.kind, [...(byKind.get(sample.kind) ?? []), sample.rate]);
  }

  return [...byKind.entries()]
    .filter(([, rates]) => rates.length >= 3)
    .map(([kind, rates]) => ({
      kind,
      lift:
        ((rates.reduce((sum, rate) => sum + rate, 0) / rates.length) / overall -
          1) *
        100,
    }))
    .filter((entry) => entry.lift > 10)
    .sort((a, b) => b.lift - a.lift)
    .slice(0, 4);
}
