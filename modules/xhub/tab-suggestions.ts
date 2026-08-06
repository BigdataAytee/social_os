import { Platform, XStoryKind } from "@prisma/client";

import { assertCan } from "@/lib/auth/permissions";
import type { Session } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getBrandProfile } from "@/modules/brandbrain/service";
import { deriveTrends } from "./stories";

/**
 * Three things to post, on every tab, without being asked (X-HUB.md).
 *
 * The complaint that produced this: "not me only adding post". The hub held
 * material and waited. Now each tab arrives with proposals.
 *
 * **Grounding is graded, and the grade is shown.** A suggestion built from your
 * own corpus cites it. One built from your brand profile says so. One built
 * from neither is a cold start and admits it. That ladder matters more than it
 * looks: an app that presents a generic idea with the same confidence as one
 * drawn from your own numbers teaches people to distrust both.
 *
 * Suggestions are **stored, not regenerated per view**. A model call on every
 * page load would cost real money for content that doesn't change minute to
 * minute, and would make the same tab say different things on a refresh.
 */

const MIN_PER_TAB = 3;
/** Regenerate a tab when its newest suggestion is older than this. */
const STALE_HOURS = 12;

export type TabSuggestion = {
  id: string;
  tab: XStoryKind;
  title: string;
  body: string;
  why: string;
  cta: string;
  payload: Record<string, unknown>;
};

const TAB_BRIEF: Record<string, { cta: string; brief: string }> = {
  SAVAGE: {
    cta: "Use this meme",
    brief:
      "Meme and reply concepts. Each one: a scenario worth memeing and the exact line that goes on it. Concrete enough to hand to a designer.",
  },
  GIST: {
    cta: "Use this gist",
    brief:
      "Thread ideas told story-style. Each one: the hook line, then the shape of the thread in one sentence.",
  },
  NEWS: {
    cta: "Use this angle",
    brief:
      "News angles this brand could credibly publish — the kind of thing an aggregator account posts. Each one: the headline and what the story would actually say.",
  },
  TREND: {
    cta: "Use trend",
    brief:
      "Trend plays. Each one: the topic, the caption to post with it, and the hashtags. Say the caption in full so it can be posted as-is.",
  },
  VIDEO: {
    cta: "Use this idea",
    brief:
      "Short video ideas. Each one: the hook in the first three seconds, then the beats.",
  },
  CREATOR: {
    cta: "Use this",
    brief:
      "Creators or accounts worth engaging, and how. Each one: who, and the specific opening move.",
  },
};

/**
 * Read the tab's suggestions, generating a fresh batch when the last one is
 * stale, used up, or was never made.
 *
 * Called from page render, so it must be cheap in the common case — and it is:
 * a single indexed read unless the batch has aged out.
 */
export async function tabSuggestions(
  session: Session,
  tab: XStoryKind
): Promise<TabSuggestion[]> {
  const existing = await read(session.orgId, tab);

  const newest = existing[0]?.createdAt;
  const stale =
    !newest || Date.now() - newest.getTime() > STALE_HOURS * 3_600_000;

  if (existing.length >= MIN_PER_TAB && !stale) {
    return existing.slice(0, MIN_PER_TAB).map(view);
  }

  const generated = await generateForTab(session, tab).catch(() => []);
  if (generated.length === 0) {
    // Generation failed or no model. Whatever is stored still beats nothing,
    // and an empty tab that used to have suggestions reads as a regression.
    return existing.map(view);
  }

  // Re-read rather than returning what was just created. The three rows are
  // written concurrently, so their timestamps can tie and the creation order is
  // not the stored order — returning one and then the other on the next render
  // made the same tab reshuffle for no reason.
  return (await read(session.orgId, tab)).slice(0, MIN_PER_TAB).map(view);
}

/** One ordering, used by both paths. `id` breaks ties that `createdAt` can't. */
async function read(orgId: string, tab: XStoryKind) {
  return db.xSuggestion.findMany({
    where: { orgId, tab, usedAt: null, dismissed: false },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 6,
  });
}

function view(row: {
  id: string;
  tab: XStoryKind;
  title: string;
  body: string;
  why: string;
  cta: string;
  payload: unknown;
}): TabSuggestion {
  return {
    id: row.id,
    tab: row.tab,
    title: row.title,
    body: row.body,
    why: row.why,
    cta: row.cta,
    payload: (row.payload as Record<string, unknown>) ?? {},
  };
}

/**
 * Build a fresh batch.
 *
 * One model call per tab, not one per suggestion. The grounding block is
 * assembled from real rows first, and what it contains decides what `why` can
 * honestly claim.
 */
export async function generateForTab(
  session: Session,
  tab: XStoryKind
): Promise<TabSuggestion[]> {
  assertCan(session.role, "ai.generate");

  const [trends, profile, ourPosts, hubPosts, account] = await Promise.all([
    deriveTrends(session, 6),
    getBrandProfile(session),
    db.externalPost.findMany({
      where: { orgId: session.orgId, account: { platform: Platform.X } },
      orderBy: { publishedAt: "desc" },
      take: 20,
      select: { text: true, likes: true, shares: true },
    }),
    db.xPost.findMany({
      where: { orgId: session.orgId },
      orderBy: { likes: "desc" },
      take: 15,
      select: { authorHandle: true, text: true, likes: true },
    }),
    db.connectedAccount.findFirst({
      where: { orgId: session.orgId, platform: Platform.X },
      select: { region: true, language: true },
    }),
  ]);

  // The ladder. Each rung is a real source, and `basis` records which one this
  // batch actually stood on so the UI can say it.
  const grounding: string[] = [];
  let basis: "corpus" | "profile" | "cold" = "cold";

  if (hubPosts.length >= 3 || trends.length > 0) {
    basis = "corpus";
    if (trends.length > 0) {
      grounding.push(
        `Recurring in what this account collected: ${trends
          .map((t) => `${t.topic} (${t.posts} posts, ${t.reach} interactions)`)
          .join("; ")}.`
      );
    }
    if (hubPosts.length > 0) {
      grounding.push(
        `Posts they saved as worth reacting to:\n${hubPosts
          .slice(0, 8)
          .map((p) => `- ${p.authorHandle}: ${p.text.replace(/\s+/g, " ").slice(0, 160)}`)
          .join("\n")}`
      );
    }
  }

  if (profile && profile.basedOnPosts >= 10) {
    if (basis === "cold") basis = "profile";
    grounding.push(
      `How this account writes, measured over ${profile.basedOnPosts} posts: subjects ${profile.contentPillars.join(", ") || "unclear"}; words they reach for ${profile.vocabulary.slice(0, 10).map((v) => v.term).join(", ")}; ${profile.emojiRate < 0.2 ? "almost never uses emoji" : `${profile.emojiRate.toFixed(1)} emoji per post`}.`
    );
  }

  if (ourPosts.length > 0) {
    grounding.push(
      `Their own recent posts:\n${ourPosts
        .slice(0, 6)
        .map((p) => `- ${p.text.replace(/\s+/g, " ").slice(0, 140)}`)
        .join("\n")}`
    );
  }

  const brief = TAB_BRIEF[tab] ?? TAB_BRIEF.SAVAGE!;

  const { generate } = await import("@/modules/ai/orchestrator");
  const result = await generate(session, {
    studio: Platform.X,
    type: "idea",
    input:
      grounding.length > 0
        ? grounding.join("\n\n")
        : "No collected posts and no measured profile yet — this is a cold start.",
    context: [
      brief.brief,
      `Give exactly ${MIN_PER_TAB} suggestions.`,
      // The format is parsed, so it is stated flatly and repeated in the
      // parser's tolerance rather than trusted.
      "Format each as one line: TITLE :: BODY. No numbering, no preamble, no blank lines between them.",
      account?.region ? `Audience is in ${account.region}.` : "",
      grounding.length === 0
        ? "There is nothing to ground these in, so keep them broadly useful rather than pretending to know this account."
        : "Ground each one in the material above. Refer to the actual topics and posts, not to social media in general.",
    ]
      .filter(Boolean)
      .join(" "),
  });

  const parsed = parseSuggestions(result.output);
  if (parsed.length === 0) return [];

  const why = whyFor(basis, trends.length, profile?.basedOnPosts ?? 0);

  // Replaced rather than accumulated: a tab showing eleven suggestions from
  // three generations is a backlog, not a proposal.
  await db.xSuggestion.deleteMany({
    where: { orgId: session.orgId, tab, usedAt: null },
  });

  const rows = await Promise.all(
    parsed.slice(0, MIN_PER_TAB).map((suggestion) =>
      db.xSuggestion.create({
        data: {
          orgId: session.orgId,
          tab,
          title: suggestion.title,
          body: suggestion.body,
          why,
          cta: brief.cta,
          payload: {
            basis,
            topics: trends.slice(0, 3).map((t) => t.topic),
            language: account?.language ?? null,
          } as never,
        },
      })
    )
  );

  return rows.map(view);
}

/**
 * "TITLE :: BODY" per line, tolerantly.
 *
 * Models add numbering and bullets whatever the instruction says, and a line
 * without the separator is still a usable suggestion — it just becomes its own
 * title. Dropping it would silently return two suggestions where three were
 * asked for.
 */
export function parseSuggestions(
  text: string
): { title: string; body: string }[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((line) => line.length > 8)
    .map((line) => {
      const [title, ...rest] = line.split(/\s*::\s*/);
      const body = rest.join(" :: ").trim();
      return {
        title: (title ?? line).slice(0, 140),
        body: body || (title ?? line),
      };
    })
    .filter((entry) => entry.title.length > 0);
}

function whyFor(
  basis: "corpus" | "profile" | "cold",
  trendCount: number,
  profilePosts: number
): string {
  if (basis === "corpus") {
    return trendCount > 0
      ? `From ${trendCount} recurring subjects in the posts you've collected.`
      : "From the posts you've collected.";
  }
  if (basis === "profile") {
    return `From your measured voice, over ${profilePosts} of your own posts. Collect a few X posts and these get sharper.`;
  }
  return "Cold start — nothing collected and no measured voice yet. Sync X or paste a few links and these become specific to you.";
}

/** Mark one as used, so the next batch doesn't repeat it. */
export async function applySuggestion(session: Session, id: string) {
  const row = await db.xSuggestion.findFirst({
    where: { id, orgId: session.orgId },
    select: { id: true },
  });
  if (!row) throw new Error("Suggestion not found");
  return db.xSuggestion.update({
    where: { id: row.id },
    data: { usedAt: new Date() },
  });
}

export async function dismissSuggestion(session: Session, id: string) {
  const row = await db.xSuggestion.findFirst({
    where: { id, orgId: session.orgId },
    select: { id: true },
  });
  if (!row) throw new Error("Suggestion not found");
  return db.xSuggestion.update({
    where: { id: row.id },
    data: { dismissed: true },
  });
}

/** Refresh every tab. Runs from the job queue after a harvest. */
export async function refreshAllTabs(
  session: Session
): Promise<{ tabs: number; suggestions: number }> {
  const tabs: XStoryKind[] = [
    XStoryKind.SAVAGE,
    XStoryKind.GIST,
    XStoryKind.NEWS,
    XStoryKind.TREND,
    XStoryKind.VIDEO,
  ];

  let suggestions = 0;
  for (const tab of tabs) {
    const made = await generateForTab(session, tab).catch(() => []);
    suggestions += made.length;
  }
  return { tabs: tabs.length, suggestions };
}
