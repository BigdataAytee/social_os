import { ConversationStatus, Platform } from "@prisma/client";

import type { Session } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getBrandProfile } from "@/modules/brandbrain/service";
import { extractTerms } from "@/modules/brandbrain/terms";
import { priorityBand } from "@/modules/inbox/triage";
import { deriveTrends } from "./stories";

/**
 * What to do next, without being asked (X-HUB.md).
 *
 * The hub as first built was reactive: it held things and waited for someone to
 * press a button. This is the half that goes the other way — it reads what has
 * already been collected and says, unprompted, "here is the thing worth doing".
 *
 * **Every suggestion is derived from rows, and every one carries its evidence.**
 * No suggestion is a model's opinion about what would be nice to post; each is a
 * fact about the data plus a rule about what that fact implies. `why` is not
 * decoration — a suggestion you cannot check is one you either obey or ignore,
 * and both are worse than one you can argue with.
 *
 * There is no model call in this file. The model writes the post *after* you
 * accept a suggestion; deciding what to suggest is arithmetic over the corpus.
 */

export type SuggestionKind =
  | "reply"
  | "topic"
  | "format"
  | "gap"
  | "reshare"
  | "cadence";

export type Suggestion = {
  kind: SuggestionKind;
  /** The instruction, in the imperative. */
  title: string;
  /** The evidence. Always specific, always checkable. */
  why: string;
  /** 0–100. Ordering only — a suggestion is not a prediction. */
  urgency: number;
  /** Deep link to where the work happens. */
  href: string;
  /** Pre-fills a generation when the action is "write something". */
  prompt?: string;
};

const WINDOW_DAYS = 14;

export async function suggestions(session: Session): Promise<Suggestion[]> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);

  const [conversations, ourPosts, rivalPosts, trends, profile, recentDrafts] =
    await Promise.all([
      db.conversation.findMany({
        where: {
          orgId: session.orgId,
          platform: Platform.X,
          status: ConversationStatus.OPEN,
        },
        orderBy: { priority: "desc" },
        take: 20,
      }),
      db.externalPost.findMany({
        where: {
          orgId: session.orgId,
          account: { platform: Platform.X },
          publishedAt: { gte: since },
        },
        orderBy: { publishedAt: "desc" },
        take: 100,
      }),
      db.competitorPost.findMany({
        where: {
          orgId: session.orgId,
          competitor: { platform: Platform.X },
          publishedAt: { gte: since },
        },
        include: { competitor: { select: { handle: true } } },
        take: 100,
      }),
      deriveTrends(session, 8),
      getBrandProfile(session),
      db.post.count({
        where: {
          orgId: session.orgId,
          platform: Platform.X,
          createdAt: { gte: since },
        },
      }),
    ]);

  const out: Suggestion[] = [];

  // ---------------------------------------------------------------- replies
  //
  // The most time-critical thing on the list. An unanswered question with reach
  // behind it costs more the longer it sits, which is why urgency rises with
  // the thread's own priority rather than being fixed.
  for (const conversation of conversations.slice(0, 3)) {
    if (priorityBand(conversation.priority) === "low") continue;
    const hours = Math.round(
      (Date.now() - conversation.lastMessageAt.getTime()) / 3_600_000
    );
    out.push({
      kind: "reply",
      title: `Reply to ${conversation.authorHandle}`,
      why: `Open ${hours}h, priority ${conversation.priority}, sentiment ${conversation.sentiment.toLowerCase()}.`,
      urgency: Math.min(100, conversation.priority + Math.min(20, hours / 6)),
      href: "/inbox",
    });
  }

  // ------------------------------------------------------------------ topics
  //
  // A subject that keeps coming up in what you collected, that you have not
  // written about. The check is against *our own* posts, so "you already
  // covered this" is a real answer rather than a guess.
  const ourText = ourPosts.map((post) => post.text.toLowerCase());
  for (const trend of trends.slice(0, 6)) {
    const covered = ourText.some((text) => text.includes(trend.topic));
    if (covered) continue;
    if (trend.posts < 2) continue;

    out.push({
      kind: "topic",
      title: `Post about "${trend.topic}"`,
      why: `${trend.posts} posts in your hub mention it, ${trend.reach.toLocaleString()} interactions between them, and nothing you've published in ${WINDOW_DAYS} days does.`,
      urgency: Math.min(90, 40 + Math.round(Math.log10(trend.reach + 1) * 12)),
      href: "/studio/x",
      prompt: `Write a post about ${trend.topic}. It is being discussed and we have not weighed in.`,
    });
  }

  // ----------------------------------------------------------------- formats
  //
  // Straight from the measured brand profile, so this agrees with what Settings
  // says rather than being a second opinion computed differently.
  const winning = profile?.winningFormats?.[0];
  if (winning && (profile?.basedOnPosts ?? 0) >= 10) {
    const recentOfKind = ourPosts.filter(
      (post) => post.mediaType === winning.kind
    ).length;
    if (recentOfKind <= 1) {
      out.push({
        kind: "format",
        title: `Make another ${winning.kind}`,
        why: `${winning.kind} posts beat your own average by ${Math.round(winning.lift)}%, measured over ${profile!.basedOnPosts} posts — and you've published ${recentOfKind} in ${WINDOW_DAYS} days.`,
        urgency: 60,
        href: "/studio/x",
        prompt: `Write a ${winning.kind} post. This format outperforms our average by ${Math.round(winning.lift)}%.`,
      });
    }
  }

  // -------------------------------------------------------------------- gaps
  //
  // A rival's post that beat their own average, on a subject we don't touch.
  // Both halves matter: "they posted about it" is not a signal, and "it did
  // well for them" without "we ignore it" is not actionable.
  if (rivalPosts.length >= 5) {
    const rate = (post: { likes: number; comments: number; shares: number; views: number }) => {
      const interactions = post.likes + post.comments + post.shares;
      return post.views > 0 ? (interactions / post.views) * 100 : interactions;
    };
    const average =
      rivalPosts.reduce((sum, post) => sum + rate(post), 0) / rivalPosts.length;

    const theirTerms = extractTerms(rivalPosts.map((post) => post.text), {
      limit: 8,
    });

    for (const term of theirTerms.slice(0, 3)) {
      if (ourText.some((text) => text.includes(term.term))) continue;
      const matching = rivalPosts.filter((post) =>
        post.text.toLowerCase().includes(term.term)
      );
      if (matching.length < 2) continue;
      const theirRate =
        matching.reduce((sum, post) => sum + rate(post), 0) / matching.length;
      if (theirRate <= average) continue;

      out.push({
        kind: "gap",
        title: `They're winning on "${term.term}"`,
        why: `${matching.length} competitor posts on it, averaging ${theirRate.toFixed(1)}% engagement against their own ${average.toFixed(1)}%. You haven't posted about it.`,
        urgency: 55,
        href: "/listening",
        prompt: `Write a post about ${term.term}. Competitors are getting unusual engagement on this subject and we have nothing on it.`,
      });
    }
  }

  // ---------------------------------------------------------------- reshare
  //
  // Your own post that outperformed, old enough that the audience has turned
  // over. Not a rule about virality — a rule about the fact that most followers
  // never saw it.
  if (ourPosts.length >= 5) {
    const withRate = ourPosts
      .map((post) => ({
        post,
        interactions: post.likes + post.comments + post.shares,
      }))
      .sort((a, b) => b.interactions - a.interactions);
    const median = withRate[Math.floor(withRate.length / 2)]!.interactions;
    const best = withRate[0]!;
    const ageDays = Math.round(
      (Date.now() - best.post.publishedAt.getTime()) / 86_400_000
    );

    if (best.interactions > median * 2 && ageDays >= 7) {
      out.push({
        kind: "reshare",
        title: "Say this again, differently",
        why: `Your best post in the window did ${best.interactions.toLocaleString()} interactions against a median of ${median.toLocaleString()}, ${ageDays} days ago. Most of your audience never saw it.`,
        urgency: 45,
        href: "/studio/x",
        prompt: `Rewrite this post from a different angle — same idea, new framing:\n\n${best.post.text}`,
      });
    }
  }

  // ---------------------------------------------------------------- cadence
  //
  // Last, and only when it is true. A nag that fires every day is a nag people
  // learn to scroll past.
  if (recentDrafts === 0 && ourPosts.length > 0) {
    out.push({
      kind: "cadence",
      title: "Nothing drafted in two weeks",
      why: `You've published ${ourPosts.length} posts in the window and drafted none since. The queue is empty.`,
      urgency: 35,
      href: "/studio/x",
    });
  }

  return out.sort((a, b) => b.urgency - a.urgency).slice(0, 8);
}
