/**
 * Where X Hub content comes from (X-HUB.md §1).
 *
 * **The single most important thing in this module is that every method can
 * refuse.** Seven of the eight hub modules need other people's public posts,
 * and reading those needs an X access tier this app may not hold. A source that
 * returned `[]` when it cannot search would render a hub that looks like a
 * quiet day on the internet, and nobody would ever find out why.
 *
 * So capability is declared, not discovered: `supports()` says what this source
 * can do before anything calls it, and a call into an unsupported capability
 * throws `XSourceUnsupportedError` with a reason written for the person reading
 * it, not for a log.
 */

export type XPostData = {
  externalId: string;
  authorHandle: string;
  authorName: string | null;
  authorAvatarUrl: string | null;
  authorVerified: boolean;
  text: string;
  conversationId: string | null;
  replyToId: string | null;
  permalink: string | null;
  mediaType: "video" | "image" | "carousel" | "text";
  mediaUrls: string[];
  likes: number;
  replies: number;
  reposts: number;
  views: number;
  publishedAt: Date;
};

export type XTrendData = {
  topic: string;
  volume: number;
  /** Percent change against the previous day, where the source reports it. */
  change: number | null;
};

/**
 * The four things a source might be able to do.
 *
 * Separate flags rather than one boolean because the tiers genuinely differ:
 * reading a named timeline works on scopes this app already holds, while search
 * and trends do not. Collapsing them would either disable modules that work or
 * enable ones that cannot.
 */
export type XCapabilities = {
  /** Posts from handles we name. Available on plain read scopes. */
  timelines: boolean;
  /** Replies to a conversation. Needs search on X's API. */
  conversations: boolean;
  /** Arbitrary keyword search. Paid tier. */
  search: boolean;
  /** Trending topics. Paid tier; the free endpoint was retired. */
  trends: boolean;
};

export class XSourceUnsupportedError extends Error {
  constructor(
    public readonly capability: keyof XCapabilities,
    public readonly reason: string
  ) {
    super(reason);
    this.name = "XSourceUnsupportedError";
  }
}

export interface XHubSource {
  readonly id: string;
  readonly label: string;

  /** What this source can do, right now, with the credentials it has. */
  supports(): XCapabilities;

  /**
   * Why a capability is unavailable, for the UI to show next to the module it
   * disables. Null when the capability is available.
   */
  unavailableReason(capability: keyof XCapabilities): string | null;

  /** Recent posts from named handles. */
  timeline(handles: string[], since: Date): Promise<XPostData[]>;

  /** Replies in a conversation, newest first. */
  conversation(conversationId: string, since: Date): Promise<XPostData[]>;

  /** Recent posts matching a query. */
  search(query: string, since: Date): Promise<XPostData[]>;

  /** Trending topics, optionally scoped to a country. */
  trends(region?: string | null): Promise<XTrendData[]>;
}
