import Anthropic from "@anthropic-ai/sdk";

/**
 * The single model adapter (ARCHITECTURE.md §9) — swap the model here, nothing
 * else in the app knows which one ran.
 *
 * When ANTHROPIC_API_KEY is set this calls Claude for real. When it isn't, the
 * app still works: `localProvider` composes deterministic drafts from the same
 * prompt so every AI surface is exercisable without a key. Every response
 * carries `source` so the UI can say plainly which one produced it — a draft
 * from the local writer must never be passed off as a model generation.
 */

export const MODEL = "claude-opus-5";

export type ProviderSource = "anthropic" | "local";

export type ProviderResult = {
  text: string;
  source: ProviderSource;
};

export type ProviderMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ToolSpec = {
  name: string;
  description: string;
  input_schema: Anthropic.Tool["input_schema"];
};

export type ToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type ChatResult = {
  text: string;
  toolCalls: ToolCall[];
  source: ProviderSource;
};

export function isModelConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let client: Anthropic | null = null;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

/** One-shot generation. Streams so long outputs can't hit the request timeout. */
export async function complete(opts: {
  system: string;
  messages: ProviderMessage[];
  maxTokens?: number;
  /** Platform character limit, so the fallback writer can respect it too. */
  maxChars?: number;
}): Promise<ProviderResult> {
  if (!isModelConfigured()) {
    return {
      text: localCompletion(opts.messages, opts.maxChars),
      source: "local",
    };
  }

  const stream = getClient().messages.stream({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 4096,
    thinking: { type: "adaptive" },
    system: opts.system,
    messages: opts.messages,
  });

  const message = await stream.finalMessage();

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  return { text, source: "anthropic" };
}

/** Chat turn that may request tools. Tools execute in the orchestrator (§9). */
export async function chat(opts: {
  system: string;
  messages: ProviderMessage[];
  tools: ToolSpec[];
  maxTokens?: number;
}): Promise<ChatResult> {
  if (!isModelConfigured()) {
    return {
      text: localCompletion(opts.messages),
      toolCalls: [],
      source: "local",
    };
  }

  const stream = getClient().messages.stream({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 4096,
    thinking: { type: "adaptive" },
    system: opts.system,
    tools: opts.tools,
    messages: opts.messages,
  });

  const message = await stream.finalMessage();

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  const toolCalls = message.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
    .map((b) => ({
      id: b.id,
      name: b.name,
      input: b.input as Record<string, unknown>,
    }));

  return { text, toolCalls, source: "anthropic" };
}

// ------------------------------------------------------- local fallback writer

/**
 * Deterministic stand-in used only when no API key is present.
 *
 * It is not pretending to be a model: it restructures the user's own input into
 * the shape the prompt asked for, so the surrounding product (saving drafts,
 * scheduling, generation history, brand voice round-trips) is fully exercisable
 * offline. The UI labels every one of these as a local draft.
 */
function localCompletion(
  messages: ProviderMessage[],
  maxChars?: number
): string {
  const last = [...messages].reverse().find((m) => m.role === "user");
  const prompt = last?.content ?? "";

  const brief = prompt.split("\n---\n")[0] ?? "";
  const subject = (prompt.split("\n---\n")[1] ?? prompt).trim();
  const topic = firstSentence(subject) || "this topic";

  const limit = (text: string) => fitWithin(text, maxChars);

  if (/numbered thread/i.test(brief)) {
    // Threads are many posts; the per-post limit doesn't apply to the whole.
    return [
      `${topic} — here's what we actually changed, and what it cost us. 🧵`,
      `1. We wrote the problem down before writing the fix. Most of the disagreement was about the problem.`,
      `2. We gave every draft a deadline. A draft without one is an idea.`,
      `3. We cut the review step for anything under 200 characters.`,
      `4. We templated the three formats that work and stopped inventing a fourth every week.`,
      `5. The calendar became the source of truth. If it isn't on it, it isn't happening.`,
      `That's the whole system. The hard part was step 1.`,
    ].join("\n\n");
  }

  if (/alternative opening lines/i.test(brief)) {
    return [
      `Most teams don't have a ${topic} problem. They have a decision problem.`,
      `We tracked ${topic} for 60 days. One thing predicted every good week.`,
      `Nobody tells you this about ${topic}, so here it is.`,
      `What would have to be true for ${topic} to actually work?`,
      `${capitalise(topic)} is simpler than it looks, and harder than it sounds.`,
    ].join("\n\n");
  }

  if (/video script/i.test(brief)) {
    return [
      `HOOK — "Stop doing ${topic} the way you were taught."`,
      `BEAT 1 — Name the version everyone does, and why it feels right.`,
      `BEAT 2 — Show the moment it breaks. Use a real example, on screen.`,
      `BEAT 3 — The change we made instead, in one sentence.`,
      `BEAT 4 — The result, with the actual number.`,
      `CLOSE — "Try it for one week. Tell me what happens."`,
    ].join("\n");
  }

  if (/content ideas/i.test(brief)) {
    return [
      `The one thing about ${topic} nobody puts in the case study`,
      `We tried ${topic} for 30 days — here's the honest scorecard`,
      `A teardown of the best ${topic} example we found this month`,
      `The three questions to ask before starting on ${topic}`,
      `What ${topic} looks like when you have no budget`,
      `Answering the ${topic} question we get most often`,
    ].join("\n\n");
  }

  if (/title options/i.test(brief)) {
    return [
      `${capitalise(topic)}: the workflow that actually holds up`,
      `We tested ${topic} for 60 days. Here's what moved.`,
      `Why your ${topic} process keeps breaking (and the fix)`,
      `${capitalise(topic)}, explained in one system`,
      `The ${topic} mistake almost every team makes`,
      `Building ${topic} that survives a real team`,
    ].join("\n\n");
  }

  if (/thumbnail concepts/i.test(brief)) {
    return [
      `Split screen: cluttered calendar left, clean calendar right. Overlay: "BEFORE / AFTER".`,
      `Face left, three words right on a flat background: "STOP POSTING DAILY".`,
      `Close-up of a whiteboard with one circled word. Overlay: "THE FIX".`,
      `Over-the-shoulder at the queue screen, one row highlighted. Overlay: "THIS ROW".`,
    ].join("\n\n");
  }

  // Default: a single post, which must fit the platform's limit.
  return limit(
    [
      `${capitalise(topic)} is mostly a decision problem, not a content problem.`,
      ``,
      `The teams that get it right have agreed what the account is for, and publish on a schedule they can keep.`,
      ``,
      `What's the bottleneck on yours?`,
    ].join("\n")
  );
}

/**
 * Trim to the last sentence that fits rather than cutting mid-word — an
 * over-limit draft is one the composer will refuse to save.
 */
function fitWithin(text: string, maxChars?: number) {
  if (!maxChars || text.length <= maxChars) return text;

  const clipped = text.slice(0, maxChars);
  const lastBreak = Math.max(
    clipped.lastIndexOf("."),
    clipped.lastIndexOf("?"),
    clipped.lastIndexOf("!")
  );
  return lastBreak > maxChars * 0.5
    ? clipped.slice(0, lastBreak + 1).trim()
    : `${clipped.slice(0, maxChars - 1).trimEnd()}\u2026`;
}

function firstSentence(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  const match = clean.match(/^(.{0,90}?)(?:[.!?]|$)/);
  return (match?.[1] ?? clean.slice(0, 90)).trim().toLowerCase();
}

function capitalise(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
