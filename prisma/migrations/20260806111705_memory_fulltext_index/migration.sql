-- Full-text index for modules/memory/service.ts `recall()`.
--
-- Prisma can't express this: `@@fulltext` is MySQL-only and there is no
-- attribute for a GIN index over a functional expression. Without it every
-- recall is a sequential scan that recomputes to_tsvector per row — fine at a
-- hundred chunks, not at ten thousand.
--
-- The expression must match `recall()`'s WHERE clause exactly, including the
-- 'english' configuration, or the planner won't use the index.
CREATE INDEX IF NOT EXISTS "memory_chunks_text_fts_idx"
  ON "memory_chunks" USING GIN (to_tsvector('english', "text"));
