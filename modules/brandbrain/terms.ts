/**
 * "What is this corpus about?" — asked once, in one place.
 *
 * Both the brand profile (what *we* write about) and competitor gap analysis
 * (what *they* write about that we don't) need this, and the gap analysis is
 * only meaningful if both sides were measured the same way. Two subtly
 * different extractors would let the same page report a subject as one of our
 * pillars and as a gap.
 */

/**
 * Words that carry no topical signal. Deliberately short: an aggressive stop
 * list would strip the domain terms that *are* the signal. "Growth", "audience"
 * and "funnel" say what an account is about; "the" and "and" do not.
 */
export const STOP_WORDS = new Set(
  ("a an and are as at be been but by can do does for from had has have he her " +
    "here his how i if in into is it its just like me more most my no not of " +
    "on one or our out over she so some than that the their them then there " +
    "these they this to too up us was we were what when where which who why " +
    "will with would you your yours dont doesnt im ive youre thats its").split(" ")
);

/** Lowercased words, with URLs and punctuation stripped. */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}'\s-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export type Term = {
  term: string;
  /** How many documents contain it — the ranking signal. */
  documents: number;
};

/**
 * The subjects a corpus keeps returning to.
 *
 * Bigrams as well as single words, because "content strategy" is a subject and
 * "content" plus "strategy" separately are not. Ranked by *document* frequency
 * rather than raw count: a word appearing eleven times in one post is that
 * post's topic, not the corpus's.
 */
export function extractTerms(
  texts: string[],
  opts: { limit?: number; minDocumentRatio?: number } = {}
): Term[] {
  if (texts.length < 4) return [];

  const documents = new Map<string, number>();
  for (const text of texts) {
    const tokens = words(text).filter(
      (word) => word.length >= 4 && !STOP_WORDS.has(word)
    );
    const seen = new Set<string>();
    for (let i = 0; i < tokens.length; i++) {
      seen.add(tokens[i]!);
      if (i + 1 < tokens.length) seen.add(`${tokens[i]} ${tokens[i + 1]}`);
    }
    for (const term of seen) {
      documents.set(term, (documents.get(term) ?? 0) + 1);
    }
  }

  const floor = Math.max(
    2,
    Math.ceil(texts.length * (opts.minDocumentRatio ?? 0.05))
  );
  const ranked = [...documents.entries()]
    .filter(([, count]) => count >= floor)
    // A bigram beats its own parts at equal frequency: it says more.
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);

  const kept: Term[] = [];
  for (const [term, count] of ranked) {
    // Skip anything already covered by a term we kept — otherwise the list is
    // "content", "content strategy", "strategy", three times over.
    if (
      kept.some(
        (existing) =>
          existing.term.includes(term) || term.includes(existing.term)
      )
    ) {
      continue;
    }
    kept.push({ term, documents: count });
    if (kept.length === (opts.limit ?? 6)) break;
  }
  return kept;
}
