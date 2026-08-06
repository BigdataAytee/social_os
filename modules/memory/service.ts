import { Prisma } from "@prisma/client";

import type { Session } from "@/lib/auth/session";
import { db } from "@/lib/db";

/**
 * Growth Memory — the org's own history, made retrievable
 * (OS-ARCHITECTURE.md §11 stage 4).
 *
 * **Lexical, not vector, and that is a decision rather than a shortcut.**
 * Embeddings would need an embeddings provider this stack doesn't have —
 * Anthropic's API doesn't offer one — and a `vector` column nothing can populate
 * is worse than honest full-text search, because it looks like a working
 * feature. Postgres full-text over one org's few thousand posts is genuinely
 * good at "find my best educational posts". The upgrade path is one added
 * column and a backfill job, and `recall()` is the seam that makes it invisible.
 *
 * Ranking blends relevance with *outcome*: a post that matched the query and
 * actually performed outranks one that merely matched. "Show me what worked"
 * is the question people are really asking.
 */

export type MemorySource =
  | "post"
  | "external-post"
  | "generation"
  | "idea"
  | "briefing";

export type Recollection = {
  sourceType: string;
  sourceId: string;
  text: string;
  score: number | null;
  metadata: Record<string, unknown>;
  /** Full-text rank, for debugging why something surfaced. */
  relevance: number;
};

/** Upsert one chunk. Idempotent on (org, sourceType, sourceId). */
export async function remember(input: {
  orgId: string;
  sourceType: MemorySource;
  sourceId: string;
  text: string;
  score?: number | null;
  metadata?: Record<string, unknown>;
}) {
  const text = input.text.trim();
  if (!text) return null;

  const data = {
    text: text.slice(0, 8000),
    score: input.score ?? null,
    metadata: (input.metadata ?? {}) as never,
  };

  return db.memoryChunk.upsert({
    where: {
      orgId_sourceType_sourceId: {
        orgId: input.orgId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      },
    },
    update: data,
    create: {
      orgId: input.orgId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      ...data,
    },
  });
}

export async function forget(orgId: string, sourceType: MemorySource, sourceId: string) {
  return db.memoryChunk.deleteMany({ where: { orgId, sourceType, sourceId } });
}

/**
 * Search the org's own corpus.
 *
 * Raw SQL because Prisma has no Postgres full-text support — `@@fulltext` is
 * MySQL only.
 *
 * **The query is OR, not AND, and that took a failing test to notice.**
 * `plainto_tsquery` joins every term with `&`, so "what did we say about
 * pricing?" only matches a document containing *both* "say" and "pricing" —
 * which is to say, nothing. Natural-language questions are exactly what this is
 * for, and an AND query answers almost all of them with silence.
 *
 * Swapping `&` for `|` in the parsed query's text keeps `plainto_tsquery` doing
 * the part that must not be hand-rolled — normalisation, stemming, stop-word
 * removal, and escaping — while changing only the operator. `ts_rank` then does
 * the work AND was doing badly: a document matching three terms outranks one
 * matching a single term, instead of being the only thing allowed to match.
 *
 * **orgId is always bound as a parameter**, never interpolated. This is the one
 * place in the codebase writing raw SQL against a tenant-scoped table, and it is
 * exactly where a template literal would become a cross-tenant read.
 */
export async function recall(
  session: Session,
  query: string,
  opts: { sourceTypes?: MemorySource[]; take?: number } = {}
): Promise<Recollection[]> {
  const text = query.trim();
  if (!text) return [];

  const take = Math.min(opts.take ?? 8, 50);
  const types = opts.sourceTypes ?? [];

  // Composed with Prisma.sql so the optional filter is a *fragment*, not a
  // nested query. Every value stays a bound parameter — orgId above all, since
  // this is the one raw query in the codebase against a tenant-scoped table and
  // interpolating it would turn a search into a cross-tenant read.
  const typeFilter =
    types.length > 0
      ? Prisma.sql`AND "sourceType" = ANY(${types}::text[])`
      : Prisma.empty;

  // Cast to text, swap the operator, cast back. NULLIF guards the one input
  // plainto_tsquery renders empty — a string of nothing but stop words — which
  // would otherwise cast to an empty tsquery that matches nothing anyway, but
  // reads as a bug the first time someone hits it.
  const tsquery = Prisma.sql`
    to_tsquery(
      'english',
      NULLIF(replace(plainto_tsquery('english', ${text})::text, '&', '|'), '')
    )`;

  const rows = await db.$queryRaw<
    {
      sourceType: string;
      sourceId: string;
      text: string;
      score: number | null;
      metadata: Record<string, unknown>;
      relevance: number;
    }[]
  >(Prisma.sql`
    SELECT
      "sourceType", "sourceId", "text", "score", "metadata",
      ts_rank(to_tsvector('english', "text"), ${tsquery}) AS relevance
    FROM memory_chunks
    WHERE "orgId" = ${session.orgId}
      AND to_tsvector('english', "text") @@ ${tsquery}
      ${typeFilter}
    ORDER BY
      -- Relevance first, but a matching post that actually performed outranks
      -- one that merely matched. COALESCE keeps unscored sources in the running
      -- rather than sorting them to the bottom for lacking a metric.
      (ts_rank(to_tsvector('english', "text"), ${tsquery})
        * (1 + COALESCE("score", 0) / 100)) DESC
    LIMIT ${take}
  `);

  return rows.map((row) => ({ ...row, relevance: Number(row.relevance) }));
}

/**
 * Rebuild the whole corpus for an org.
 *
 * Cheap enough to run wholesale rather than incrementally: an org's entire
 * history is thousands of rows, and an incremental index that drifts out of
 * sync is a subtler problem than one that takes a few seconds.
 */
export async function reindexOrg(orgId: string): Promise<{ chunks: number }> {
  const [posts, external, generations, ideas] = await Promise.all([
    db.post.findMany({
      where: { orgId },
      select: { id: true, body: true, platform: true, status: true, platformData: true },
      take: 2000,
    }),
    db.externalPost.findMany({
      where: { orgId },
      select: {
        id: true,
        text: true,
        mediaType: true,
        likes: true,
        comments: true,
        shares: true,
        views: true,
        permalink: true,
      },
      take: 2000,
    }),
    db.aIGeneration.findMany({
      where: { orgId },
      select: { id: true, output: true, type: true, studio: true },
      take: 1000,
    }),
    db.idea.findMany({
      where: { orgId },
      select: { id: true, content: true, platform: true, source: true },
      take: 1000,
    }),
  ]);

  let chunks = 0;

  for (const post of posts) {
    await remember({
      orgId,
      sourceType: "post",
      sourceId: post.id,
      text: post.body,
      metadata: {
        platform: post.platform,
        status: post.status,
        kind: (post.platformData as { kind?: string } | null)?.kind ?? null,
      },
    });
    chunks += 1;
  }

  for (const post of external) {
    const interactions = post.likes + post.comments + post.shares;
    // The score is what makes "find what worked" different from "find what
    // mentions this" — engagement rate, on the same scale insights uses.
    const rate =
      post.views > 0 ? (interactions / post.views) * 100 : interactions;
    await remember({
      orgId,
      sourceType: "external-post",
      sourceId: post.id,
      text: post.text,
      score: rate,
      metadata: {
        mediaType: post.mediaType,
        likes: post.likes,
        comments: post.comments,
        permalink: post.permalink,
      },
    });
    chunks += 1;
  }

  for (const generation of generations) {
    await remember({
      orgId,
      sourceType: "generation",
      sourceId: generation.id,
      text: generation.output,
      metadata: { type: generation.type, studio: generation.studio },
    });
    chunks += 1;
  }

  for (const idea of ideas) {
    await remember({
      orgId,
      sourceType: "idea",
      sourceId: idea.id,
      text: idea.content,
      metadata: { platform: idea.platform, source: idea.source },
    });
    chunks += 1;
  }

  return { chunks };
}

export async function memoryStats(orgId: string) {
  const rows = await db.memoryChunk.groupBy({
    by: ["sourceType"],
    where: { orgId },
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((row) => [row.sourceType, row._count._all]));
}
