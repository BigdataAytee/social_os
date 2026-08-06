import { ConversationKind, Sentiment } from "@prisma/client";

/**
 * Sentiment and priority for one inbound message (OS-ARCHITECTURE.md §11
 * stage 5).
 *
 * **Rule-based, not a model call, and that is the right trade here.** A busy
 * account takes hundreds of comments a day; a model call each would cost real
 * money and add seconds to a sync, to produce a label whose only job is
 * ordering a list. Rules are free, instant, deterministic, and — the part that
 * matters — *inspectable*: when the inbox puts something at the top, the reason
 * can be shown, and a person can disagree with it.
 *
 * Where the model does earn its cost is writing the reply, which is
 * `suggestReply` in service.ts.
 *
 * The lexicon is short on purpose. A long one drifts toward matching adjectives
 * rather than intent, and intent is what triage sorts by: a calm "this doesn't
 * work" needs answering before an enthusiastic "🔥".
 */

const NEGATIVE = [
  "disappointed",
  "disappointing",
  "terrible",
  "awful",
  "worst",
  "useless",
  "broken",
  "doesn't work",
  "didn't work",
  "not working",
  "waste",
  "wasted",
  "refund",
  "cancel",
  "cancelled",
  "scam",
  "misleading",
  "wrong",
  "failed",
  "angry",
  "frustrated",
  "frustrating",
  "ridiculous",
  "unacceptable",
  "disagree",
  "still no reply",
  "no response",
  "hate",
  "poor",
  "avoid",
];

const POSITIVE = [
  "thanks",
  "thank you",
  "love this",
  "love it",
  "brilliant",
  "excellent",
  "genuinely useful",
  "useful",
  "helpful",
  "great",
  "amazing",
  "perfect",
  "saved",
  "saving this",
  "best",
  "well done",
  "appreciate",
  "🔥",
  "❤️",
  "👏",
];

/**
 * Phrases that mean money is on the table. Weighted heavily — a missed sales
 * enquiry costs more than a missed compliment, and this is the one thing an
 * inbox exists to not drop.
 */
const INTENT = [
  "pricing",
  "price",
  "how much",
  "quote",
  "demo",
  "trial",
  "buy",
  "purchase",
  "sign up",
  "get started",
  "work with",
  "hire",
  "consult",
  "as a service",
  "interested in",
  "talk about",
];

/** Cheap spam signals. Enough to sink obvious noise, not enough to filter it. */
const SPAM = [
  "follow me",
  "check my profile",
  "dm me for",
  "click here",
  "free followers",
  "crypto",
  "investment opportunity",
  "make money fast",
  "whatsapp +",
];

export type Triage = {
  sentiment: Sentiment;
  priority: number;
  /** Why it scored what it scored. Shown in the UI. */
  reasons: string[];
};

function countMatches(haystack: string, needles: string[]): string[] {
  return needles.filter((needle) => haystack.includes(needle));
}

/**
 * Score one message.
 *
 * Priority is 0–100 and the weights are stated rather than tuned: nobody has
 * data to tune against yet, and a made-up weight that looks precise is worse
 * than a round number somebody can argue with.
 */
export function triage(input: {
  text: string;
  kind: ConversationKind;
  /** Followers of the author, where the platform tells us. Optional. */
  authorFollowers?: number | null;
  /** How long the thread has been waiting, in hours. */
  waitingHours?: number;
}): Triage {
  const text = input.text.toLowerCase();
  const reasons: string[] = [];

  const negative = countMatches(text, NEGATIVE);
  const positive = countMatches(text, POSITIVE);
  const intent = countMatches(text, INTENT);
  const spam = countMatches(text, SPAM);

  // A question mark is the strongest single signal in an inbox: it is a message
  // that is explicitly waiting for something.
  const asksQuestion = text.includes("?");

  let sentiment: Sentiment = Sentiment.NEUTRAL;
  if (negative.length > positive.length) sentiment = Sentiment.NEGATIVE;
  else if (positive.length > negative.length) sentiment = Sentiment.POSITIVE;

  let priority = 30;

  if (intent.length > 0) {
    priority += 40;
    reasons.push(`mentions ${intent.slice(0, 2).join(" and ")}`);
  }
  if (sentiment === Sentiment.NEGATIVE) {
    priority += 25;
    reasons.push("reads as negative");
  }
  if (asksQuestion) {
    priority += 15;
    reasons.push("asks a question");
  }
  if (input.kind === ConversationKind.DM) {
    // A DM is one person choosing a private channel. Public comments can be
    // answered by the crowd; a DM cannot.
    priority += 10;
    reasons.push("direct message");
  }
  if (sentiment === Sentiment.POSITIVE && intent.length === 0 && !asksQuestion) {
    // Praise is lovely and can wait.
    priority -= 15;
    reasons.push("praise, no question");
  }
  if ((input.authorFollowers ?? 0) >= 10_000) {
    priority += 10;
    reasons.push("large audience");
  }
  if (spam.length > 0) {
    priority -= 40;
    reasons.push("looks like spam");
  }

  // Age matters, but bounded: something waiting three days is urgent, something
  // waiting three weeks is not three times as urgent — it's a decision that got
  // made by not making it.
  const waiting = input.waitingHours ?? 0;
  if (waiting >= 24) {
    const aged = Math.min(20, Math.round(waiting / 12));
    priority += aged;
    reasons.push(`waiting ${Math.round(waiting)}h`);
  }

  return {
    sentiment,
    priority: Math.max(0, Math.min(100, priority)),
    reasons,
  };
}

/** For the UI: the three buckets the priority number is actually read as. */
export function priorityBand(priority: number): "high" | "medium" | "low" {
  if (priority >= 70) return "high";
  if (priority >= 40) return "medium";
  return "low";
}
